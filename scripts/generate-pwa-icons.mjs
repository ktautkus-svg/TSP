import { deflateSync } from 'node:zlib';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

for (const [name, size, maskable] of [
  ['apple-touch-icon.png', 180, false],
  ['pwa-icon-192.png', 192, false],
  ['pwa-icon-512.png', 512, false],
  ['pwa-icon-maskable-512.png', 512, true],
]) {
  await writeFile(join('public', name), createIcon(size, maskable));
}

function createIcon(size, maskable) {
  const pixels = Buffer.alloc((size * 4 + 1) * size);
  const teal = [20, 112, 93, 255];
  const white = [255, 255, 255, 255];
  const margin = maskable ? size * 0.2 : size * 0.12;
  const radius = size * 0.18;
  const points = [
    [margin + radius, size * 0.7],
    [size * 0.48, size * 0.34],
    [size - margin - radius, size * 0.57],
  ];

  for (let y = 0; y < size; y += 1) {
    const row = y * (size * 4 + 1);
    pixels[row] = 0;
    for (let x = 0; x < size; x += 1) {
      let color = teal;
      if (
        distanceToSegment(x, y, points[0], points[1]) < size * 0.045 ||
        distanceToSegment(x, y, points[1], points[2]) < size * 0.045 ||
        points.some(([cx, cy]) => Math.hypot(x - cx, y - cy) < radius * 0.42)
      ) color = white;
      const offset = row + 1 + x * 4;
      pixels.set(color, offset);
    }
  }

  return Buffer.concat([
    pngSignature,
    chunk('IHDR', ihdr(size)),
    chunk('IDAT', deflateSync(pixels, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function ihdr(size) {
  const value = Buffer.alloc(13);
  value.writeUInt32BE(size, 0);
  value.writeUInt32BE(size, 4);
  value[8] = 8;
  value[9] = 6;
  return value;
}

function chunk(type, data) {
  const name = Buffer.from(type);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([name, data])) >>> 0);
  return Buffer.concat([length, name, data, checksum]);
}

function crc32(data) {
  let crc = 0xffffffff;
  for (const value of data) {
    crc ^= value;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return crc ^ 0xffffffff;
}

function distanceToSegment(x, y, [x1, y1], [x2, y2]) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const t = Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(x - (x1 + t * dx), y - (y1 + t * dy));
}
