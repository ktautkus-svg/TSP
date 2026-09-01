param(
  # Approved wide FR / FIRO landscape badge (rounded rectangle). Legacy spiral source:
  # assets/brand/legacy/firo-approved-source-spiral.jpg
  [string]$Source = '.stitch/designs/firo-logo-wide-c.png'
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$sourcePath = (Resolve-Path (Join-Path $projectRoot $Source)).Path
$brandDirectory = Join-Path $projectRoot 'assets/brand'
$publicDirectory = Join-Path $projectRoot 'public'
$approvedSourcePng = Join-Path $brandDirectory 'firo-approved-source.png'
$approvedSourceJpg = Join-Path $brandDirectory 'firo-approved-source.jpg'

Copy-Item -LiteralPath $sourcePath -Destination $approvedSourcePng -Force
# Keep a JPG companion for tooling that expects the historical extension.
$approvedBitmap = New-Object System.Drawing.Bitmap($sourcePath)
$approvedBitmap.Save($approvedSourceJpg, [System.Drawing.Imaging.ImageFormat]::Jpeg)
$approvedBitmap.Dispose()

function New-TransparentArtwork([System.Drawing.Bitmap]$source, [bool]$markOnly) {
  $result = New-Object System.Drawing.Bitmap($source.Width, $source.Height, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  # Wide badge: drop the bottom FIRO strip for mark-only (~78% of height).
  $markCutY = [int]($source.Height * 0.78)
  for ($y = 0; $y -lt $source.Height; $y++) {
    for ($x = 0; $x -lt $source.Width; $x++) {
      $pixel = $source.GetPixel($x, $y)
      $nearWhite = $pixel.R -ge 236 -and $pixel.G -ge 236 -and $pixel.B -ge 236
      $softWhite = $pixel.R -ge 218 -and $pixel.G -ge 218 -and $pixel.B -ge 218 -and ([Math]::Max($pixel.R, [Math]::Max($pixel.G, $pixel.B)) - [Math]::Min($pixel.R, [Math]::Min($pixel.G, $pixel.B))) -le 18
      $alpha = 255
      if ($nearWhite) {
        $alpha = 0
      } elseif ($softWhite) {
        $alpha = [Math]::Max(0, [Math]::Min(255, (236 - [Math]::Min($pixel.R, [Math]::Min($pixel.G, $pixel.B))) * 14))
      }
      if ($markOnly -and $y -gt $markCutY) { $alpha = 0 }
      $result.SetPixel($x, $y, [System.Drawing.Color]::FromArgb($alpha, $pixel.R, $pixel.G, $pixel.B))
    }
  }
  return $result
}

function Get-VisibleBounds([System.Drawing.Bitmap]$bitmap) {
  $left = $bitmap.Width
  $top = $bitmap.Height
  $right = -1
  $bottom = -1
  for ($y = 0; $y -lt $bitmap.Height; $y++) {
    for ($x = 0; $x -lt $bitmap.Width; $x++) {
      if ($bitmap.GetPixel($x, $y).A -gt 12) {
        $left = [Math]::Min($left, $x)
        $top = [Math]::Min($top, $y)
        $right = [Math]::Max($right, $x)
        $bottom = [Math]::Max($bottom, $y)
      }
    }
  }
  if ($right -lt $left -or $bottom -lt $top) { throw 'FiRo artwork has no visible pixels.' }
  $padding = 8
  $left = [Math]::Max(0, $left - $padding)
  $top = [Math]::Max(0, $top - $padding)
  $right = [Math]::Min($bitmap.Width - 1, $right + $padding)
  $bottom = [Math]::Min($bitmap.Height - 1, $bottom + $padding)
  return [System.Drawing.Rectangle]::new($left, $top, $right - $left + 1, $bottom - $top + 1)
}

function Copy-Crop([System.Drawing.Bitmap]$bitmap) {
  $bounds = Get-VisibleBounds $bitmap
  return $bitmap.Clone($bounds, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
}

function Save-Png([System.Drawing.Bitmap]$bitmap, [string]$path) {
  $bitmap.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
}

function New-InverseArtwork([System.Drawing.Bitmap]$artwork) {
  $result = New-Object System.Drawing.Bitmap($artwork.Width, $artwork.Height, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  for ($y = 0; $y -lt $artwork.Height; $y++) {
    for ($x = 0; $x -lt $artwork.Width; $x++) {
      $pixel = $artwork.GetPixel($x, $y)
      if ($pixel.A -eq 0) {
        $result.SetPixel($x, $y, $pixel)
      } elseif ($pixel.B -gt $pixel.R + 14 -and $pixel.B -gt $pixel.G + 14) {
        $result.SetPixel($x, $y, [System.Drawing.Color]::FromArgb($pixel.A, 255, 255, 255))
      } else {
        $result.SetPixel($x, $y, $pixel)
      }
    }
  }
  return $result
}

function New-Icon([System.Drawing.Bitmap]$artwork, [int]$size, [double]$scale, [bool]$transparent) {
  $pixelFormat = [System.Drawing.Imaging.PixelFormat]::Format32bppArgb
  $canvas = New-Object System.Drawing.Bitmap($size, $size, $pixelFormat)
  $graphics = [System.Drawing.Graphics]::FromImage($canvas)
  $graphics.Clear($(if ($transparent) { [System.Drawing.Color]::Transparent } else { [System.Drawing.ColorTranslator]::FromHtml('#FBF9F8') }))
  $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
  $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
  $targetWidth = [int]($size * $scale)
  $targetHeight = [int]($targetWidth * $artwork.Height / $artwork.Width)
  if ($targetHeight -gt [int]($size * $scale)) {
    $targetHeight = [int]($size * $scale)
    $targetWidth = [int]($targetHeight * $artwork.Width / $artwork.Height)
  }
  $left = [int](($size - $targetWidth) / 2)
  $top = [int](($size - $targetHeight) / 2)
  $graphics.DrawImage($artwork, $left, $top, $targetWidth, $targetHeight)
  $graphics.Dispose()
  return $canvas
}

$sourceBitmap = New-Object System.Drawing.Bitmap($sourcePath)
$fullCanvas = New-TransparentArtwork $sourceBitmap $false
$markCanvas = New-TransparentArtwork $sourceBitmap $true
$fullArtwork = Copy-Crop $fullCanvas
$markArtwork = Copy-Crop $markCanvas
$fullInverseArtwork = New-InverseArtwork $fullArtwork
$markInverseArtwork = New-InverseArtwork $markArtwork

Save-Png $fullArtwork (Join-Path $brandDirectory 'firo-wordmark-color.png')
Save-Png $markArtwork (Join-Path $brandDirectory 'firo-mark-color.png')
Save-Png $fullInverseArtwork (Join-Path $brandDirectory 'firo-wordmark-inverse.png')
Save-Png $markInverseArtwork (Join-Path $brandDirectory 'firo-mark-inverse.png')

# Wide landscape badge: use the full wordmark in square icons so FR + road stay readable.
foreach ($definition in @(
  @{ Name = 'firo-app-icon-1024.png'; Size = 1024; Scale = 0.86; Transparent = $false },
  @{ Name = 'firo-app-icon-512.png'; Size = 512; Scale = 0.86; Transparent = $false },
  @{ Name = 'firo-app-icon-192.png'; Size = 192; Scale = 0.86; Transparent = $false },
  @{ Name = 'firo-app-icon-maskable-512.png'; Size = 512; Scale = 0.72; Transparent = $false },
  @{ Name = 'firo-app-icon-foreground-1024.png'; Size = 1024; Scale = 0.72; Transparent = $true },
  @{ Name = 'firo-apple-touch-icon-180.png'; Size = 180; Scale = 0.82; Transparent = $false },
  @{ Name = 'firo-favicon-64.png'; Size = 64; Scale = 0.90; Transparent = $false }
)) {
  $icon = New-Icon $fullArtwork $definition.Size $definition.Scale $definition.Transparent
  Save-Png $icon (Join-Path $brandDirectory $definition.Name)
  $icon.Dispose()
}

foreach ($copy in @(
  @{ Source = 'firo-apple-touch-icon-180.png'; Target = 'firo-apple-touch-icon.png' },
  @{ Source = 'firo-app-icon-192.png'; Target = 'firo-pwa-icon-192.png' },
  @{ Source = 'firo-app-icon-512.png'; Target = 'firo-pwa-icon-512.png' },
  @{ Source = 'firo-app-icon-maskable-512.png'; Target = 'firo-pwa-icon-maskable-512.png' }
)) {
  Copy-Item -LiteralPath (Join-Path $brandDirectory $copy.Source) -Destination (Join-Path $publicDirectory $copy.Target) -Force
}

$markArtwork.Dispose()
$fullArtwork.Dispose()
$markInverseArtwork.Dispose()
$fullInverseArtwork.Dispose()
$markCanvas.Dispose()
$fullCanvas.Dispose()
$sourceBitmap.Dispose()

Write-Output 'FiRo brand assets generated.'
