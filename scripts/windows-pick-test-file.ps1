# UI automation for this application's native file picker, used only by smoke tests.
param([int]$TargetProcessId, [string]$FilePath)
$ErrorActionPreference = 'Stop'
$FilePath = [IO.Path]::GetFullPath($FilePath)
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class KikkiTestDialog {
  public delegate bool ChildCallback(IntPtr window, IntPtr data);
  [DllImport("user32.dll")] public static extern bool EnumChildWindows(IntPtr parent, ChildCallback callback, IntPtr data);
  [DllImport("user32.dll")] public static extern int GetDlgCtrlID(IntPtr window);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassNameW(IntPtr window, System.Text.StringBuilder name, int length);
  public static IntPtr FileNameEdit(IntPtr parent) {
    IntPtr result = IntPtr.Zero;
    EnumChildWindows(parent, (window, data) => {
      var name = new System.Text.StringBuilder(256); GetClassNameW(window, name, name.Capacity);
      int id = GetDlgCtrlID(window);
      if ((id == 1152 || id == 1001 || id == 1148) && name.ToString() == "Edit") result = window;
      return true;
    }, IntPtr.Zero);
    return result;
  }
  [DllImport("user32.dll")] public static extern IntPtr GetDlgItem(IntPtr window, int id);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern IntPtr SendMessageW(IntPtr window, uint message, IntPtr param, string text);
  [DllImport("user32.dll")] public static extern bool PostMessageW(IntPtr window, uint message, IntPtr param, IntPtr value);
}
'@
$Condition = New-Object System.Windows.Automation.AndCondition(
  (New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ProcessIdProperty, $TargetProcessId)),
  (New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ClassNameProperty, '#32770'))
)
$Deadline = (Get-Date).AddSeconds(20)
do {
  $Dialog = [System.Windows.Automation.AutomationElement]::RootElement.FindFirst([System.Windows.Automation.TreeScope]::Children, $Condition)
  if (!$Dialog) { Start-Sleep -Milliseconds 200 }
} while (!$Dialog -and (Get-Date) -lt $Deadline)
if (!$Dialog) { throw 'Application file picker did not appear' }
$ControlDeadline = (Get-Date).AddSeconds(7)
$NameHost = $null
$NameControlId = 0
do {
  foreach ($CandidateId in @(1148, 1152, 1001)) {
    $NameHost = $Dialog.FindFirst([System.Windows.Automation.TreeScope]::Descendants,
      (New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::AutomationIdProperty, [string]$CandidateId)))
    if ($NameHost) { $NameControlId = $CandidateId; break }
  }
  if (!$NameHost) { Start-Sleep -Milliseconds 100 }
} while (!$NameHost -and (Get-Date) -lt $ControlDeadline)
if (!$NameHost) { throw 'File name control was not found' }
$NameInput = $NameHost
$EditInput = $NameHost.FindFirst([System.Windows.Automation.TreeScope]::Descendants, (New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::Edit)))
if ($EditInput) { $NameInput = $EditInput }
$Value = $null
if ($NameInput.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$Value)) {
  $Value.SetValue($FilePath)
} else {
  # The legacy common-dialog ComboBox has no UIA Edit descendant on some builds.
  $InputHandle = [KikkiTestDialog]::GetDlgItem([IntPtr]$Dialog.Current.NativeWindowHandle, $NameControlId)
  if ($InputHandle -eq [IntPtr]::Zero) { $InputHandle = [KikkiTestDialog]::FileNameEdit([IntPtr]$Dialog.Current.NativeWindowHandle) }
  if ($InputHandle -eq [IntPtr]::Zero) { throw 'File name input was not found' }
  $Result = [KikkiTestDialog]::SendMessageW($InputHandle, 12, [IntPtr]::Zero, $FilePath)
  if ($Result -eq [IntPtr]::Zero) { throw 'Could not set file name input' }
}
$Open = $Dialog.FindFirst([System.Windows.Automation.TreeScope]::Descendants,
  (New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::AutomationIdProperty, '1')))
if (!$Open) { throw 'Open button was not found' }
$Button = [KikkiTestDialog]::GetDlgItem([IntPtr]$Dialog.Current.NativeWindowHandle, 1)
if ($Button -eq [IntPtr]::Zero -or ![KikkiTestDialog]::PostMessageW($Button, 245, [IntPtr]::Zero, [IntPtr]::Zero)) { throw 'Could not click Open button' }
$CloseDeadline = (Get-Date).AddSeconds(3)
do {
  Start-Sleep -Milliseconds 100
  $Remaining = [System.Windows.Automation.AutomationElement]::RootElement.FindFirst([System.Windows.Automation.TreeScope]::Children, $Condition)
} while ($Remaining -and (Get-Date) -lt $CloseDeadline)
if ($Remaining) { throw 'Application file picker did not close after selecting the test file' }
Write-Output 'Selected test file in application file picker'
