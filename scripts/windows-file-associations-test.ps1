param([Parameter(Mandatory = $true)][string]$TestExe)
$ErrorActionPreference = 'Stop'
$SourceExe = (Resolve-Path -LiteralPath $TestExe).Path
# Run a local copy to avoid an Open File security dialog for the WSL UNC path.
$TestExe = Join-Path $env:TEMP ('kikki-associations-' + [guid]::NewGuid().ToString('N') + '.exe')
Copy-Item -LiteralPath $SourceExe -Destination $TestExe
$Id = 'io.kikki.pdf.association-test'
$Name = 'Kikki PDF association test'
$Binary = 'kikki-pdf-association-test.exe'
$User = [Microsoft.Win32.Registry]::CurrentUser
function Read-Value([string]$Path, [string]$Name = '') {
    $Key = $User.OpenSubKey($Path)
    if (!$Key) { return $null }
    try { return $Key.GetValue($Name) } finally { $Key.Dispose() }
}
function Assert-Equal($Actual, $Expected, [string]$Message) {
    if ($Actual -cne $Expected) { throw "$Message : actual=[$Actual], expected=[$Expected]" }
}
function Get-ExtensionSnapshot([string]$Ext) {
    $Values = [ordered]@{}
    foreach ($Path in @("Software\Classes\.$Ext", "Software\Classes\.$Ext\OpenWithProgids", "Software\Microsoft\Windows\CurrentVersion\Explorer\FileExts\.$Ext\UserChoice")) {
        $Key = $User.OpenSubKey($Path)
        if (!$Key) { continue }
        try {
            foreach ($ValueName in ($Key.GetValueNames() | Sort-Object)) {
                if ($ValueName -eq "$Id.$Ext") { continue }
                $Values["$Path\$ValueName"] = @($Key.GetValueKind($ValueName).ToString(), $Key.GetValue($ValueName))
            }
        } finally { $Key.Dispose() }
    }
    return ConvertTo-Json -InputObject $Values -Compress -Depth 4
}
function Run-Hooks([string]$Action = '/S') {
    $Process = Start-Process -FilePath $TestExe -ArgumentList $Action -Wait -PassThru
    Assert-Equal $Process.ExitCode 0 'Hook executable failed'
}
$Before = @{}
foreach ($Ext in @('pdf', 'kpdf')) {
    $Before[$Ext] = Get-ExtensionSnapshot $Ext
    if ($null -ne (Read-Value "Software\Classes\$Id.$Ext")) { throw 'Test registration already exists' }
}
try {
    Run-Hooks
    Run-Hooks # Reinstallation must be idempotent.
    $Command = '"C:\Kikki PDF test\' + [char]0x65e5 + [char]0x672c + [char]0x8a9e + '\' + $Binary + '" "%1"'
    foreach ($Ext in @('pdf', 'kpdf')) {
        Assert-Equal (Read-Value "Software\Classes\$Id.$Ext\shell\open\command") $Command 'Quoted command'
        Assert-Equal (Read-Value "Software\Classes\.$Ext\OpenWithProgids" "$Id.$Ext") '' 'Open With registration'
        Assert-Equal (Read-Value "Software\$Id\Capabilities\FileAssociations" ".$Ext") "$Id.$Ext" 'Capabilities registration'
        Assert-Equal (Read-Value "Software\Classes\Applications\$Binary\SupportedTypes" ".$Ext") '' 'Supported extension'
        Assert-Equal (Get-ExtensionSnapshot $Ext) $Before[$Ext] 'Existing associations preserved'
    }
    Assert-Equal (Read-Value 'Software\RegisteredApplications' $Name) "Software\$Id\Capabilities" 'Default apps registration'
    Assert-Equal (Read-Value "Software\Classes\Applications\$Binary\shell\open\command") $Command 'Application open command'
    Run-Hooks '/OLDINSTALL'
    Assert-Equal (Read-Value 'Software\RegisteredApplications' $Name) "Software\$Id\Capabilities" 'Old uninstaller must preserve newer registration'
    Run-Hooks '/REMOVE'
    foreach ($Ext in @('pdf', 'kpdf')) {
        Assert-Equal (Read-Value "Software\Classes\$Id.$Ext") $null 'ProgID removed'
        Assert-Equal (Read-Value "Software\Classes\.$Ext\OpenWithProgids" "$Id.$Ext") $null 'Open With candidate removed'
        Assert-Equal (Get-ExtensionSnapshot $Ext) $Before[$Ext] 'Existing associations preserved after uninstall'
    }
    Assert-Equal (Read-Value 'Software\RegisteredApplications' $Name) $null 'Default apps entry removed'
    Assert-Equal (Read-Value "Software\Classes\Applications\$Binary" 'FriendlyAppName') $null 'Application registration removed'
    Assert-Equal (Read-Value "Software\$Id\Capabilities" 'ApplicationName') $null 'Capabilities removed'
    Write-Output 'PASS: install, reinstall, quoted Unicode paths, default preservation, old uninstall guard, and uninstall cleanup'
} finally {
    Run-Hooks '/REMOVE'
    Remove-Item -LiteralPath $TestExe -Force
}
