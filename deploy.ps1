<#
.SYNOPSIS
  src 配下の .js を 1 本の combined.js に統合し、appsscript.json と一緒に dist/ へ出力する。

.DESCRIPTION
  Google Apps Script エディタへコピペしやすいよう、src/vendor/*.js（ライブラリ）を先頭に、
  続けて src/*.js を統合して dist/combined.js を生成する。あわせて src/appsscript.json を
  dist/ にコピーする。GAS では全ファイルがグローバルスコープを共有し関数は巻き上げられるため、
  ライブラリ（diff_match_patch）を先頭に置けば結合順による問題は起きない。

.EXAMPLE
  pwsh ./deploy.ps1
#>
[CmdletBinding()]
param(
  [string]$SrcDir  = (Join-Path $PSScriptRoot 'src'),
  [string]$DistDir = (Join-Path $PSScriptRoot 'dist'),
  [string]$OutFile = 'combined.js'
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path -LiteralPath $SrcDir)) {
  throw "src ディレクトリが見つかりません: $SrcDir"
}

# 出力先を用意
New-Item -ItemType Directory -Force -Path $DistDir | Out-Null

# 結合順: vendor/*.js を先頭、その後に src 直下の *.js（名前順）
$vendorDir = Join-Path $SrcDir 'vendor'
$files = @()
if (Test-Path -LiteralPath $vendorDir) {
  $files += Get-ChildItem -LiteralPath $vendorDir -Filter '*.js' -File | Sort-Object Name
}
$files += Get-ChildItem -LiteralPath $SrcDir -Filter '*.js' -File | Sort-Object Name

if ($files.Count -eq 0) {
  throw "統合対象の .js が見つかりません: $SrcDir"
}

# combined.js を生成
$nl = "`r`n"
$sb = New-Object System.Text.StringBuilder
[void]$sb.Append("// ============================================================")
[void]$sb.Append($nl)
[void]$sb.Append("// ggit combined bundle - deploy.ps1 により自動生成（直接編集しないこと）")
[void]$sb.Append($nl)
[void]$sb.Append("// 元ファイル: src/ 配下の .js を統合")
[void]$sb.Append($nl)
[void]$sb.Append("// ============================================================")
[void]$sb.Append($nl)

foreach ($f in $files) {
  # src からの相対パス（区切りは / に統一）
  $rel = $f.FullName.Substring($SrcDir.Length).TrimStart('\','/').Replace('\','/')
  [void]$sb.Append($nl)
  [void]$sb.Append("// ----- File: src/$rel -----")
  [void]$sb.Append($nl)
  $content = Get-Content -LiteralPath $f.FullName -Raw -Encoding UTF8
  [void]$sb.Append($content)
  if (-not $content.EndsWith("`n")) { [void]$sb.Append($nl) }
}

$outPath = Join-Path $DistDir $OutFile
# BOM 無し UTF-8 で書き出し（GAS 互換）
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($outPath, $sb.ToString(), $utf8NoBom)

# appsscript.json をコピー
$appsscript = Join-Path $SrcDir 'appsscript.json'
if (Test-Path -LiteralPath $appsscript) {
  Copy-Item -LiteralPath $appsscript -Destination (Join-Path $DistDir 'appsscript.json') -Force
} else {
  Write-Warning "appsscript.json が見つかりません: $appsscript"
}

Write-Host "統合完了:" -ForegroundColor Green
Write-Host "  $($files.Count) ファイル -> $outPath"
Write-Host "  appsscript.json -> $(Join-Path $DistDir 'appsscript.json')"
