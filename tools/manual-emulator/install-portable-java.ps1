param()

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$tmpRoot = Join-Path $repoRoot '.tmp\manual-emulator'
$javaRoot = Join-Path $tmpRoot 'jdk-21'

function Get-JavaMajor([string]$JavaExe) {
  try {
    $info = [Diagnostics.ProcessStartInfo]::new()
    $info.FileName = $JavaExe
    $info.Arguments = '-version'
    $info.UseShellExecute = $false
    $info.CreateNoWindow = $true
    $info.RedirectStandardError = $true
    $process = [Diagnostics.Process]::Start($info)
    $output = $process.StandardError.ReadToEnd()
    $process.WaitForExit()
    if ($output -match 'version "(\d+)') { return [int]$Matches[1] }
  } catch {}
  return 0
}

$systemJava = Get-Command java.exe -ErrorAction SilentlyContinue
if ($systemJava -and (Get-JavaMajor $systemJava.Source) -ge 21) {
  Write-Output $systemJava.Source
  exit 0
}

$portableJava = Get-ChildItem -LiteralPath $javaRoot -Filter java.exe -Recurse -ErrorAction SilentlyContinue |
  Where-Object { $_.FullName -match '[\\/]bin[\\/]java\.exe$' } |
  Select-Object -First 1
if ($portableJava -and (Get-JavaMajor $portableJava.FullName) -ge 21) {
  Write-Output $portableJava.FullName
  exit 0
}

New-Item -ItemType Directory -Force -Path $tmpRoot | Out-Null
$zipPath = Join-Path $tmpRoot 'jdk-21.zip'
$downloadUrl = 'https://api.adoptium.net/v3/binary/latest/21/ga/windows/x64/jdk/hotspot/normal/eclipse?project=jdk'
Write-Host 'Java 21 was not found. Downloading a portable JDK into .tmp/manual-emulator...'
Invoke-WebRequest -Uri $downloadUrl -OutFile $zipPath -UseBasicParsing

$resolvedTmp = [IO.Path]::GetFullPath($tmpRoot)
$resolvedJava = [IO.Path]::GetFullPath($javaRoot)
if (-not $resolvedJava.StartsWith($resolvedTmp + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
  throw "Unsafe Java extraction target: $resolvedJava"
}
if (Test-Path -LiteralPath $javaRoot) { Remove-Item -LiteralPath $javaRoot -Recurse -Force }
New-Item -ItemType Directory -Force -Path $javaRoot | Out-Null
Expand-Archive -LiteralPath $zipPath -DestinationPath $javaRoot -Force
Remove-Item -LiteralPath $zipPath -Force

$portableJava = Get-ChildItem -LiteralPath $javaRoot -Filter java.exe -Recurse |
  Where-Object { $_.FullName -match '[\\/]bin[\\/]java\.exe$' } |
  Select-Object -First 1
if (-not $portableJava -or (Get-JavaMajor $portableJava.FullName) -lt 21) {
  throw 'Portable Java 21 installation failed.'
}
Write-Output $portableJava.FullName
