import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { spawnSync } from 'node:child_process';

run(process.execPath, ['scripts/generate-pwa-icons.mjs']);
run(process.execPath, ['scripts/sync-leaflet-css.mjs']);
run(command('npx'), ['tsc', '--noEmit']);
const productionEnv = { ...process.env, EXPO_NO_DOTENV: '1' };
delete productionEnv.EXPO_PUBLIC_GATEWAY_URL;
delete productionEnv.EXPO_PUBLIC_API_URL;
delete productionEnv.GOOGLE_API_KEY;
delete productionEnv.GOOGLE_ROUTES_API_KEY;
delete productionEnv.GATEWAY_DEVICE_SECRET;
delete productionEnv.GATEWAY_APP_SECRET;
run(command('npx'), ['expo', 'export', '--clear', '--platform', 'web', '--output-dir', 'dist'], productionEnv);
run(command('npx'), ['tsc', '-p', 'tsconfig.server.json']);
await patchProductionHtml('dist/index.html');

const files = await listFiles('dist');
const cacheFiles = files
  .filter((file) => !file.endsWith('service-worker.js') && !file.endsWith('.map'))
  .map((file) => `/${relative('dist', file).split(sep).join('/')}`)
  .sort();
const contentIdentity = createHash('sha256');
for (const file of files.filter((value) => !value.endsWith('service-worker.js')).sort()) {
  contentIdentity.update(relative('dist', file));
  contentIdentity.update(await readFile(file));
}
const version = `pwa-${contentIdentity.digest('hex').slice(0, 12)}`;
await writeFile('dist/service-worker.js', serviceWorker(version, cacheFiles), 'utf8');
process.stdout.write(`PWA build paruoštas: dist (${version}, ${cacheFiles.length} failai)\n`);

function command(name) {
  return name;
}

function run(executable, args, environment = process.env) {
  const result = spawnSync(executable, args, {
    stdio: 'inherit',
    env: environment,
    shell: process.platform === 'win32' && executable === 'npx',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

async function patchProductionHtml(path) {
  let html = await readFile(path, 'utf8');
  html = html.replace(
    /<meta name="viewport"[^>]*>/i,
    '<meta name="viewport" content="width=device-width, initial-scale=1, minimum-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover" />',
  );
  const mobileHead = `
<meta name="mobile-web-app-capable" content="yes" />
<meta name="apple-mobile-web-app-capable" content="yes" />
<meta name="apple-mobile-web-app-status-bar-style" content="default" />
<meta name="apple-mobile-web-app-title" content="TSP" />
<link rel="manifest" href="/manifest.webmanifest" />
<link rel="apple-touch-icon" sizes="180x180" href="/tsp-apple-touch-icon.png" />
<style id="tsp-mobile-layout">
  html, body, #root { width: 100vw; min-width: 0; max-width: 100vw; overflow-x: clip; }
  html { -webkit-text-size-adjust: 100%; text-size-adjust: 100%; }
  body { margin: 0; touch-action: pan-y; overscroll-behavior-x: none; }
  #root > div { min-width: 0 !important; max-width: 100vw !important; overflow-x: clip !important; }
  input, textarea, select { font-size: 16px !important; }
  * { box-sizing: border-box; }
</style>
`;
  html = html.replace('</head>', `${mobileHead}</head>`);
  await writeFile(path, html, 'utf8');
}

async function listFiles(directory) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await listFiles(path));
    else result.push(path);
  }
  return result;
}

function serviceWorker(version, assets) {
  return `const VERSION = ${JSON.stringify(version)};
const STATIC_CACHE = 'pristatymai-static-' + VERSION;
const APP_SHELL = '/index.html';
const PRECACHE = ${JSON.stringify(assets, null, 2)};

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(STATIC_CACHE).then((cache) => cache.addAll(PRECACHE)));
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key.startsWith('pristatymai-static-') && key !== STATIC_CACHE) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
  if (event.data?.type === 'GET_VERSION') event.source?.postMessage({ type: 'SW_VERSION', version: VERSION });
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/') || request.method !== 'GET') return;
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).catch(async () => (await caches.match(APP_SHELL)) || Response.error()));
    return;
  }
  event.respondWith(caches.match(request).then((cached) => cached || fetch(request).then((response) => {
    if (response.ok) caches.open(STATIC_CACHE).then((cache) => cache.put(request, response.clone()));
    return response;
  })));
});
`;
}
