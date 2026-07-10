param(
  [ValidateSet('disabled', 'enabled')]
  [string]$KakaoAuthMode = 'disabled'
)

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$projectId = 'demo-gjsuragan-safety'
$expectedBaseSha = '440bb02b036f228393fca96432496580cdcdee40'
$expectedBranch = 'test/manual-emulator-validation'
$tmpRoot = Join-Path $repoRoot '.tmp\manual-emulator'
$previewRoot = Join-Path $repoRoot '.tmp\manual-preview'
$functionsCopy = Join-Path $repoRoot '.tmp\manual-functions'
$logsRoot = Join-Path $tmpRoot 'logs'
$pidPath = Join-Path $tmpRoot 'processes.json'
$credentialsPath = Join-Path $tmpRoot 'credentials.json'

function Write-Utf8NoBom([string]$Path, [string]$Content) {
  [IO.File]::WriteAllText($Path, $Content, [Text.UTF8Encoding]::new($false))
}

function Test-Port([int]$Port) {
  try {
    $client = [Net.Sockets.TcpClient]::new()
    $task = $client.ConnectAsync('127.0.0.1', $Port)
    if (-not $task.Wait(300)) { $client.Dispose(); return $false }
    $client.Dispose()
    return $true
  } catch { return $false }
}

function Wait-Port([int]$Port, [int]$Seconds, [string]$Name) {
  $deadline = (Get-Date).AddSeconds($Seconds)
  while ((Get-Date) -lt $deadline) {
    if (Test-Port $Port) { return }
    Start-Sleep -Milliseconds 500
  }
  throw "$Name did not start on 127.0.0.1:$Port. Check $logsRoot."
}

if ($env:GOOGLE_APPLICATION_CREDENTIALS) {
  throw 'GOOGLE_APPLICATION_CREDENTIALS is set. Close this shell or unset it before running the isolated preview.'
}
$credentialFiles = @(
  (Join-Path $repoRoot 'functions\.env'),
  (Join-Path $repoRoot 'functions\.env.gjsuragan-60505'),
  (Join-Path $repoRoot '.runtimeconfig.json')
)
foreach ($file in $credentialFiles) {
  if (Test-Path -LiteralPath $file) { throw "Credential/config file detected in validation worktree: $file" }
}

$branch = (git -C $repoRoot branch --show-current).Trim()
$head = (git -C $repoRoot rev-parse HEAD).Trim()
if ($branch -ne $expectedBranch) { throw "Run only on $expectedBranch (current: $branch)." }
git -C $repoRoot merge-base --is-ancestor $expectedBaseSha HEAD
if ($LASTEXITCODE -ne 0) {
  throw "Validation branch is not based on PR #38 head $expectedBaseSha."
}

if (Test-Path -LiteralPath $pidPath) {
  throw "A manual preview process file already exists. Run stop-preview.ps1 first: $pidPath"
}
foreach ($port in @(4000, 4173, 5001, 8080, 9099)) {
  if (Test-Port $port) { throw "Port $port is already in use. Stop the existing process before continuing." }
}

New-Item -ItemType Directory -Force -Path $tmpRoot, $logsRoot | Out-Null

if (-not (Test-Path -LiteralPath (Join-Path $repoRoot 'functions\node_modules\firebase-admin'))) {
  Write-Host 'Installing Functions dependencies with npm ci...'
  & npm.cmd ci --prefix (Join-Path $repoRoot 'functions')
  if ($LASTEXITCODE -ne 0) { throw 'npm ci failed.' }
}

$javaExe = (& (Join-Path $PSScriptRoot 'install-portable-java.ps1') | Select-Object -Last 1).Trim()
if (-not (Test-Path -LiteralPath $javaExe)) { throw "Java executable was not found: $javaExe" }
$javaBin = Split-Path $javaExe -Parent
$env:JAVA_HOME = Split-Path $javaBin -Parent
$env:Path = "$javaBin;$env:Path"

& node.exe (Join-Path $PSScriptRoot 'prepare-preview.js')
if ($LASTEXITCODE -ne 0) { throw 'Preview preparation failed.' }

$sourceNodeModules = Join-Path $repoRoot 'functions\node_modules'
$generatedNodeModules = Join-Path $functionsCopy 'node_modules'
if (Test-Path -LiteralPath $generatedNodeModules) { Remove-Item -LiteralPath $generatedNodeModules -Force }
New-Item -ItemType Junction -Path $generatedNodeModules -Target $sourceNodeModules | Out-Null

$bytes = [byte[]]::new(18)
$rng = [Security.Cryptography.RandomNumberGenerator]::Create()
$rng.GetBytes($bytes)
$rng.Dispose()
$password = [Convert]::ToBase64String($bytes).Replace('+', 'A').Replace('/', 'B').TrimEnd('=') + '!7a'
$pinNumber = Get-Random -Minimum 100000 -Maximum 999999
$credentials = [ordered]@{
  projectId = $projectId
  password = $password
  kakaoPin = [string]$pinNumber
  kakaoAuthMode = $KakaoAuthMode
  accounts = [ordered]@{
    admin = 'admin@example.invalid'
    staff = 'staff@example.invalid'
    customer = 'customer@example.invalid'
  }
}
Write-Utf8NoBom $credentialsPath (($credentials | ConvertTo-Json -Depth 5) + "`n")

$authEnforcement = if ($KakaoAuthMode -eq 'enabled') { 'true' } else { 'false' }
$envFile = @"
KAKAO_AUTH_ENFORCEMENT=$authEnforcement
KAKAO_ADMIN_PIN=$pinNumber
KAKAO_ALLOWED_USERS=test-kakao-user
KAKAO_ADMIN_EMAILS=admin@example.invalid
LOGEN_ADMIN_EMAILS=admin@example.invalid
LOGEN_API_BASE_URL=http://127.0.0.1:9/blocked
LOGEN_SECRET_KEY=manual-emulator-only
LOGEN_USER_ID=manual-emulator
LOGEN_CUST_CD=manual-emulator
CLOVA_OCR_INVOKE_URL=http://127.0.0.1:9/blocked
CLOVA_OCR_SECRET=manual-emulator-only
NAVER_DIRECTIONS_KEY_ID=manual-emulator-only
NAVER_DIRECTIONS_KEY=manual-emulator-only
"@
Write-Utf8NoBom (Join-Path $functionsCopy '.env.local') $envFile

$env:GCLOUD_PROJECT = $projectId
$env:GOOGLE_CLOUD_PROJECT = $projectId
$env:FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080'
$env:FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099'
$env:CI = '1'

& node.exe (Join-Path $PSScriptRoot 'verify-no-production-endpoints.js')
if ($LASTEXITCODE -ne 0) { throw 'Static production endpoint check failed.' }

$firebaseOut = Join-Path $logsRoot 'firebase.out.log'
$firebaseErr = Join-Path $logsRoot 'firebase.err.log'
$firebaseArgs = @(
  'firebase-tools', 'emulators:start',
  '--config', '.tmp/manual-emulator/firebase.json',
  '--only', 'auth,firestore,functions',
  '--project', $projectId
)
$firebaseProcess = Start-Process -FilePath (Get-Command npx.cmd).Source -ArgumentList $firebaseArgs `
  -WorkingDirectory $repoRoot -WindowStyle Hidden -PassThru `
  -RedirectStandardOutput $firebaseOut -RedirectStandardError $firebaseErr

try {
  $serverProcess = $null
  Wait-Port 9099 90 'Auth Emulator'
  Wait-Port 8080 90 'Firestore Emulator'
  Wait-Port 5001 120 'Functions Emulator'
  Wait-Port 4000 90 'Emulator UI'

  & node.exe (Join-Path $PSScriptRoot 'seed-emulator.js')
  if ($LASTEXITCODE -ne 0) { throw 'Emulator seeding failed.' }

  $serverOut = Join-Path $logsRoot 'preview.out.log'
  $serverErr = Join-Path $logsRoot 'preview.err.log'
  $serverProcess = Start-Process -FilePath (Get-Command node.exe).Source `
    -ArgumentList @((Join-Path $PSScriptRoot 'preview-server.js')) `
    -WorkingDirectory $repoRoot -WindowStyle Hidden -PassThru `
    -RedirectStandardOutput $serverOut -RedirectStandardError $serverErr
  Wait-Port 4173 30 'Preview server'

  $processes = [ordered]@{
    projectId = $projectId
    startedAt = (Get-Date).ToString('o')
    firebasePid = $firebaseProcess.Id
    previewPid = $serverProcess.Id
    branch = $branch
    baseSha = $expectedBaseSha
  }
  Write-Utf8NoBom $pidPath (($processes | ConvertTo-Json -Depth 4) + "`n")

  & node.exe (Join-Path $PSScriptRoot 'verify-emulator-state.js')
  if ($LASTEXITCODE -ne 0) { throw 'Seed/state verification failed.' }
  & (Join-Path $PSScriptRoot 'browser-smoke.ps1')
  if ($LASTEXITCODE -ne 0) { throw 'Browser smoke verification failed.' }
} catch {
  try { Stop-Process -Id $firebaseProcess.Id -Force -ErrorAction SilentlyContinue } catch {}
  if ($serverProcess) { try { Stop-Process -Id $serverProcess.Id -Force -ErrorAction SilentlyContinue } catch {} }
  throw
}

Write-Host ''
Write-Host 'MANUAL SAFETY PREVIEW READY' -ForegroundColor Green
Write-Host "Firebase project: $projectId"
Write-Host 'Auth:       http://127.0.0.1:9099'
Write-Host 'Firestore:  http://127.0.0.1:8080'
Write-Host 'Functions:  http://127.0.0.1:5001'
Write-Host 'PRODUCTION ACCESS: BLOCKED' -ForegroundColor Green
Write-Host ''
Write-Host 'Pages:'
Write-Host '  Employee: http://127.0.0.1:4173/index.html'
Write-Host '  Admin:    http://127.0.0.1:4173/admin.html'
Write-Host '  Customer: http://127.0.0.1:4173/customer.html'
Write-Host '  Map:      http://127.0.0.1:4173/map/'
Write-Host '  Event:    http://127.0.0.1:4173/event-order.html'
Write-Host '  Emulator: http://127.0.0.1:4000'
Write-Host '  Safety:   http://127.0.0.1:4173/__safety/status'
Write-Host ''
Write-Host 'Generated test accounts (same generated password):'
Write-Host "  Admin:    $($credentials.accounts.admin)"
Write-Host "  Employee: $($credentials.accounts.staff)"
Write-Host "  Customer: $($credentials.accounts.customer)"
Write-Host "  Password: $password"
Write-Host "  Kakao mode: $KakaoAuthMode / test PIN: $pinNumber"
Write-Host ''
Write-Host "Stop: powershell -ExecutionPolicy Bypass -File tools/manual-emulator/stop-preview.ps1"
