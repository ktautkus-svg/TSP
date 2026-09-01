#!/usr/bin/env python3
"""Generate FiRo brand PNGs from the approved wide FR badge source.

Linux/macOS counterpart to generate-firo-assets.ps1.
Default source: .stitch/designs/firo-logo-wide-c.png (approved landscape badge).
"""

from __future__ import annotations

import argparse
import shutil
from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
BRAND = ROOT / 'assets' / 'brand'
PUBLIC = ROOT / 'public'
# Prefer the committed approved source; fall back to local Stitch design export.
DEFAULT_SOURCE = next(
  (
    path
    for path in (
      BRAND / 'firo-approved-source.png',
      ROOT / '.stitch' / 'designs' / 'firo-logo-wide-c.png',
      ROOT / '.stitch' / 'designs' / 'firo-logo-wide-fr-badge.jpg',
    )
    if path.exists()
  ),
  BRAND / 'firo-approved-source.png',
)
RUNTIME_MAX_WIDTH = 720


def make_transparent(source: Image.Image) -> Image.Image:
  """Match the PS1 script: near-white → transparent across the whole canvas."""
  rgba = source.convert('RGBA')
  pixels = rgba.load()
  w, h = rgba.size
  for y in range(h):
    for x in range(w):
      r, g, b, a = pixels[x, y]
      near_white = r >= 236 and g >= 236 and b >= 236
      soft_white = (
        r >= 218 and g >= 218 and b >= 218
        and max(r, g, b) - min(r, g, b) <= 18
      )
      if near_white:
        pixels[x, y] = (r, g, b, 0)
      elif soft_white:
        alpha = max(0, min(255, (236 - min(r, g, b)) * 14))
        pixels[x, y] = (r, g, b, alpha)
  return rgba


def visible_bounds(im: Image.Image, pad: int = 8) -> tuple[int, int, int, int]:
  alpha = im.split()[-1]
  bbox = alpha.getbbox()
  if not bbox:
    raise RuntimeError('FiRo artwork has no visible pixels.')
  left, top, right, bottom = bbox
  return (
    max(0, left - pad),
    max(0, top - pad),
    min(im.width, right + pad),
    min(im.height, bottom + pad),
  )


def crop_visible(im: Image.Image) -> Image.Image:
  return im.crop(visible_bounds(im))


def make_inverse(im: Image.Image) -> Image.Image:
  out = im.copy()
  pixels = out.load()
  for y in range(out.height):
    for x in range(out.width):
      r, g, b, a = pixels[x, y]
      if a == 0:
        continue
      if b > r + 14 and b > g + 14:
        pixels[x, y] = (255, 255, 255, a)
      elif r < 50 and g < 55 and b < 110 and b >= r and b >= g:
        pixels[x, y] = (255, 255, 255, a)
  return out


def mark_only(full: Image.Image) -> Image.Image:
  """Remove the bottom FIRO wordmark strip beneath the divider."""
  pixels = full.load()
  w, h = full.size
  best_y = int(h * 0.78)
  best_score = -1
  for y in range(int(h * 0.62), int(h * 0.90)):
    navy = 0
    for x in range(int(w * 0.08), int(w * 0.92)):
      r, g, b, a = pixels[x, y]
      if a > 200 and b > r + 10 and b > g + 10 and r < 90:
        navy += 1
    if navy > best_score:
      best_score = navy
      best_y = y
  cut = min(h, best_y + 4)
  out = full.copy()
  out_pixels = out.load()
  for y in range(cut, h):
    for x in range(w):
      out_pixels[x, y] = (0, 0, 0, 0)
  return crop_visible(out)


def fit_icon(artwork: Image.Image, size: int, scale: float, transparent: bool) -> Image.Image:
  background = (0, 0, 0, 0) if transparent else (251, 249, 248, 255)
  canvas = Image.new('RGBA', (size, size), background)
  art = artwork.copy()
  art.thumbnail((int(size * scale), int(size * scale)), Image.Resampling.LANCZOS)
  left = (size - art.width) // 2
  top = (size - art.height) // 2
  canvas.alpha_composite(art, (left, top))
  return canvas


def main() -> None:
  parser = argparse.ArgumentParser(description=__doc__)
  parser.add_argument(
    '--source',
    default=str(DEFAULT_SOURCE),
    help='Approved wide FR badge source image (PNG/JPG).',
  )
  args = parser.parse_args()
  source_path = Path(args.source).resolve()
  if not source_path.exists():
    raise SystemExit(f'Source not found: {source_path}')

  BRAND.mkdir(parents=True, exist_ok=True)
  PUBLIC.mkdir(parents=True, exist_ok=True)

  # Preserve a copy as the committed approved source.
  approved_png = BRAND / 'firo-approved-source.png'
  approved_jpg = BRAND / 'firo-approved-source.jpg'
  if source_path.resolve() != approved_png.resolve():
    if source_path.suffix.lower() in {'.jpg', '.jpeg'}:
      Image.open(source_path).convert('RGBA').save(approved_png)
    else:
      shutil.copy2(source_path, approved_png)
  Image.open(source_path).convert('RGB').save(approved_jpg, quality=95, optimize=True)

  full_canvas = make_transparent(Image.open(source_path))
  full_art = crop_visible(full_canvas)
  mark_art = mark_only(full_art)
  full_inv = make_inverse(full_art)
  mark_inv = make_inverse(mark_art)

  def save_runtime(image: Image.Image, path: Path) -> Image.Image:
    out = image
    if out.width > RUNTIME_MAX_WIDTH:
      height = round(out.height * RUNTIME_MAX_WIDTH / out.width)
      out = out.resize((RUNTIME_MAX_WIDTH, height), Image.Resampling.LANCZOS)
    out.save(path, optimize=True)
    return out

  full_art = save_runtime(full_art, BRAND / 'firo-wordmark-color.png')
  mark_art = save_runtime(mark_art, BRAND / 'firo-mark-color.png')
  full_inv = save_runtime(full_inv, BRAND / 'firo-wordmark-inverse.png')
  mark_inv = save_runtime(mark_inv, BRAND / 'firo-mark-inverse.png')

  # Prefer the full wide badge in square icons so FR + road stay recognizable.
  icon_art = Image.open(BRAND / 'firo-wordmark-color.png').convert('RGBA')
  for name, size, scale, transparent in (
    ('firo-app-icon-1024.png', 1024, 0.86, False),
    ('firo-app-icon-512.png', 512, 0.86, False),
    ('firo-app-icon-192.png', 192, 0.86, False),
    ('firo-app-icon-maskable-512.png', 512, 0.72, False),
    ('firo-app-icon-foreground-1024.png', 1024, 0.72, True),
    ('firo-apple-touch-icon-180.png', 180, 0.82, False),
    ('firo-favicon-64.png', 64, 0.90, False),
  ):
    fit_icon(icon_art, size, scale, transparent).save(BRAND / name)

  for src_name, dest in (
    ('firo-apple-touch-icon-180.png', PUBLIC / 'firo-apple-touch-icon.png'),
    ('firo-app-icon-192.png', PUBLIC / 'firo-pwa-icon-192.png'),
    ('firo-app-icon-512.png', PUBLIC / 'firo-pwa-icon-512.png'),
    ('firo-app-icon-maskable-512.png', PUBLIC / 'firo-pwa-icon-maskable-512.png'),
  ):
    shutil.copy2(BRAND / src_name, dest)

  print(f'FiRo brand assets generated from {source_path.name}.')
  print(f'  wordmark: {full_art.size[0]}x{full_art.size[1]}')
  print(f'  mark:     {mark_art.size[0]}x{mark_art.size[1]}')


if __name__ == '__main__':
  main()
