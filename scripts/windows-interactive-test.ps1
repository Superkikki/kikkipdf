# Runs only this project's smoke test in the current user's interactive desktop.
# The temporary task is deleted in finally; no elevated run level is requested.
param([string]$Mode = 'release', [switch]$ContextOnly, [switch]$NavigationOnly, [switch]$FormOnly, [switch]$ImageOnly, [switch]$VerticalOnly, [switch]$ChoiceOnly, [switch]$BookmarkOnly, [switch]$InlineOnly)
$ErrorActionPreference='Stop'
$Root=Split-Path $PSScriptRoot -Parent
$Dir=Join-Path $env:TEMP 'kikki-pdf-interactive-test'
New-Item -ItemType Directory $Dir -Force | Out-Null
$Log=Join-Path $Dir 'result.log'
$Done=Join-Path $Dir 'done.txt'
Remove-Item $Log,$Done -ErrorAction SilentlyContinue
$Runner=Join-Path $Dir 'run.ps1'
$Smoke=Join-Path $PSScriptRoot 'windows-smoke.ps1'
$ContextArgument=if ($ContextOnly) {' -ContextOnly'} elseif ($NavigationOnly) {' -NavigationOnly'} elseif ($FormOnly) {' -FormOnly'} elseif ($ImageOnly) {' -ImageOnly'} elseif ($VerticalOnly) {' -VerticalOnly'} elseif ($ChoiceOnly) {' -ChoiceOnly'} elseif ($BookmarkOnly) {' -BookmarkOnly'} elseif ($InlineOnly) {' -InlineOnly'} else {''}
$Body=@"
try {
 & '$Smoke' -Mode '$Mode'$ContextArgument *>&1 | Out-File -Encoding utf8 '$Log'
 if (`$?) {'pass' | Set-Content '$Done'} else {'failed' | Set-Content '$Done'}
} catch { `$_ | Out-File -Encoding utf8 '$Log' -Append; 'failed' | Set-Content '$Done' }
"@
Set-Content -Path $Runner -Value $Body -Encoding utf8
$Service=New-Object -ComObject 'Schedule.Service'
$Service.Connect()
$Folder=$Service.GetFolder('\')
$Task=$Service.NewTask(0)
$Task.RegistrationInfo.Description='Temporary Kikki PDF integration test'
$Task.Principal.UserId=[Security.Principal.WindowsIdentity]::GetCurrent().Name
$Task.Principal.LogonType=3
$Task.Principal.RunLevel=0
$Task.Settings.ExecutionTimeLimit='PT5M'
$Task.Settings.DisallowStartIfOnBatteries=$false
$Task.Settings.StopIfGoingOnBatteries=$false
$Action=$Task.Actions.Create(0)
$Action.Path=Join-Path $PSHOME 'powershell.exe'
$Action.Arguments='-NoProfile -ExecutionPolicy Bypass -File "'+$Runner+'"'
$Action.WorkingDirectory=$Dir
$Name='KikkiPdfSmoke-'+[guid]::NewGuid().ToString('N')
try {
 $Registered=$Folder.RegisterTaskDefinition($Name,$Task,6,$Task.Principal.UserId,$null,3,$null)
 $Registered.Run($null) | Out-Null
 Write-Output "Started temporary interactive test $Name"
 $Deadline=(Get-Date).AddSeconds(240)
 while (!(Test-Path $Done) -and (Get-Date) -lt $Deadline) {Start-Sleep -Seconds 1}
 if(Test-Path $Log){Get-Content $Log}
 if(!(Test-Path $Done)){throw 'Interactive test timed out'}
 if((Get-Content $Done).Trim() -ne 'pass'){throw 'Interactive test failed'}
} finally {try{$Folder.DeleteTask($Name,0)}catch{Write-Output $_.Exception.Message}}
