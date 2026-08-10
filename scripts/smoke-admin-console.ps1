param(
  [string]$BaseUrl = 'http://127.0.0.1:8787'
)

$ErrorActionPreference = 'Stop'
$status = Invoke-RestMethod -Uri "$BaseUrl/api/status" -Method Get
if (-not $status.platform.version) { throw 'Admin Console status is missing platform version.' }
if (($status | ConvertTo-Json) -match '(?i)(api[_-]?key|token|password)') {
  throw 'Admin Console status appears to contain sensitive data.'
}
Write-Output "Admin Console smoke test passed: Jarvis $($status.platform.version), database $($status.database)."
