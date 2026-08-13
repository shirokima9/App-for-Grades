// يولّد أيقونات PWA (PNG) محليًا بدون أي اعتمادية خارجية.
import zlib from 'zlib';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(ROOT, 'client', 'public', 'icons');
fs.mkdirSync(OUT_DIR, { recursive: true });

function crc32(buf) {
  let c, table = [];
  for (let n = 0; n < 256; n++) {
    c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  let crc = 0xffffffff;
  for (const b of buf) crc = table[(crc ^ b) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

// أيقونة: مربع أخضر مزرق وفي وسطه مربع أبيض يشبه ورقة درجات
function makeIcon(size) {
  const px = Buffer.alloc(size * (size * 4 + 1));
  const teal = [15, 118, 110], white = [255, 255, 255], line = [45, 212, 191];
  const inset = Math.floor(size * 0.22), lineH = Math.max(2, Math.floor(size * 0.05));
  for (let y = 0; y < size; y++) {
    const rowStart = y * (size * 4 + 1);
    px[rowStart] = 0; // فلتر
    for (let x = 0; x < size; x++) {
      let c = teal;
      const inPaper = x >= inset && x < size - inset && y >= inset && y < size - inset;
      if (inPaper) {
        c = white;
        const rel = y - inset;
        const step = Math.floor((size - 2 * inset) / 4);
        if (rel > step && rel % step < lineH && x > inset + step / 2 && x < size - inset - step / 2) c = line;
      }
      const o = rowStart + 1 + x * 4;
      px[o] = c[0]; px[o + 1] = c[1]; px[o + 2] = c[2]; px[o + 3] = 255;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(px)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

for (const size of [192, 512]) {
  fs.writeFileSync(path.join(OUT_DIR, `icon-${size}.png`), makeIcon(size));
  console.log(`icon-${size}.png ✓`);
}
