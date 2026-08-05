$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$stateFile = Join-Path $projectRoot '.runtime-logs\pilot-processes.json'

if (-not (Test-Path -LiteralPath $stateFile)) {
  Write-Host 'Pilotiniai procesai neuzregistruoti. Nieko nestabdoma.' -ForegroundColor Yellow
  exit 0
}

$state = Get-Content -LiteralPath $stateFile -Raw | ConvertFrom-Json
if ($state.projectRoot -ne $projectRoot) {
  Write-Host 'Procesu failas priklauso kitam projektui. Nieko nestabdoma.' -ForegroundColor Red
  exit 1
}

$targets = @(
  @{ Name = 'Expo'; Id = [int]$state.expoPid; Marker = "--port $($state.expoPort)" },
  @{ Name = 'Gateway'; Id = [int]$state.gatewayPid; Marker = 'gateway:dev' }
)

foreach ($target in $targets) {
  $process = Get-CimInstance Win32_Process -Filter "ProcessId=$($target.Id)" -ErrorAction SilentlyContinue
  if (-not $process) {
    Write-Host "$($target.Name): procesas jau sustojes."
    continue
  }
  if ($process.CommandLine -notlike "*$($target.Marker)*") {
    Write-Host "$($target.Name): PID $($target.Id) nebeatitinka pilotinio proceso; saugumo sumetimais nestabdomas." -ForegroundColor Red
    continue
  }
  & taskkill.exe /PID $target.Id /T /F | Out-Null
  Write-Host "$($target.Name): sustabdytas PID $($target.Id)." -ForegroundColor Green
}

Remove-Item -LiteralPath $stateFile -Force
Write-Host 'Pilotiniai procesai sustabdyti.' -ForegroundColor Green
