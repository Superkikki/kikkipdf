param([string]$Kind, [string]$Source, [string]$Output)
$ErrorActionPreference = 'Stop'
$app = $null
$document = $null
$owned = $false
$oldSecurity = $null
$oldAlerts = $null
$oldLinks = $null
try {
  switch ($Kind) {
    'docx' {
      $app = New-Object -ComObject Word.Application
      if ($app.Documents.Count -ne 0) { throw 'Office application already has open documents' }
      $owned = $true
      $oldSecurity = $app.AutomationSecurity
      $oldAlerts = $app.DisplayAlerts
      $oldLinks = $app.Options.UpdateLinksAtOpen
      $app.AutomationSecurity = 3
      $app.DisplayAlerts = 0
      $app.Options.UpdateLinksAtOpen = $false
      $document = $app.Documents.Open($Source, $false, $true)
      $document.ExportAsFixedFormat($Output, 17)
    }
    'xlsx' {
      $app = New-Object -ComObject Excel.Application
      if ($app.Workbooks.Count -ne 0) { throw 'Office application already has open workbooks' }
      $owned = $true
      $oldSecurity = $app.AutomationSecurity
      $oldAlerts = $app.DisplayAlerts
      $oldLinks = $app.AskToUpdateLinks
      $app.AutomationSecurity = 3
      $app.DisplayAlerts = $false
      $app.AskToUpdateLinks = $false
      $document = $app.Workbooks.Open($Source, 0, $true)
      $document.ExportAsFixedFormat(0, $Output)
    }
    'pptx' {
      $app = New-Object -ComObject PowerPoint.Application
      if ($app.Presentations.Count -ne 0) { throw 'Office application already has open presentations' }
      $owned = $true
      $oldSecurity = $app.AutomationSecurity
      $oldAlerts = $app.DisplayAlerts
      $app.AutomationSecurity = 3
      $app.DisplayAlerts = 1
      $document = $app.Presentations.Open($Source, $true, $false, $false)
      $document.SaveAs($Output, 32)
    }
    default { throw 'Unsupported conversion' }
  }
} finally {
  if ($document) {
    if ($Kind -eq 'pptx') { $document.Close() } else { $document.Close($false) }
    [void][System.Runtime.InteropServices.Marshal]::FinalReleaseComObject($document)
  }
  if ($app -and $owned) {
    if ($null -ne $oldSecurity) { $app.AutomationSecurity = $oldSecurity }
    if ($null -ne $oldAlerts) { $app.DisplayAlerts = $oldAlerts }
    if ($null -ne $oldLinks) {
      if ($Kind -eq 'xlsx') { $app.AskToUpdateLinks = $oldLinks } else { $app.Options.UpdateLinksAtOpen = $oldLinks }
    }
    $count = if ($Kind -eq 'pptx') { $app.Presentations.Count } elseif ($Kind -eq 'xlsx') { $app.Workbooks.Count } else { $app.Documents.Count }
    if ($count -eq 0) { $app.Quit() }
  }
  if ($app) { [void][System.Runtime.InteropServices.Marshal]::FinalReleaseComObject($app) }
}
