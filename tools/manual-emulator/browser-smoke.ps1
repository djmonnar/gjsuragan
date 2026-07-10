param()

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$tmpRoot = Join-Path $repoRoot '.tmp'
$profileRoot = Join-Path $tmpRoot 'manual-browser-profile'
$outputRoot = Join-Path $tmpRoot 'manual-emulator\browser-smoke'
$chromeCandidates = @(
  (Join-Path ${env:ProgramFiles} 'Google\Chrome\Application\chrome.exe'),
  (Join-Path ${env:ProgramFiles(x86)} 'Google\Chrome\Application\chrome.exe')
)
$chrome = $chromeCandidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (-not $chrome) { throw 'Google Chrome was not found for the local browser smoke test.' }

$resolvedRepo = [IO.Path]::GetFullPath($repoRoot)
foreach ($target in @($profileRoot, $outputRoot)) {
  $resolved = [IO.Path]::GetFullPath($target)
  if (-not $resolved.StartsWith($resolvedRepo + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Unsafe browser smoke target: $resolved"
  }
  if (Test-Path -LiteralPath $target) { Remove-Item -LiteralPath $target -Recurse -Force }
  New-Item -ItemType Directory -Force -Path $target | Out-Null
}

$pages = [ordered]@{
  employee = 'http://127.0.0.1:4173/index.html'
  admin = 'http://127.0.0.1:4173/admin.html'
  customer = 'http://127.0.0.1:4173/customer.html'
  map = 'http://127.0.0.1:4173/map/'
  event = 'http://127.0.0.1:4173/event-order.html'
}

foreach ($entry in $pages.GetEnumerator()) {
  $stdout = Join-Path $outputRoot ($entry.Key + '.html')
  $stderr = Join-Path $outputRoot ($entry.Key + '.err.log')
  $arguments = @(
    '--headless=new',
    '--disable-gpu',
    '--disable-background-networking',
    '--disable-component-update',
    '--disable-sync',
    '--no-first-run',
    '--no-default-browser-check',
    '--virtual-time-budget=5000',
    "--user-data-dir=$profileRoot",
    '--dump-dom',
    $entry.Value
  )
  $process = Start-Process -FilePath $chrome -ArgumentList $arguments -WindowStyle Hidden -PassThru -Wait `
    -RedirectStandardOutput $stdout -RedirectStandardError $stderr
  if ($process.ExitCode -ne 0) { throw "Chrome failed for $($entry.Key). See $stderr" }
  $dom = Get-Content -LiteralPath $stdout -Raw -Encoding UTF8
  if ($dom -notmatch 'manual-safety-banner') { throw "Safety banner was not rendered on $($entry.Key)." }
  Write-Host "PASS browser load: $($entry.Key)"
}

$status = Invoke-RestMethod -Uri 'http://127.0.0.1:4173/__safety/status'
if ($status.projectId -ne 'demo-gjsuragan-safety') { throw 'Browser safety status has the wrong project ID.' }
if ([int]$status.blockedRequestCount -ne 0) {
  $status | ConvertTo-Json -Depth 8 | Write-Host
  throw 'A production endpoint request was attempted during browser smoke testing.'
}
Write-Host 'PASS browser runtime isolation: observed production endpoint requests 0' -ForegroundColor Green
