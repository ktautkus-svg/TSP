$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
Set-Location $repo
$service = if ($env:CLOUD_RUN_SERVICE) { $env:CLOUD_RUN_SERVICE } else { 'logistikos-pristatymai' }
$region = if ($env:CLOUD_RUN_REGION) { $env:CLOUD_RUN_REGION } else { 'europe-north1' }

$knownGcloud = Join-Path $env:LOCALAPPDATA 'Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd'
$gcloudExe = if (Test-Path $knownGcloud) { $knownGcloud } else { (Get-Command gcloud.cmd -ErrorAction SilentlyContinue).Source }
if (-not $gcloudExe) {
  throw 'Google Cloud CLI nerastas. Įdiekite jį iš https://cloud.google.com/sdk/docs/install ir vieną kartą paleiskite: gcloud auth login'
}

$accountsJson = (& $gcloudExe auth list --format=json 2>$null) -join "`n"
$accounts = if ($accountsJson) { $accountsJson | ConvertFrom-Json } else { @() }
$account = $accounts | Where-Object { $_.status -eq 'ACTIVE' } | Select-Object -ExpandProperty account -First 1
if (-not $account) { throw 'Google Cloud paskyra neprijungta. Paleiskite: gcloud auth login' }
$project = (& $gcloudExe config get-value project 2>$null).Trim()
if (-not $project -or $project -eq '(unset)') { throw 'Google Cloud projektas nepasirinktas. Paleiskite: gcloud config set project JUSU_PROJEKTAS' }

Write-Host "Projektas: $project"
Write-Host "Regionas: $region"
& $gcloudExe beta billing projects describe $project --format='value(billingEnabled)' | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Nepavyko patikrinti projekto billing. Patikrinkite teises ir billing būseną.' }

& $gcloudExe services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com secretmanager.googleapis.com firestore.googleapis.com --project $project
if ($LASTEXITCODE -ne 0) { throw 'Nepavyko įjungti Cloud Run reikiamų API.' }

# API raktai iš aplinkos bei .env nuskaitomi ir užregistruojami žemiau

$runtimeDir = Join-Path $repo '.runtime-logs'
New-Item -ItemType Directory -Force $runtimeDir | Out-Null
$deviceSecretFile = Join-Path $runtimeDir 'cloud-run-device-secret.txt'
if ($env:GATEWAY_DEVICE_SECRET) {
  $deviceSecret = $env:GATEWAY_DEVICE_SECRET.Trim().Trim('"', "'").Trim()
} elseif (Test-Path $deviceSecretFile) {
  $deviceSecret = [IO.File]::ReadAllText($deviceSecretFile).Trim().Trim('"', "'").Trim()
} else {
  $bytes = New-Object byte[] 32
  $generator = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  try { $generator.GetBytes($bytes) } finally { $generator.Dispose() }
  $deviceSecret = ([BitConverter]::ToString($bytes) -replace '-', '').ToLowerInvariant()
  [IO.File]::WriteAllText($deviceSecretFile, $deviceSecret)
}

function Set-Secret([string]$name, [string]$value) {
  $oldErrPref = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  & $gcloudExe secrets describe $name --project $project 2>&1 | Out-Null
  $exists = ($LASTEXITCODE -eq 0)
  $ErrorActionPreference = $oldErrPref
  if (-not $exists) {
    & $gcloudExe secrets create $name --replication-policy=automatic --project $project --quiet | Out-Null
  }
  $temporary = Join-Path $runtimeDir "$name.tmp"
  try {
    [IO.File]::WriteAllText($temporary, $value)
    & $gcloudExe secrets versions add $name --data-file=$temporary --project $project | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "Nepavyko atnaujinti Secret Manager reikšmės: $name" }
  } finally {
    Remove-Item -LiteralPath $temporary -Force -ErrorAction SilentlyContinue
  }
}

$apiKeys = @('GOOGLE_ROUTES_API_KEY', 'GOOGLE_API_KEY', 'GOOGLE_GEOCODING_API_KEY', 'GOOGLE_MAPS_API_KEY', 'GOOGLE_VISION_API_KEY', 'HERE_API_KEY')
$allSecrets = [System.Collections.Generic.List[string]]::new()
$allSecrets.Add('GATEWAY_DEVICE_SECRET')
Set-Secret 'GATEWAY_DEVICE_SECRET' $deviceSecret

foreach ($keyName in $apiKeys) {
  $val = $null
  if (Get-Item "env:$keyName" -ErrorAction SilentlyContinue) {
    $val = (Get-Item "env:$keyName").Value
  }
  if (-not $val -and (Test-Path '.env')) {
    $line = Get-Content '.env' | Where-Object { $_ -match "^$keyName=" } | Select-Object -First 1
    if ($line) { $val = $line.Substring($line.IndexOf('=') + 1).Trim('"', "'").Trim() }
  }
  if ($val) {
    Write-Host "Registruojama į Google Secret Manager: $keyName"
    Set-Secret $keyName $val
    $allSecrets.Add($keyName)
  }
}
if (-not ($allSecrets | Where-Object { $_ -match '^GOOGLE_' })) {
  throw 'Joks Google API raktas (GOOGLE_ROUTES_API_KEY, GOOGLE_API_KEY, GOOGLE_GEOCODING_API_KEY ir t.t.) nerastas aplinkoje arba vietiniame .env.'
}

$projectNumber = (& $gcloudExe projects describe $project --format='value(projectNumber)').Trim()
if (-not $projectNumber) { throw 'Nepavyko nustatyti Cloud Run runtime service account.' }
$runtimeServiceAccount = "$projectNumber-compute@developer.gserviceaccount.com"
foreach ($secretName in $allSecrets) {
  & $gcloudExe secrets add-iam-policy-binding $secretName --project $project --member="serviceAccount:$runtimeServiceAccount" --role='roles/secretmanager.secretAccessor' --quiet | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "Nepavyko suteikti Cloud Run prieigos prie $secretName." }
}

& $gcloudExe projects add-iam-policy-binding $project --member="serviceAccount:$runtimeServiceAccount" --role='roles/datastore.user' --condition=None --quiet | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Nepavyko suteikti Cloud Run prieigos prie darbuotojų duomenų bazės.' }

# Build kontekste sąmoningai nekuriamas joks .env failas. Frontend naudoja
# santykinius /api URL, o visos paslaptys Cloud Run procesui prijungiamos tik
# paleidimo metu per Secret Manager. Taip device secret ir Google raktai
# nepatenka nei į JavaScript bundle, nei į Docker build sluoksnius.
$secretsArg = ($allSecrets | ForEach-Object { "$($_)=$($_):latest" }) -join ','
& $gcloudExe run deploy $service --source . --project $project --region $region --allow-unauthenticated --max-instances=1 --set-secrets=$secretsArg --set-env-vars='GATEWAY_AUTH_MODE=none,GATEWAY_ENV=production,APP_VERSION=1.0.0' --quiet
if ($LASTEXITCODE -ne 0) { throw 'Cloud Run deploy nepavyko. Aukščiau pateikta Google Cloud klaida nurodo blokuojantį veiksmą.' }

$url = (& $gcloudExe run services describe $service --project $project --region $region --format='value(status.url)').Trim()
$health = Invoke-RestMethod -Uri "$url/health" -TimeoutSec 30
if ($health.status -ne 'ok') { throw 'Cloud Run /health negrąžino status: ok.' }
Write-Host "PWA HTTPS URL: $url"
Write-Host "Health: $url/health"
Write-Host "Vienkartinio įrenginio rakto failas: $deviceSecretFile"
