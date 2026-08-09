$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$base = if ($env:TSP_PRODUCTION_URL) { $env:TSP_PRODUCTION_URL.TrimEnd('/') } else { 'https://logistikos-pristatymai-dmfmgwluca-lz.a.run.app' }
$secretPath = Join-Path $repo '.runtime-logs\cloud-run-device-secret.txt'
if (-not (Test-Path $secretPath)) { throw 'Nerastas vietinis Cloud Run įrenginio raktas.' }
$secret = [IO.File]::ReadAllText($secretPath).Trim()
$suffix = [Guid]::NewGuid().ToString('N').Substring(0, 8)
$adminUser = "codex-admin-$suffix"
$driverUser = "codex-driver-$suffix"
$adminPin = '654321'
$driverPin = '765432'

function New-SignedHeaders([string]$body) {
  $timestamp = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds().ToString()
  $nonce = [Guid]::NewGuid().ToString()
  $sha = [Security.Cryptography.SHA256]::Create()
  try {
    $bodyHash = ([BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($body))) -replace '-', '').ToLowerInvariant()
  } finally { $sha.Dispose() }
  $canonical = "$timestamp.$nonce.$bodyHash"
  $hmac = New-Object Security.Cryptography.HMACSHA256 -ArgumentList (,[Text.Encoding]::UTF8.GetBytes($secret))
  try {
    $signature = ([BitConverter]::ToString($hmac.ComputeHash([Text.Encoding]::UTF8.GetBytes($canonical))) -replace '-', '').ToLowerInvariant()
  } finally { $hmac.Dispose() }
  return @{ 'x-routing-timestamp' = $timestamp; 'x-routing-nonce' = $nonce; 'x-routing-signature' = $signature }
}

function Clear-TestDocuments {
  $gcloud = Join-Path $env:LOCALAPPDATA 'Google\Cloud SDK\google-cloud-sdk\bin\gcloud.cmd'
  $token = (& $gcloud auth print-access-token).Trim()
  $authHeader = @{ Authorization = "Bearer $token" }
  foreach ($collection in @('tsp_assignments', 'tsp_sessions', 'tsp_usernames', 'tsp_users')) {
    $url = "https://firestore.googleapis.com/v1/projects/logistika-504113/databases/%28default%29/documents/${collection}?pageSize=300"
    try {
      $documents = Invoke-RestMethod $url -Headers $authHeader -Method Get
      foreach ($document in $documents.documents) {
        if ($document.name) {
          $deleteUrl = "https://firestore.googleapis.com/v1/" + ($document.name -replace '\(default\)', '%28default%29')
          Invoke-RestMethod $deleteUrl -Headers $authHeader -Method Delete | Out-Null
        }
      }
    } catch {
      if ($_.Exception.Response.StatusCode.value__ -ne 404) { throw }
    }
  }
}

$adminSession = New-Object Microsoft.PowerShell.Commands.WebRequestSession
$driverSession = New-Object Microsoft.PowerShell.Commands.WebRequestSession
$created = $false
try {
  $bootstrapBody = @{ username = $adminUser; displayName = 'Integracijos administratorius'; pin = $adminPin } | ConvertTo-Json -Compress
  $bootstrap = Invoke-RestMethod "$base/api/auth/bootstrap" -Method Post -ContentType 'application/json' -Headers (New-SignedHeaders $bootstrapBody) -Body $bootstrapBody -WebSession $adminSession
  $created = $true
  $me = Invoke-RestMethod "$base/api/auth/me" -WebSession $adminSession

  $driverBody = @{ username = $driverUser; displayName = 'Integracijos vairuotojas'; pin = $driverPin; role = 'driver' } | ConvertTo-Json -Compress
  $driver = Invoke-RestMethod "$base/api/admin/users" -Method Post -ContentType 'application/json' -Body $driverBody -WebSession $adminSession

  $snapshot = @{
    route = @{ id = 'integration-route-1'; status = 'planned'; total_stops = 1; remaining_stops = 1; remaining_weight_kg = 10 }
    stops = @(@{ id = 'integration-stop-1'; route_id = 'integration-route-1'; address = 'Testo g. 1' })
    shipmentLines = @()
  }
  $assignmentBody = @{ driverId = $driver.user.id; routeSnapshot = $snapshot } | ConvertTo-Json -Compress -Depth 8
  $assignment = Invoke-RestMethod "$base/api/admin/assignments" -Method Post -ContentType 'application/json' -Body $assignmentBody -WebSession $adminSession

  $loginBody = @{ username = $driverUser; pin = $driverPin } | ConvertTo-Json -Compress
  $login = Invoke-RestMethod "$base/api/auth/login" -Method Post -ContentType 'application/json' -Body $loginBody -WebSession $driverSession
  $driverAssignments = Invoke-RestMethod "$base/api/assignments" -WebSession $driverSession

  $snapshot.route.status = 'in_progress'
  $progressBody = @{ routeSnapshot = $snapshot } | ConvertTo-Json -Compress -Depth 8
  $progress = Invoke-RestMethod "$base/api/assignments/$($assignment.assignment.id)/progress" -Method Put -ContentType 'application/json' -Body $progressBody -WebSession $driverSession

  [pscustomobject]@{
    bootstrapRole = $bootstrap.profile.role
    meRole = $me.profile.role
    driverRole = $login.profile.role
    assignmentCount = @($driverAssignments.assignments).Count
    progressStatus = $progress.assignment.status
  } | ConvertTo-Json -Compress
} finally {
  if ($created) { Clear-TestDocuments }
}
