import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

const files = await listFiles('dist');
const forbidden = [
  ['localhost URL', /https?:\\?\/\\?\/localhost(?=[:/])/i],
  ['private 192.168 address', /192\.168\.\d{1,3}\.\d{1,3}/],
  ['private 172.20 address', /172\.20\.\d{1,3}\.\d{1,3}/],
  ['test warehouse address', /Kirtimų\s+g\.?\s*47/i],
  ['Google API key shape', /AIza[0-9A-Za-z_-]{30,}/],
  ['bearer token', /Bearer\s+[0-9A-Za-z._~-]{24,}/i],
];
const failures = [];
for (const file of files) {
  const body = await readFile(file);
  const text = body.toString('utf8');
  for (const [label, pattern] of forbidden) {
    if (pattern.test(text)) failures.push(`${label}: ${file}`);
  }
}
for (const secret of [
  process.env.GOOGLE_ROUTES_API_KEY,
  process.env.GATEWAY_DEVICE_SECRET,
  process.env.GATEWAY_APP_SECRET,
].filter((value) => typeof value === 'string' && value.length >= 16)) {
  for (const file of files) {
    if ((await readFile(file)).includes(Buffer.from(secret))) failures.push(`actual secret value: ${file}`);
  }
}
if (failures.length) {
  process.stderr.write(`Production bundle saugumo patikra nepraėjo:\n${failures.join('\n')}\n`);
  process.exit(1);
}
process.stdout.write(`Production bundle saugus: ${files.length} failai, 0 konfigūruotų URL, privačių IP, testinio adreso ar paslapčių.\n`);

async function listFiles(directory) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await listFiles(path));
    else result.push(path);
  }
  return result;
}
