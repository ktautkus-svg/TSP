import { copyFile } from 'node:fs/promises';
import { join } from 'node:path';

// Keep the approved FiRo artwork as the single source of truth so every build
// publishes the same navy/burgundy identity on iOS, Android and PWA installs.
for (const [source, target] of [
  ['firo-apple-touch-icon-180.png', 'firo-apple-touch-icon.png'],
  ['firo-app-icon-192.png', 'firo-pwa-icon-192.png'],
  ['firo-app-icon-512.png', 'firo-pwa-icon-512.png'],
  ['firo-app-icon-maskable-512.png', 'firo-pwa-icon-maskable-512.png'],
]) {
  await copyFile(join('assets', 'brand', source), join('public', target));
}
