param([string]$Mode = 'release', [string]$Target = 'x86_64-pc-windows-msvc', [switch]$ContextOnly, [switch]$NavigationOnly, [switch]$FormOnly, [switch]$ImageOnly, [switch]$VerticalOnly, [switch]$ChoiceOnly, [switch]$BookmarkOnly, [switch]$InlineOnly, [switch]$UiOnly, [switch]$CjkOnly, [switch]$ProductivityOnly, [switch]$ReviewImagesOnly, [switch]$OrganizationOnly, [switch]$BookmarkFilesOnly, [switch]$AttachmentsOnly, [switch]$PageOrderOnly, [switch]$ProcessingOnly, [switch]$BatesOnly, [switch]$UnicodeOnly, [switch]$Type3Only)
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
Copy-Item (Join-Path $Root 'public\assets\pdfjs\standard_fonts\LiberationSans-Regular.ttf') (Join-Path $TestDir 'local-test-font.ttf') -Force
& 'C:\Program Files\nodejs\node.exe' (Join-Path $PSScriptRoot 'native-fixture.cjs') $Fixture $(if ($Type3Only) {'type3'} elseif ($UnicodeOnly) {'page-order'} elseif ($BatesOnly) {'page-order'} elseif ($ProcessingOnly) {'processing'} elseif ($PageOrderOnly) {'page-order'} elseif ($AttachmentsOnly) {'attachments'} elseif ($BookmarkFilesOnly) {'bookmarks'} elseif ($OrganizationOnly) {'organization'} elseif ($ReviewImagesOnly) {'review-images'} elseif ($CjkOnly) {'cjk'} elseif ($FormOnly) {'form'} elseif ($ImageOnly) {'images'} elseif ($VerticalOnly) {'vertical'} elseif ($ChoiceOnly) {'choices'} elseif ($BookmarkOnly) {'bookmarks'} elseif ($InlineOnly) {'inline'} else {'full'})
if ($LASTEXITCODE -ne 0) { throw 'Could not create test PDF' }
Copy-Item (Join-Path $Root 'src-tauri\icons\128x128.png') (Join-Path $TestDir 'replacement.png') -Force
$env:KIKKI_SMOKE_DIR = $TestDir
$env:KIKKI_SMOKE_TYPE3_ONLY = if ($Type3Only) {'1'} else {''}
$env:KIKKI_SMOKE_UNICODE_ONLY = if ($UnicodeOnly) {'1'} else {''}
$env:KIKKI_SMOKE_BATES_ONLY = if ($BatesOnly) {'1'} else {''}
$env:KIKKI_SMOKE_PROCESSING_ONLY = if ($ProcessingOnly) {'1'} else {''}
$env:KIKKI_SMOKE_PAGE_ORDER_ONLY = if ($PageOrderOnly) {'1'} else {''}
$env:KIKKI_SMOKE_ATTACHMENTS_ONLY = if ($AttachmentsOnly) {'1'} else {''}
$env:KIKKI_SMOKE_BOOKMARK_FILES_ONLY = if ($BookmarkFilesOnly) {'1'} else {''}
$env:KIKKI_SMOKE_ORGANIZATION_ONLY = if ($OrganizationOnly) {'1'} else {''}
$env:KIKKI_SMOKE_PRODUCTIVITY_ONLY = if ($ProductivityOnly) {'1'} else {''}
$env:KIKKI_SMOKE_REVIEW_IMAGES_ONLY = if ($ReviewImagesOnly) {'1'} else {''}
$env:KIKKI_SMOKE_CJK_ONLY = if ($CjkOnly) {'1'} else {''}
$env:KIKKI_SMOKE_CONTEXT_ONLY = if ($ContextOnly) {'1'} else {''}
$env:KIKKI_SMOKE_UI_ONLY = if ($UiOnly) {'1'} else {''}
$env:KIKKI_SMOKE_NAVIGATION_ONLY = if ($NavigationOnly) {'1'} else {''}
$env:KIKKI_SMOKE_FORM_ONLY = if ($FormOnly) {'1'} else {''}
$env:KIKKI_SMOKE_VERTICAL_ONLY = if ($VerticalOnly) {'1'} else {''}
$env:KIKKI_SMOKE_BOOKMARK_ONLY = if ($BookmarkOnly) {'1'} else {''}
$env:KIKKI_SMOKE_CHOICE_ONLY = if ($ChoiceOnly) {'1'} else {''}
$env:KIKKI_SMOKE_INLINE_ONLY = if ($InlineOnly) {'1'} else {''}
$env:KIKKI_SMOKE_IMAGE_ONLY = if ($ImageOnly) {'1'} else {''}
$Process = Start-Process -FilePath $Exe -WorkingDirectory $TestDir -ArgumentList $Fixture -PassThru -RedirectStandardError (Join-Path $TestDir "stderr.log") -RedirectStandardOutput (Join-Path $TestDir "stdout.log")
$env:KIKKI_SMOKE_PROCESS = $Process.Id
Write-Output "Started native process $($Process.Id) in session $($Process.SessionId)"
try {
    # Preserve complete Node stderr before converting a nonzero exit to test failure.
    $ErrorActionPreference = 'Continue'
    & 'C:\Program Files\nodejs\node.exe' (Join-Path $PSScriptRoot 'windows-smoke.cjs')
    $ErrorActionPreference = 'Stop'
    if ($LASTEXITCODE -ne 0) { throw 'Native smoke test failed' }
} finally {
    Write-Output "Process exit: $($Process.ExitCode)"
    Get-Content (Join-Path $TestDir 'stderr.log') -ErrorAction SilentlyContinue
    if (!$Process.HasExited) { Stop-Process -Id $Process.Id -ErrorAction SilentlyContinue }
    Remove-Item $Profile -Recurse -Force -ErrorAction SilentlyContinue
}
