param(
  [int]$GatewayPort = 8787,
  [int]$ExpoPort = 8081,
  [int]$ExpoGoSupportedSdk = 54,
  [string]$PhoneProjectPath = ''
)

$ErrorActionPreference = 'Stop'
$gatewayProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
if (-not $PhoneProjectPath) {
  $PhoneProjectPath = Join-Path (Split-Path $gatewayProjectRoot -Parent) 'logistikos-pristatymai-sdk54-test'
}
if (-not (Test-Path -LiteralPath $PhoneProjectPath -PathType Container)) {
  Write-Host "`nPILOTAS NEPALEISTAS: SDK 54 telefono projekto katalogas nerastas: $PhoneProjectPath" -ForegroundColor Red
  exit 1
}
$phoneProjectRoot = (Resolve-Path -LiteralPath $PhoneProjectPath).Path
$runtimeDir = Join-Path $gatewayProjectRoot '.runtime-logs'
$stateFile = Join-Path $runtimeDir 'pilot-processes.json'
$gatewayOut = Join-Path $runtimeDir 'pilot-gateway.out.log'
$gatewayErr = Join-Path $runtimeDir 'pilot-gateway.err.log'
New-Item -ItemType Directory -Force -Path $runtimeDir | Out-Null

$phonePackagePath = Join-Path $phoneProjectRoot 'package.json'
if (-not (Test-Path -LiteralPath $phonePackagePath -PathType Leaf)) {
  Write-Host "`nPILOTAS NEPALEISTAS: telefono kopijoje nerastas package.json: $phonePackagePath" -ForegroundColor Red
  exit 1
}
$phonePackage = Get-Content -LiteralPath $phonePackagePath -Raw | ConvertFrom-Json
$phoneExpoVersion = [string]$phonePackage.dependencies.expo
$sdkMatch = [regex]::Match($phoneExpoVersion, '(\d+)')
if (-not $sdkMatch.Success) {
  Write-Host "`nPILOTAS NEPALEISTAS: nepavyko nustatyti Expo SDK is telefono package.json ($phoneExpoVersion)." -ForegroundColor Red
  exit 1
}
$phoneExpoSdk = [int]$sdkMatch.Groups[1].Value
if ($phoneExpoSdk -ne $ExpoGoSupportedSdk) {
  Write-Host "`nPILOTAS NEPALEISTAS: fizinio iPhone Expo Go palaiko SDK $ExpoGoSupportedSdk, bet pasirinktas projektas naudoja SDK $phoneExpoSdk ($phoneExpoVersion)." -ForegroundColor Red
  Write-Host "Pasirinkite suderinama telefono kopija. Pagrindinio SDK 57 projekto nedowngrade'inkite." -ForegroundColor Yellow
  exit 1
}

function Fail([string]$message) {
  Write-Host "`nPILOTAS NEPALEISTAS: $message" -ForegroundColor Red
  exit 1
}

function Assert-PortFree([int]$port, [string]$label) {
  $listener = Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($listener) {
    $owner = Get-Process -Id $listener.OwningProcess -ErrorAction SilentlyContinue
    Fail "$label portas $port uzimtas (PID $($listener.OwningProcess), procesas $($owner.ProcessName)). Paleiskite npm run pilot:stop arba pasirinkite kita porta."
  }
}

function Get-LanIPv4 {
  $candidates = Get-NetIPConfiguration | Where-Object {
    $_.NetAdapter.Status -eq 'Up' -and
    $_.NetAdapter.HardwareInterface -eq $true -and
    $_.IPv4Address -and
    $_.IPv4DefaultGateway -and
    $_.InterfaceDescription -notmatch 'VPN|WireGuard|NordLynx|Tunnel|Virtual|Hyper-V'
  } | ForEach-Object {
    $address = $_.IPv4Address.IPAddress
    if ($address -match '^(10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.)') {
      [PSCustomObject]@{
        IPAddress = $address
        InterfaceAlias = $_.InterfaceAlias
        Priority = if ($_.InterfaceAlias -match 'Wi-?Fi|WLAN') { 0 } elseif ($_.InterfaceAlias -match 'Ethernet') { 1 } else { 2 }
      }
    }
  } | Sort-Object Priority, InterfaceAlias
  return $candidates | Select-Object -First 1
}

if (Test-Path -LiteralPath $stateFile) {
  Fail 'rastas ankstesnio piloto procesu failas. Pirmiausia paleiskite npm run pilot:stop.'
}

$lan = Get-LanIPv4
if (-not $lan) {
  Fail 'nerastas aktyvus fizinis Wi-Fi arba Ethernet adapteris su privaciu LAN IPv4 ir numatytuoju sluoztu.'
}

Assert-PortFree $GatewayPort 'Gateway'
Assert-PortFree $ExpoPort 'Expo'

$gatewayUrl = "http://$($lan.IPAddress):$GatewayPort"
$healthUrl = "$gatewayUrl/health"
$expoUrl = "exp://$($lan.IPAddress):$ExpoPort"

# These values apply only to child processes. Source and .env stay untouched.
$env:GATEWAY_HOST = '0.0.0.0'
$env:GATEWAY_PORT = [string]$GatewayPort
$env:EXPO_PUBLIC_GATEWAY_URL = $gatewayUrl
$env:EXPO_PUBLIC_PILOT_MODE = '1'

Write-Host "LAN adapteris: $($lan.InterfaceAlias)" -ForegroundColor Cyan
Write-Host "LAN IPv4:      $($lan.IPAddress)" -ForegroundColor Cyan
Write-Host 'API raktai nebus rodomi.' -ForegroundColor DarkGray

$gatewayProcess = Start-Process -FilePath 'npm.cmd' -ArgumentList 'run','gateway:dev' `
  -WorkingDirectory $gatewayProjectRoot -WindowStyle Hidden `
  -RedirectStandardOutput $gatewayOut -RedirectStandardError $gatewayErr -PassThru

$gatewayReady = $false
for ($attempt = 1; $attempt -le 30; $attempt++) {
  if ($gatewayProcess.HasExited) { break }
  try {
    $health = Invoke-RestMethod -Uri "http://127.0.0.1:$GatewayPort/health" -TimeoutSec 1
    if ($health.status -eq 'ok') { $gatewayReady = $true; break }
  } catch {}
  Start-Sleep -Milliseconds 500
}

if (-not $gatewayReady) {
  if (-not $gatewayProcess.HasExited) { Stop-Process -Id $gatewayProcess.Id -Force -ErrorAction SilentlyContinue }
  $lastError = Get-Content -LiteralPath $gatewayErr -Tail 5 -ErrorAction SilentlyContinue
  Fail "gateway nepasileido per 15 s. Zurnalas: $gatewayErr`n$($lastError -join "`n")"
}

try {
  Invoke-RestMethod -Uri $healthUrl -TimeoutSec 2 | Out-Null
} catch {
  Stop-Process -Id $gatewayProcess.Id -Force -ErrorAction SilentlyContinue
  Fail "gateway veikia lokaliai, bet neatsako per LAN adresa $healthUrl. Patikrinkite Windows Firewall leidima privaciame tinkle; skriptas taisykliu nekeicia."
}

Write-Host "`nGateway paruostas." -ForegroundColor Green
Write-Host 'Rezimas:        Expo Go iPhone smoke test' -ForegroundColor Green
Write-Host "Paleistas:      $phoneProjectRoot"
Write-Host "Expo SDK:       $phoneExpoSdk ($phoneExpoVersion)"
Write-Host "iPhone Safari: $healthUrl"
Write-Host "Expo URL:      $expoUrl"
Write-Host 'QR koda parodys zemiau paleistas Expo terminalas.'
Write-Host 'Sustabdymas kitame terminale: npm run pilot:stop' -ForegroundColor Yellow
Write-Host "Jei iPhone neatidaro health URL: patikrinkite ta pati Wi-Fi, iOS Local Network leidima ir Windows Firewall privaciam tinklui.`n"

$expoProcess = Start-Process -FilePath 'npx.cmd' -ArgumentList 'expo','start','--lan','--port',([string]$ExpoPort) `
  -WorkingDirectory $phoneProjectRoot -NoNewWindow -PassThru

$metroReady = $false
for ($attempt = 1; $attempt -le 30; $attempt++) {
  if ($expoProcess.HasExited) { break }
  $listener = Get-NetTCPConnection -State Listen -LocalPort $ExpoPort -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($listener) { $metroReady = $true; break }
  Start-Sleep -Milliseconds 500
}
if (-not $metroReady) {
  if (-not $expoProcess.HasExited) { Stop-Process -Id $expoProcess.Id -Force -ErrorAction SilentlyContinue }
  if (-not $gatewayProcess.HasExited) { Stop-Process -Id $gatewayProcess.Id -Force -ErrorAction SilentlyContinue }
  Fail "Expo Metro nepasileido per 15 s arba portas $ExpoPort nepasiekiamas."
}

@{
  projectRoot = $gatewayProjectRoot
  expoProjectRoot = $phoneProjectRoot
  expoSdk = $phoneExpoSdk
  createdAt = (Get-Date).ToUniversalTime().ToString('o')
  lanIp = $lan.IPAddress
  gatewayPort = $GatewayPort
  expoPort = $ExpoPort
  gatewayPid = $gatewayProcess.Id
  expoPid = $expoProcess.Id
} | ConvertTo-Json | Set-Content -LiteralPath $stateFile -Encoding UTF8

try {
  Wait-Process -Id $expoProcess.Id
} finally {
  Write-Host "`nExpo sustojo. Tvarkingai stabdomas gateway..." -ForegroundColor Yellow
  & (Join-Path $PSScriptRoot 'pilot-stop.ps1')
}
