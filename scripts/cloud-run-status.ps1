$ErrorActionPreference = 'Stop'
$service = if ($env:CLOUD_RUN_SERVICE) { $env:CLOUD_RUN_SERVICE } else { 'logistikos-pristatymai' }
$region = if ($env:CLOUD_RUN_REGION) { $env:CLOUD_RUN_REGION } else { 'europe-north1' }
$knownGcloud = Join-Path $env:LOCALAPPDATA 'Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd'
$gcloudExe = if (Test-Path $knownGcloud) { $knownGcloud } else { (Get-Command gcloud.cmd -ErrorAction SilentlyContinue).Source }
if (-not $gcloudExe) { throw 'Google Cloud CLI nerastas.' }
$project = (& $gcloudExe config get-value project 2>$null).Trim()
$url = (& $gcloudExe run services describe $service --project $project --region $region --format='value(status.url)').Trim()
if (-not $url) { throw 'Cloud Run servisas nerastas pasirinktame projekte ir regione.' }
$health = Invoke-RestMethod -Uri "$url/health" -TimeoutSec 30
Write-Host "PWA: $url"
Write-Host "Health: $($health.status)"
