/**
 * Generates the Fillwright toolbar icons as PNGs.
 *
 * Written by hand with zlib + a CRC table rather than pulling an image library:
 * the icons are four flat shapes, and this keeps the dependency tree small.
 *
 * The mark is a rounded indigo square holding a light "nib" wedge — a writing
 * tool, for an extension that writes forms.
 */
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../public/icons');

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function encodePng(size, pixels) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // RGBA
  // Each scanline is prefixed with filter type 0 (none).
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    const rowStart = y * (size * 4 + 1);
    raw[rowStart] = 0;
    pixels.copy(raw, rowStart + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Signed distance to a rounded rectangle, used for anti-aliased edges. */
function roundedRectDistance(x, y, halfW, halfH, radius) {
  const dx = Math.abs(x) - (halfW - radius);
  const dy = Math.abs(y) - (halfH - radius);
  const outside = Math.hypot(Math.max(dx, 0), Math.max(dy, 0));
  return outside + Math.min(Math.max(dx, dy), 0) - radius;
}

function mix(a, b, t) {
  return a + (b - a) * t;
}

function render(size) {
  const pixels = Buffer.alloc(size * size * 4);
  const center = size / 2;
  const pad = size * 0.06;
  const half = center - pad;
  const radius = size * 0.26;
  // Sub-pixel sampling keeps the small sizes from looking ragged.
  const samples = 3;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;

      for (let sy = 0; sy < samples; sy++) {
        for (let sx = 0; sx < samples; sx++) {
          const px = x + (sx + 0.5) / samples - center;
          const py = y + (sy + 0.5) / samples - center;

          const outside = roundedRectDistance(px, py, half, half, radius);
          if (outside > 0) continue;

          // Diagonal gradient from indigo to a warm rose.
          const t = Math.min(1, Math.max(0, (px + py) / (2 * half) / 2 + 0.5));
          let cr = mix(0x4b, 0xc2, t);
          let cg = mix(0x3e, 0x62, t);
          let cb = mix(0xcf, 0x9a, t);

          // Three knocked-out bars: a form, with the last one still to fill.
          const nx = px / half;
          const ny = py / half;
          const barHeight = 0.13;
          const bars = [
            { y: -0.4, width: 0.98 },
            { y: -0.04, width: 0.72 },
            { y: 0.32, width: 0.44 },
          ];
          const onBar = bars.some(
            (bar) =>
              Math.abs(ny - bar.y) < barHeight &&
              nx > -0.56 &&
              nx < -0.56 + bar.width &&
              // Round the bar ends so they do not read as hard slabs.
              roundedRectDistance(
                nx - (-0.56 + bar.width / 2),
                ny - bar.y,
                bar.width / 2,
                barHeight,
                barHeight,
              ) < 0,
          );
          if (onBar) {
            cr = 0xfb;
            cg = 0xfa;
            cb = 0xf8;
          }

          r += cr;
          g += cg;
          b += cb;
          a += 255;
        }
      }

      const total = samples * samples;
      const offset = (y * size + x) * 4;
      if (a > 0) {
        const covered = a / (total * 255);
        pixels[offset] = Math.round(r / total / covered);
        pixels[offset + 1] = Math.round(g / total / covered);
        pixels[offset + 2] = Math.round(b / total / covered);
        pixels[offset + 3] = Math.round(a / total);
      }
    }
  }

  return encodePng(size, pixels);
}

mkdirSync(OUT_DIR, { recursive: true });
for (const size of [16, 32, 48, 128]) {
  writeFileSync(resolve(OUT_DIR, `icon-${size}.png`), render(size));
}
console.log(`[fillwright] wrote icons to ${OUT_DIR}`);
