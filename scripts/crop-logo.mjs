/**
 * Crops the transparent padding off a PNG so the artwork fills its frame.
 * The source logo is a 1024x1024 canvas with the mark floating in the middle,
 * which made it render tiny inside the header's logo box.
 *
 *   node ./scripts/crop-logo.mjs <source.png> <target.png>
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { deflateSync, inflateSync } from 'node:zlib';

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const ALPHA_THRESHOLD = 8;

function readChunks(buffer) {
  if (!buffer.subarray(0, 8).equals(PNG_SIGNATURE)) throw new Error('Not a PNG file.');
  const chunks = [];
  let offset = 8;
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    chunks.push({ type, data: buffer.subarray(offset + 8, offset + 8 + length) });
    offset += 12 + length;
  }
  return chunks;
}

function paethPredictor(left, up, upperLeft) {
  const estimate = left + up - upperLeft;
  const distLeft = Math.abs(estimate - left);
  const distUp = Math.abs(estimate - up);
  const distUpperLeft = Math.abs(estimate - upperLeft);
  if (distLeft <= distUp && distLeft <= distUpperLeft) return left;
  return distUp <= distUpperLeft ? up : upperLeft;
}

function unfilter(raw, width, height, bytesPerPixel) {
  const stride = width * bytesPerPixel;
  const pixels = Buffer.alloc(stride * height);
  for (let row = 0; row < height; row += 1) {
    const filter = raw[row * (stride + 1)];
    const source = raw.subarray(row * (stride + 1) + 1, row * (stride + 1) + 1 + stride);
    const target = pixels.subarray(row * stride, row * stride + stride);
    const previous = row > 0 ? pixels.subarray((row - 1) * stride, row * stride) : null;
    for (let index = 0; index < stride; index += 1) {
      const left = index >= bytesPerPixel ? target[index - bytesPerPixel] : 0;
      const up = previous ? previous[index] : 0;
      const upperLeft = previous && index >= bytesPerPixel ? previous[index - bytesPerPixel] : 0;
      const value = source[index];
      target[index] = (
        filter === 0 ? value
          : filter === 1 ? value + left
            : filter === 2 ? value + up
              : filter === 3 ? value + ((left + up) >> 1)
                : value + paethPredictor(left, up, upperLeft)
      ) & 0xff;
    }
  }
  return pixels;
}

function contentBounds(pixels, width, height, bytesPerPixel) {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const alpha = pixels[(y * width + x) * bytesPerPixel + 3];
      if (alpha > ALPHA_THRESHOLD) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) throw new Error('Image is fully transparent.');
  return { minX, minY, maxX, maxY };
}

function encode(pixels, width, height, bytesPerPixel) {
  const stride = width * bytesPerPixel;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let row = 0; row < height; row += 1) {
    raw[row * (stride + 1)] = 0;
    pixels.copy(raw, row * (stride + 1) + 1, row * stride, row * stride + stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const chunk = (type, data) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length, 0);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body) >>> 0, 0);
    return Buffer.concat([length, body, crc]);
  };
  return Buffer.concat([
    PNG_SIGNATURE,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const CRC_TABLE = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

const [source, target] = process.argv.slice(2);
if (!source || !target) throw new Error('Usage: node crop-logo.mjs <source.png> <target.png>');

const chunks = readChunks(readFileSync(source));
const header = chunks.find((item) => item.type === 'IHDR').data;
const width = header.readUInt32BE(0);
const height = header.readUInt32BE(4);
const bitDepth = header[8];
const colorType = header[9];
if (bitDepth !== 8 || colorType !== 6) {
  throw new Error(`Only 8-bit RGBA is supported, got depth ${bitDepth} colour type ${colorType}.`);
}
const bytesPerPixel = 4;
const raw = inflateSync(Buffer.concat(chunks.filter((item) => item.type === 'IDAT').map((item) => item.data)));
const pixels = unfilter(raw, width, height, bytesPerPixel);
const { minX, minY, maxX, maxY } = contentBounds(pixels, width, height, bytesPerPixel);
const croppedWidth = maxX - minX + 1;
const croppedHeight = maxY - minY + 1;
const cropped = Buffer.alloc(croppedWidth * croppedHeight * bytesPerPixel);
for (let y = 0; y < croppedHeight; y += 1) {
  pixels.copy(
    cropped,
    y * croppedWidth * bytesPerPixel,
    ((minY + y) * width + minX) * bytesPerPixel,
    ((minY + y) * width + minX + croppedWidth) * bytesPerPixel,
  );
}
writeFileSync(target, encode(cropped, croppedWidth, croppedHeight, bytesPerPixel));
console.log(`${width}x${height} -> ${croppedWidth}x${croppedHeight} (${target})`);
