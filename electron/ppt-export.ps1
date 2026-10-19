param([Parameter(Mandatory=$true)][string]$InputFile,[Parameter(Mandatory=$true)][string]$OutputDir,[switch]$TextOnly)
$ErrorActionPreference='Stop'
[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
$presentation=$null;$office=$null;$security=$null;$alerts=$null
# 每段文字及其顶边位置（磅），答案识别要知道「答案：」从页面哪里开始
function ShapeLines($shape){
  $out=@()
  try{
    if($shape.Type -eq 6){foreach($child in $shape.GroupItems){$out+=ShapeLines $child};return $out}
    if($shape.HasTable -eq -1){$t=$shape.Table;$row=@();for($r=1;$r -le $t.Rows.Count;$r++){for($c=1;$c -le $t.Columns.Count;$c++){try{$row+=$t.Cell($r,$c).Shape.TextFrame.TextRange.Text}catch{}}};$out+=[pscustomobject]@{t=($row -join ' ');top=[double]$shape.Top;left=[double]$shape.Left};return $out}
    if($shape.HasTextFrame -eq -1 -and $shape.TextFrame.HasText -eq -1){
      $tr=$shape.TextFrame.TextRange;$n=0;try{$n=$tr.Paragraphs().Count}catch{}
      if($n -gt 0 -and $n -le 60){for($k=1;$k -le $n;$k++){$p=$tr.Paragraphs($k,1);$top=[double]$shape.Top;try{$top=[double]$p.BoundTop}catch{};$out+=[pscustomobject]@{t=[string]$p.Text;top=$top;left=[double]$shape.Left}}}
      else{$out+=[pscustomobject]@{t=[string]$tr.Text;top=[double]$shape.Top;left=[double]$shape.Left}}
    }
  }catch{}
  return $out
}
try {
  foreach($prog in @('PowerPoint.Application','KWPP.Application')) { try {$office=New-Object -ComObject $prog;break} catch {} }
  if(!$office){throw '未找到可用的 PowerPoint/WPS 演示组件。请先安装，或另存为 PDF 后打开。'}
  try{$security=$office.AutomationSecurity;$office.AutomationSecurity=3}catch{}
  try{$alerts=$office.DisplayAlerts;$office.DisplayAlerts=1}catch{}
  $presentation=$office.Presentations.Open($InputFile,-1,0,0)
  [IO.Directory]::CreateDirectory($OutputDir)|Out-Null
  $slideWidth=[double]$presentation.PageSetup.SlideWidth;$slideHeight=[double]$presentation.PageSetup.SlideHeight
  $width=1600;$height=[int]($width*$slideHeight/$slideWidth);$count=$presentation.Slides.Count
  $texts=New-Object System.Collections.Generic.List[object]
  for($i=1;$i -le $count;$i++){
    $slide=$presentation.Slides.Item($i)
    if(!$TextOnly){$slide.Export((Join-Path $OutputDir ('slide-{0:D4}.png'-f $i)),'PNG',$width,$height)}
    $items=@();foreach($shape in $slide.Shapes){foreach($l in (ShapeLines $shape)){$t=($l.t -replace "[`r`n`v]+"," ").Trim();if($t){$items+=[pscustomobject]@{t=$(if($t.Length -gt 200){$t.Substring(0,200)}else{$t});y=[math]::Round([math]::Max(0,[math]::Min(1,$l.top/$slideHeight)),3);left=$l.left}}}}
    $sorted=@($items|Sort-Object y,left|Select-Object -First 80|ForEach-Object{[pscustomobject]@{t=$_.t;y=$_.y}})
    $texts.Add([object[]]$sorted)
    [Runtime.InteropServices.Marshal]::ReleaseComObject($slide)|Out-Null
  }
  [IO.File]::WriteAllText((Join-Path $OutputDir 'texts.json'),(ConvertTo-Json -InputObject $texts.ToArray() -Compress -Depth 5),[Text.UTF8Encoding]::new($false))
  if(!$TextOnly){
    $manifest=@{count=$count;aspect=$slideWidth/$slideHeight;mode='static';width=$width;height=$height}
    [IO.File]::WriteAllText((Join-Path $OutputDir 'manifest.json'),($manifest|ConvertTo-Json),[Text.UTF8Encoding]::new($false))
  }
  Write-Output ('Exported {0} slides'-f $count)
} finally {
  if($presentation){try{$presentation.Close()}catch{};[Runtime.InteropServices.Marshal]::ReleaseComObject($presentation)|Out-Null}
  if($office){try{if($null-ne $security){$office.AutomationSecurity=$security};if($null-ne $alerts){$office.DisplayAlerts=$alerts}}catch{};[Runtime.InteropServices.Marshal]::ReleaseComObject($office)|Out-Null}
  [GC]::Collect();[GC]::WaitForPendingFinalizers()
}
