param(
  [switch]$CleanGenerated
)

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$tmpRoot = Join-Path $repoRoot '.tmp'
$stateRoot = Join-Path $tmpRoot 'manual-emulator'
$pidPath = Join-Path $stateRoot 'processes.json'

function Stop-ProcessTree([int]$RootPid) {
  $all = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue
  $children = @{}
  foreach ($process in $all) {
    $parent = [int]$process.ParentProcessId
    if (-not $children.ContainsKey($parent)) { $children[$parent] = @() }
    $children[$parent] += [int]$process.ProcessId
  }
  $ordered = [Collections.Generic.List[int]]::new()
  function Visit([int]$ProcessId) {
    if ($children.ContainsKey($ProcessId)) { foreach ($child in $children[$ProcessId]) { Visit $child } }
    $ordered.Add($ProcessId)
  }
  Visit $RootPid
  foreach ($processId in $ordered) { Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue }
}

if (Test-Path -LiteralPath $pidPath) {
  $state = Get-Content -LiteralPath $pidPath -Raw -Encoding UTF8 | ConvertFrom-Json
  foreach ($processId in @([int]$state.previewPid, [int]$state.firebasePid)) {
    if ($processId -gt 0) { Stop-ProcessTree $processId }
  }
  Remove-Item -LiteralPath $pidPath -Force
  Write-Host 'Manual preview server and Firebase Emulators stopped.'
} else {
  Write-Host 'No manual preview process file was found.'
}

if ($CleanGenerated) {
  $resolvedRoot = [IO.Path]::GetFullPath($repoRoot)
  $resolvedTmp = [IO.Path]::GetFullPath($tmpRoot)
  if (-not $resolvedTmp.StartsWith($resolvedRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Unsafe cleanup path: $resolvedTmp"
  }
  if (Test-Path -LiteralPath $tmpRoot) { Remove-Item -LiteralPath $tmpRoot -Recurse -Force }
  Write-Host 'Generated .tmp manual validation files removed.'
}
