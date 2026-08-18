# One-time setup: GitHub Actions -> Cloud Run via Workload Identity (no JSON keys).
# Google org policy blocks service account keys on this project; WIF is the supported path.
#
# Run from repo root:
#   gcloud auth login
#   gcloud config set project logistika-504113
#   npm run cloud-run:setup-github

$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
Set-Location $repo

$project = if ($env:GCP_PROJECT_ID) { $env:GCP_PROJECT_ID } else { 'logistika-504113' }
$projectNumber = if ($env:GCP_PROJECT_NUMBER) { $env:GCP_PROJECT_NUMBER } else { '39855768031' }
$githubRepo = if ($env:GITHUB_REPOSITORY) { $env:GITHUB_REPOSITORY } else { 'ktautkus-svg/TSP' }
$accountId = 'github-deploy'
$accountEmail = "$accountId@$project.iam.gserviceaccount.com"
$poolId = 'github-pool'
$providerId = 'github-provider'
$poolLocation = 'global'

$knownGcloud = Join-Path $env:LOCALAPPDATA 'Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd'
$gcloudExe = if (Test-Path $knownGcloud) { $knownGcloud } else { (Get-Command gcloud.cmd -ErrorAction SilentlyContinue).Source }
if (-not $gcloudExe) { throw 'gcloud nerastas. Idiekite Google Cloud SDK.' }

Write-Host "Projektas: $project"
Write-Host "GitHub repo: $githubRepo"

& $gcloudExe services enable iamcredentials.googleapis.com sts.googleapis.com run.googleapis.com cloudbuild.googleapis.com `
  artifactregistry.googleapis.com secretmanager.googleapis.com firestore.googleapis.com `
  --project $project | Out-Null

$oldErrPref = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
& $gcloudExe iam service-accounts describe $accountEmail --project $project 2>&1 | Out-Null
$saExists = ($LASTEXITCODE -eq 0)
$ErrorActionPreference = $oldErrPref

if (-not $saExists) {
  & $gcloudExe iam service-accounts create $accountId `
    --project $project `
    --display-name 'GitHub Actions Cloud Run deploy'
  if ($LASTEXITCODE -ne 0) { throw 'Nepavyko sukurti service account.' }
  Write-Host "Sukurtas service account: $accountEmail"
} else {
  Write-Host "Service account jau egzistuoja: $accountEmail"
}

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
if ($LASTEXITCODE -ne 0) { throw 'Nepavyko suteikti serviceAccountUser teisiu runtime account.' }

$ErrorActionPreference = 'Continue'
& $gcloudExe iam workload-identity-pools describe $poolId `
  --project $project `
  --location $poolLocation 2>&1 | Out-Null
$poolExists = ($LASTEXITCODE -eq 0)
$ErrorActionPreference = $oldErrPref

if (-not $poolExists) {
  & $gcloudExe iam workload-identity-pools create $poolId `
    --project $project `
    --location $poolLocation `
    --display-name 'GitHub Actions'
  if ($LASTEXITCODE -ne 0) { throw 'Nepavyko sukurti workload identity pool.' }
  Write-Host "Sukurtas pool: $poolId"
} else {
  Write-Host "Pool jau egzistuoja: $poolId"
}

$ErrorActionPreference = 'Continue'
& $gcloudExe iam workload-identity-pools providers describe $providerId `
  --project $project `
  --location $poolLocation `
  --workload-identity-pool $poolId 2>&1 | Out-Null
$providerExists = ($LASTEXITCODE -eq 0)
$ErrorActionPreference = $oldErrPref

if (-not $providerExists) {
  & $gcloudExe iam workload-identity-pools providers create-oidc $providerId `
    --project $project `
    --location $poolLocation `
    --workload-identity-pool $poolId `
    --display-name 'GitHub Actions provider' `
    --issuer-uri='https://token.actions.githubusercontent.com' `
    --attribute-mapping='google.subject=assertion.sub,attribute.actor=assertion.actor,attribute.repository=assertion.repository,attribute.repository_owner=assertion.repository_owner' `
    --attribute-condition="assertion.repository_owner=='ktautkus-svg'"
  if ($LASTEXITCODE -ne 0) { throw 'Nepavyko sukurti workload identity provider.' }
  Write-Host "Sukurtas provider: $providerId"
} else {
  Write-Host "Provider jau egzistuoja: $providerId"
}

$member = "principalSet://iam.googleapis.com/projects/$projectNumber/locations/$poolLocation/workloadIdentityPools/$poolId/attribute.repository/$githubRepo"
& $gcloudExe iam service-accounts add-iam-policy-binding $accountEmail `
  --project $project `
  --role='roles/iam.workloadIdentityUser' `
  --member=$member `
  --quiet | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Nepavyko susieti GitHub repo su service account.' }

$providerResource = "projects/$projectNumber/locations/$poolLocation/workloadIdentityPools/$poolId/providers/$providerId"
Write-Host ''
Write-Host '=== GitHub Actions setup baigtas ==='
Write-Host "Provider: $providerResource"
Write-Host "Service account: $accountEmail"
Write-Host 'JSON rakto nereikia. Kitas push i main deployins automatikiskai.'
