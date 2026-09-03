// Generates PWA icons as PNGs using only Node built-ins (zlib).
// Usage: node scripts/gen-icons.js
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'images', 'icons');

function crc32(buf) {
  let table = crc32.table;
  if (!table) {
    table = crc32.table = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c;
    }
  }
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = table[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/** colorFn(x, y) -> [r,g,b,a], coordinates in [0,1]. */
function png(size, colorFn) {
  const rows = [];
  for (let y = 0; y < size; y++) {
    const row = Buffer.alloc(1 + size * 4);
    row[0] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = colorFn((x + 0.5) / size, (y + 0.5) / size);
      row[1 + x * 4] = r;
      row[2 + x * 4 + 1] = g;
      row[3 + x * 4 + 2] = b;
      row[4 + x * 4 + 3] = a;
    }
    rows.push(row);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // RGBA
  const idat = zlib.deflateSync(Buffer.concat(rows), { level: 9 });
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

const GREEN = [30, 154, 111]; // matches --green-500
const WHITE = [255, 255, 255];

function makeIcon(size) {
  const r = size * 0.17; // corner radius
  return png(size, (x, y) => {
    // rounded-square alpha
    const cx = Math.min(Math.max(x, r / size), 1 - r / size);
    const cy = Math.min(Math.max(y, r / size), 1 - r / size);
    const dx = x - cx, dy = y - cy;
    const dist = Math.hypot(dx, dy);
    const inside = dist <= r / size ? 1 : (x > r / size && x < 1 - r / size) || (y > r / size && y < 1 - r / size) ? 1 : 0;
    const alpha = inside;
    // ring + center dot
    const c = Math.hypot(x - 0.5, y - 0.5);
    const inRing = c >= 0.24 && c <= 0.365;
    const inDot = c <= 0.115;
    const col = inRing || inDot ? WHITE : GREEN;
    return [...col, Math.round(alpha * 255)];
  });
}

fs.mkdirSync(OUT, { recursive: true });
const jobs = [
  ['icon-192.png', 192],
  ['icon-512.png', 512],
  ['apple-touch-icon-180.png', 180]
];
for (const [name, size] of jobs) {
  fs.writeFileSync(path.join(OUT, name), makeIcon(size));
  console.log('✓', path.join(OUT, name));
}
