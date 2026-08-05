$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
Set-Location $repo

if (-not (Test-Path (Join-Path $repo 'dist\index.html'))) {
  throw 'PWA build nerastas. Pirmiausia paleiskite npm run pwa:build.'
}

if (-not $env:GATEWAY_DEVICE_SECRET) {
  $bytes = New-Object byte[] 32
  $generator = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  try { $generator.GetBytes($bytes) } finally { $generator.Dispose() }
  $env:GATEWAY_DEVICE_SECRET = ([BitConverter]::ToString($bytes) -replace '-', '').ToLowerInvariant()
  $secretFile = Join-Path $repo '.runtime-logs\pwa-device-secret.txt'
  New-Item -ItemType Directory -Force (Split-Path -Parent $secretFile) | Out-Null
  [IO.File]::WriteAllText($secretFile, $env:GATEWAY_DEVICE_SECRET)
  Write-Host "Vienkartinis įrenginio raktas išsaugotas: $secretFile"
}

$env:GATEWAY_ENV = 'production'
$env:GATEWAY_AUTH_MODE = 'none'
$env:INTERNAL_GATEWAY_PORT = '8788'
if (-not $env:PORT) { $env:PORT = '8080' }
$env:APP_VERSION = (Get-Content package.json | ConvertFrom-Json).version

Write-Host "Production PWA: http://localhost:$($env:PORT)"
Write-Host "Health: http://localhost:$($env:PORT)/health"
node .\build-server\server\production-server.js
