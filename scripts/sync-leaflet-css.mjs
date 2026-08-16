/**
 * Copies Leaflet's stylesheet from the installed package into `public/`.
 *
 * The map stylesheet used to be pulled from unpkg.com at runtime, which meant a
 * driver opening the PWA offline (or during a CDN outage) got an unstyled map.
 * Serving it from our own origin lets the service worker precache it with the
 * rest of the shell, and copying instead of vendoring keeps it in sync with the
 * `leaflet` version in package.json.
 */
import { copyFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

const source = join(dirname(require.resolve('leaflet/package.json')), 'dist', 'leaflet.css');
const target = join(projectRoot, 'public', 'leaflet.css');

await mkdir(dirname(target), { recursive: true });
await copyFile(source, target);
process.stdout.write(`leaflet.css nukopijuotas į public/ (${source})\n`);
