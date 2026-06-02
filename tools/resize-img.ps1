# Redimensionne toutes les images PNG de ../img/ dont le grand côté dépasse $Max.
# Préserve le ratio et la transparence. Utilise System.Drawing (intégré à Windows, aucune install).
# Lancement :  powershell -ExecutionPolicy Bypass -File tools\resize-img.ps1
# (ou double-clic sur tools\resize-img.bat)

param(
  [int]$Max = 200,                             # taille max du grand côté (px)
  [string[]]$Skip = @('*vaultboy*','*icons*')  # motifs à ne pas toucher (insensible à la casse)
)

Add-Type -AssemblyName System.Drawing

$imgDir = Join-Path $PSScriptRoot '..\img'
$total = 0

Get-ChildItem $imgDir -Filter *.png | ForEach-Object {
  $name = $_.Name
  if ($Skip | Where-Object { $name -like $_ }) { Write-Host "skip  $name"; return }

  $img = [System.Drawing.Image]::FromFile($_.FullName)
  $long = [Math]::Max($img.Width, $img.Height)
  if ($long -le $Max) { Write-Host "ok    $($_.Name) ($($img.Width)x$($img.Height))"; $img.Dispose(); return }

  $ratio = $Max / $long
  $w = [int]($img.Width * $ratio)
  $h = [int]($img.Height * $ratio)

  $bmp = New-Object System.Drawing.Bitmap $w, $h
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.SmoothingMode     = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
  $g.PixelOffsetMode   = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $g.DrawImage($img, 0, 0, $w, $h)
  $g.Dispose(); $img.Dispose()

  $tmp = "$($_.FullName).tmp"
  $bmp.Save($tmp, [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
  Move-Item -Force $tmp $_.FullName

  $kb = [int]((Get-Item $_.FullName).Length / 1KB)
  Write-Host "OK    $($_.Name) -> ${w}x${h}  (${kb} Ko)"
  $total++
}

Write-Host ""
Write-Host "$total image(s) redimensionnee(s) (max ${Max}px)."
