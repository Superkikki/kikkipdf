$ErrorActionPreference = 'Stop'
$dir = Join-Path $env:TEMP 'kikki-pdf-smoke'
$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS='--remote-debugging-port=9223 --enable-logging=stderr --headless=new --disable-gpu'
Write-Output "Test account=$env:USERNAME session=$env:SESSIONNAME"
$env:WEBVIEW2_USER_DATA_FOLDER=Join-Path $dir 'profile2'
$p=Start-Process (Join-Path $dir 'kikki-pdf.exe') -PassThru
try {
Start-Sleep -Seconds 10
Add-Type @'
using System; using System.Text; using System.Runtime.InteropServices;
public class KikkiWindow {
 public delegate bool Callback(IntPtr w, IntPtr p);
 [DllImport("user32.dll")] public static extern bool EnumChildWindows(IntPtr w, Callback cb, IntPtr p);
 [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr w, StringBuilder s, int n);
 [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr w, StringBuilder s, int n);
 public static void Print(IntPtr w) {var t=new StringBuilder(2048);var c=new StringBuilder(256);GetWindowText(w,t,2048);GetClassName(w,c,256);Console.WriteLine(c+": "+t);}
 public static void Dump(IntPtr w) {Print(w); EnumChildWindows(w,(child,p)=>{Print(child);return true;},IntPtr.Zero);}
}
'@
$p.Refresh()
Write-Output "Process $($p.Id) exited=$($p.HasExited) exit=$($p.ExitCode) handle=$($p.MainWindowHandle)"
if (!$p.HasExited) {
[KikkiWindow]::Dump($p.MainWindowHandle)
$p.Modules | Select-Object ModuleName | ConvertTo-Json -Compress
}
} finally { if (!$p.HasExited) {Stop-Process -Id $p.Id} }
