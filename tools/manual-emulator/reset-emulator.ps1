param()

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$pidPath = Join-Path $repoRoot '.tmp\manual-emulator\processes.json'
if (-not (Test-Path -LiteralPath $pidPath)) { throw 'Manual preview is not running. Run start-preview.ps1 first.' }

$env:GCLOUD_PROJECT = 'demo-gjsuragan-safety'
$env:GOOGLE_CLOUD_PROJECT = 'demo-gjsuragan-safety'
$env:FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080'
$env:FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099'
$env:GOOGLE_APPLICATION_CREDENTIALS = $null

& node.exe (Join-Path $PSScriptRoot 'seed-emulator.js')
if ($LASTEXITCODE -ne 0) { throw 'Emulator reset/seed failed.' }
& node.exe (Join-Path $PSScriptRoot 'verify-emulator-state.js')
if ($LASTEXITCODE -ne 0) { throw 'Emulator verification failed after reset.' }
Write-Host 'Emulator data reset to the documented baseline.' -ForegroundColor Green
