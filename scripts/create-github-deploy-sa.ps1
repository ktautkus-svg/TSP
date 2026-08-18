# One-time setup: service account for GitHub Actions → Cloud Run deploy.
# Run from repo root in PowerShell after: gcloud auth login && gcloud config set project logistika-504113
#
# After this script finishes, add the key file to GitHub:
#   Repository → Settings → Secrets and variables → Actions → New repository secret
#   Name: GCP_SA_KEY
#   Value: entire contents of .runtime-logs/github-deploy-key.json
#
# Then delete the local key file or keep it offline — do not commit it.

$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
Set-Location $repo

$project = if ($env:GCP_PROJECT_ID) { $env:GCP_PROJECT_ID } else { 'logistika-504113' }
$accountId = 'github-deploy'
$accountEmail = "$accountId@$project.iam.gserviceaccount.com"

$knownGcloud = Join-Path $env:LOCALAPPDATA 'Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd'
$gcloudExe = if (Test-Path $knownGcloud) { $knownGcloud } else { (Get-Command gcloud.cmd -ErrorAction SilentlyContinue).Source }
if (-not $gcloudExe) { throw 'gcloud nerastas. Įdiekite Google Cloud SDK.' }

$runtimeDir = Join-Path $repo '.runtime-logs'
New-Item -ItemType Directory -Force $runtimeDir | Out-Null
$keyPath = Join-Path $runtimeDir 'github-deploy-key.json'

Write-Host "Projektas: $project"

$oldErrPref = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
& $gcloudExe iam service-accounts describe $accountEmail --project $project 2>&1 | Out-Null
$exists = ($LASTEXITCODE -eq 0)
$ErrorActionPreference = $oldErrPref

if (-not $exists) {
  & $gcloudExe iam service-accounts create $accountId `
    --project $project `
    --display-name 'GitHub Actions Cloud Run deploy'
  if ($LASTEXITCODE -ne 0) { throw 'Nepavyko sukurti service account.' }
  Write-Host "Sukurtas service account: $accountEmail"
} else {
  Write-Host "Service account jau egzistuoja: $accountEmail"
}

$projectNumber = (& $gcloudExe projects describe $project --format='value(projectNumber)').Trim()
$runtimeServiceAccount = "$projectNumber-compute@developer.gserviceaccount.com"

$roles = @(
  'roles/run.admin',
  'roles/cloudbuild.builds.editor',
  'roles/storage.admin',
  'roles/artifactregistry.writer',
  'roles/secretmanager.viewer'
)

foreach ($role in $roles) {
  & $gcloudExe projects add-iam-policy-binding $project `
    --member="serviceAccount:$accountEmail" `
    --role=$role `
    --condition=None `
    --quiet | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "Nepavyko priskirti $role" }
}

& $gcloudExe iam service-accounts add-iam-policy-binding $runtimeServiceAccount `
  --project $project `
  --member="serviceAccount:$accountEmail" `
  --role='roles/iam.serviceAccountUser' `
  --quiet | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Nepavyko suteikti serviceAccountUser teisių Cloud Run runtime account.' }

if (Test-Path $keyPath) { Remove-Item -LiteralPath $keyPath -Force }
& $gcloudExe iam service-accounts keys create $keyPath `
  --iam-account=$accountEmail `
  --project $project
if ($LASTEXITCODE -ne 0) { throw 'Nepavyko sukurti service account rakto.' }

Write-Host ''
Write-Host '=== Kitas žingsnis (vieną kartą) ==='
Write-Host '1. Atidaryk GitHub repozitoriją → Settings → Secrets and variables → Actions'
Write-Host '2. New repository secret'
Write-Host '   Name:  GCP_SA_KEY'
Write-Host "   Value: visas $keyPath failo turinys"
Write-Host '3. Po įkėlimo į GitHub — ištrink arba saugiai archyvuok vietinį raktą.'
Write-Host '4. Merge .github/workflows/cloud-run-deploy.yml į main — deploy vyks automatiškai.'
