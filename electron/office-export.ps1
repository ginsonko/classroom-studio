param([Parameter(Mandatory=$true)][string]$InputFile,[Parameter(Mandatory=$true)][string]$OutputFile)
$ErrorActionPreference='Stop'
[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
$office=$null
$document=$null
$security=$null
$alerts=$null
$kind=[IO.Path]::GetExtension($InputFile).ToLowerInvariant()
try {
  if ($kind -in '.ppt','.pptx') {
    foreach ($prog in 'PowerPoint.Application','KWPP.Application') { try {$office=New-Object -ComObject $prog;break} catch {} }
    if (!$office) { throw '未找到可用的 PowerPoint/WPS 演示。请先安装，或另存为 PDF 后打开。' }
    try {$security=$office.AutomationSecurity;$office.AutomationSecurity=3} catch {}
    try {$alerts=$office.DisplayAlerts;$office.DisplayAlerts=1} catch {}
    $document=$office.Presentations.Open($InputFile,-1,0,0)
    $document.SaveAs($OutputFile,32)
  } else {
    foreach ($prog in 'Word.Application','KWPS.Application','WPS.Application') { try {$office=New-Object -ComObject $prog;break} catch {} }
    if (!$office) { throw '未找到可用的 Word/WPS 文字。请先安装，或另存为 PDF 后打开。' }
    try {$security=$office.AutomationSecurity;$office.AutomationSecurity=3} catch {}
    try {$alerts=$office.DisplayAlerts;$office.DisplayAlerts=0} catch {}
    $document=$office.Documents.Open($InputFile,$false,$true,$false)
    try {$document.ExportAsFixedFormat($OutputFile,17)} catch {$document.SaveAs([ref]$OutputFile,[ref]17)}
  }
  if (!(Test-Path -LiteralPath $OutputFile)) {throw '转换程序没有生成 PDF'}
  Write-Output 'PDF export completed'
} finally {
  if ($document) {try {$document.Close(0)} catch {try {$document.Close()} catch {}};[Runtime.InteropServices.Marshal]::ReleaseComObject($document)|Out-Null}
  if ($office) {
    try {if($null -ne $security){$office.AutomationSecurity=$security};if($null -ne $alerts){$office.DisplayAlerts=$alerts}} catch {}
    # A running Office/WPS instance may contain the teacher's own documents. Never quit it.
    [Runtime.InteropServices.Marshal]::ReleaseComObject($office)|Out-Null
  }
  [GC]::Collect();[GC]::WaitForPendingFinalizers()
}
