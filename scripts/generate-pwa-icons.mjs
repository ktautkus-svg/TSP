import { copyFile } from 'node:fs/promises';
import { join } from 'node:path';

// The old generator drew a generic green route symbol. Keep the approved TSP
// artwork as the single source of truth instead, so every build publishes the
// same recognizable red/blue identity on iOS, Android and PWA installs.
for (const [source, target] of [
  ['tsp-apple-touch-icon-180.png', 'tsp-apple-touch-icon.png'],
  ['tsp-app-icon-192.png', 'tsp-pwa-icon-192.png'],
  ['tsp-app-icon-512.png', 'tsp-pwa-icon-512.png'],
  ['tsp-app-icon-maskable-512.png', 'tsp-pwa-icon-maskable-512.png'],
]) {
  await copyFile(join('assets', 'brand', source), join('public', target));
}
