param([Parameter(Mandatory=$true)][string]$Dir,[Parameter(Mandatory=$true)][string]$Pages,[Parameter(Mandatory=$true)][string]$OutputFile)
# 用 Windows 自带 OCR 读出幻灯片图片上的文字（很多课件整页就是一张图片）。只读，不联网。
$ErrorActionPreference='Stop'
[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null=[Windows.Storage.StorageFile,Windows.Storage,ContentType=WindowsRuntime]
$null=[Windows.Media.Ocr.OcrEngine,Windows.Foundation,ContentType=WindowsRuntime]
$null=[Windows.Graphics.Imaging.BitmapDecoder,Windows.Graphics,ContentType=WindowsRuntime]
$null=[Windows.Globalization.Language,Windows.Globalization,ContentType=WindowsRuntime]
$asTask=([System.WindowsRuntimeSystemExtensions].GetMethods()|Where-Object{$_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'})[0]
function Await($op,[Type]$type){$t=$asTask.MakeGenericMethod($type).Invoke($null,@($op));$null=$t.Wait(-1);$t.Result}
$engine=$null
foreach($tag in @('zh-Hans-CN','zh-Hans','zh-CN')){try{$engine=[Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage([Windows.Globalization.Language]::new($tag))}catch{};if($engine){break}}
if(!$engine){$engine=[Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()}
if(!$engine){throw '本机没有可用的中文文字识别组件'}
$result=New-Object System.Collections.Generic.List[object]
foreach($p in ($Pages -split ',')){
  $n=[int]$p;$file=Join-Path $Dir ('slide-{0:D4}.png'-f $n);$lines=@()
  if(Test-Path -LiteralPath $file){
    try{
      $sf=Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync($file)) ([Windows.Storage.StorageFile])
      $stream=Await ($sf.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
      try{
        $decoder=Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
        $bitmap=Await ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
        $ocr=Await ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])
        $h=[double]$decoder.PixelHeight
        foreach($line in $ocr.Lines){
          $top=1e9;foreach($w in $line.Words){if($w.BoundingRect.Y -lt $top){$top=$w.BoundingRect.Y}}
          $lines+=[pscustomobject]@{t=[string]$line.Text;y=[math]::Round($top/$h,3)}
        }
        $bitmap.Dispose()
      } finally { $stream.Dispose() }
    }catch{}
  }
  $result.Add([pscustomobject]@{p=$n;lines=[object[]]$lines})
}
[IO.File]::WriteAllText($OutputFile,(ConvertTo-Json -InputObject $result.ToArray() -Compress -Depth 5),[Text.UTF8Encoding]::new($false))
Write-Output ('OCR {0} slides'-f $result.Count)
