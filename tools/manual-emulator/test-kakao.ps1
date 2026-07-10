param()

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$credentialsPath = Join-Path $repoRoot '.tmp\manual-emulator\credentials.json'
if (-not (Test-Path -LiteralPath $credentialsPath)) { throw 'Run start-preview.ps1 first.' }
$credentials = Get-Content -LiteralPath $credentialsPath -Raw -Encoding UTF8 | ConvertFrom-Json
$url = 'http://127.0.0.1:5001/demo-gjsuragan-safety/asia-northeast3/api/api/kakao/webhook'

function Invoke-Kakao([string]$Text) {
  $payload = [ordered]@{
    userRequest = [ordered]@{
      utterance = $Text
      user = [ordered]@{ id = 'test-kakao-user'; type = 'botUserKey'; properties = @{} }
      params = [ordered]@{ surface = 'Kakaotalk.plusfriend' }
      timezone = 'Asia/Seoul'
    }
    action = [ordered]@{ params = @{}; detailParams = @{} }
    bot = [ordered]@{ id = 'manual-emulator-bot'; name = 'Manual Emulator Bot' }
    intent = [ordered]@{ id = 'manual-emulator-intent'; name = 'Manual Emulator Intent' }
  }
  $json = $payload | ConvertTo-Json -Depth 10 -Compress
  $result = Invoke-RestMethod -Method Post -Uri $url -ContentType 'application/json; charset=utf-8' -Body ([Text.Encoding]::UTF8.GetBytes($json))
  $text = ($result.template.outputs | ForEach-Object { $_.simpleText.text }) -join "`n"
  return $text
}

$mode = [string]$credentials.kakaoAuthMode
Write-Host "Kakao Emulator mode: $mode"
if ($mode -eq 'disabled') {
  $result = Invoke-Kakao '오늘배송'
  if ($result -match '관리자 인증이 필요|허용된 관리자|보안 설정') { throw 'Auth-disabled flow unexpectedly requested authentication.' }
  if ($result -notmatch '궁중수라간') { throw "Unexpected Kakao response: $result" }
  Write-Host 'PASS: auth disabled preserves existing read command.' -ForegroundColor Green
  Write-Host $result
  exit 0
}

$blocked = Invoke-Kakao '오늘배송'
if ($blocked -notmatch '관리자 인증이 필요') { throw "Unauthenticated request was not blocked: $blocked" }
Write-Host 'PASS: unauthenticated read blocked.' -ForegroundColor Green

$ocrBlocked = Invoke-Kakao '식단표 등록'
if ($ocrBlocked -notmatch '관리자 인증이 필요') { throw "Unauthenticated OCR flow was not blocked: $ocrBlocked" }
Write-Host 'PASS: unauthenticated OCR blocked before session creation.' -ForegroundColor Green

$authenticated = Invoke-Kakao ("인증 " + [string]$credentials.kakaoPin)
if ($authenticated -notmatch '인증이 완료') { throw "PIN authentication failed: $authenticated" }
Write-Host 'PASS: PIN authentication.' -ForegroundColor Green

$allowed = Invoke-Kakao '오늘배송'
if ($allowed -notmatch '궁중수라간') { throw "Authenticated request failed: $allowed" }
Write-Host 'PASS: authenticated read command.' -ForegroundColor Green

Write-Host 'Waiting 12 seconds for the preview-only 10 second session TTL...'
Start-Sleep -Seconds 12
$expired = Invoke-Kakao '오늘배송'
if ($expired -notmatch '관리자 인증이 필요') { throw "Expired session still had access: $expired" }
Write-Host 'PASS: session expiry blocks access again.' -ForegroundColor Green
