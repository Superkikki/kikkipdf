param([string]$Mode = 'release', [string]$Target = 'x86_64-pc-windows-msvc')
$ErrorActionPreference = 'Stop'
$Root = Split-Path $PSScriptRoot -Parent
$Exe = Join-Path $Root "src-tauri\target\$Target\$Mode\kikki-pdf.exe"
$TestDir = Join-Path $env:TEMP ('kikki-pdf-smoke-' + $Target)
Get-Process kikki-pdf -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq (Join-Path $TestDir 'kikki-pdf.exe') } | Stop-Process -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Path $TestDir -Force | Out-Null
Copy-Item $Exe (Join-Path $TestDir 'kikki-pdf.exe') -Force
$Loader = Join-Path (Split-Path $Exe) 'WebView2Loader.dll'
if (Test-Path $Loader) {Copy-Item $Loader $TestDir -Force}
$Exe = Join-Path $TestDir 'kikki-pdf.exe'
$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = '--remote-debugging-port=9223'
$Profile = Join-Path $TestDir ('profile-' + [guid]::NewGuid().ToString('N'))
$env:WEBVIEW2_USER_DATA_FOLDER = $Profile
$Fixture = Join-Path $TestDir 'native-fixture.pdf'
& 'C:\Program Files\nodejs\node.exe' (Join-Path $PSScriptRoot 'native-fixture.cjs') $Fixture
if ($LASTEXITCODE -ne 0) { throw 'Could not create test PDF' }
$env:KIKKI_SMOKE_DIR = $TestDir
$Process = Start-Process -FilePath $Exe -WorkingDirectory $TestDir -ArgumentList $Fixture -PassThru -RedirectStandardError (Join-Path $TestDir "stderr.log") -RedirectStandardOutput (Join-Path $TestDir "stdout.log")
Write-Output "Started native process $($Process.Id) in session $($Process.SessionId)"
try {
    & 'C:\Program Files\nodejs\node.exe' (Join-Path $PSScriptRoot 'windows-smoke.cjs')
    if ($LASTEXITCODE -ne 0) { throw 'Native smoke test failed' }
} finally {
    Write-Output "Process exit: $($Process.ExitCode)"
    Get-Content (Join-Path $TestDir 'stderr.log') -ErrorAction SilentlyContinue
    if (!$Process.HasExited) { Stop-Process -Id $Process.Id -ErrorAction SilentlyContinue }
    Remove-Item $Profile -Recurse -Force -ErrorAction SilentlyContinue
}
