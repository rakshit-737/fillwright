/**
 * Produces the zip that gets uploaded to the Chrome Web Store.
 *
 * Runs only after `npm run check` has passed (typecheck, lint, tests, build,
 * and the structural verification in verify-build.mjs), so a package that
 * exists is one that has been checked.
 */
import { createWriteStream, readFileSync, readdirSync, statSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateRawSync, crc32 } from 'node:zlib';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = resolve(root, 'dist');
const outDir = resolve(root, 'release');

if (!existsSync(dist)) {
  console.error('[fillwright] dist/ is missing — run `npm run build` first.');
  process.exit(1);
}

const manifest = JSON.parse(readFileSync(resolve(dist, 'manifest.json'), 'utf8'));
const outName = `fillwright-${manifest.version}.zip`;

/* ------------------------------------------------------------ zip writing */

function collect(dir, base = dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory()
      ? collect(path, base)
      : [{ path, name: relative(base, path).replace(/\\/g, '/') }];
  });
}

function dosTime(date) {
  const time = ((date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() / 2)) & 0xffff;
  const day = (((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()) & 0xffff;
  return { time, day };
}

/**
 * Minimal ZIP writer. A store upload is a handful of small files, and writing
 * the container directly avoids adding an archiver dependency to a project
 * whose whole point is a small, auditable dependency tree.
 */
function writeZip(entries, target) {
  const chunks = [];
  const central = [];
  let offset = 0;
  const { time, day } = dosTime(new Date());

  for (const entry of entries) {
    const data = readFileSync(entry.path);
    const compressed = deflateRawSync(data, { level: 9 });
    const crc = crc32(data);
    const nameBytes = Buffer.from(entry.name, 'utf8');

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(day, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    local.writeUInt16LE(0, 28);

    chunks.push(local, nameBytes, compressed);

    const header = Buffer.alloc(46);
    header.writeUInt32LE(0x02014b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(20, 6);
    header.writeUInt16LE(0, 8);
    header.writeUInt16LE(8, 10);
    header.writeUInt16LE(time, 12);
    header.writeUInt16LE(day, 14);
    header.writeUInt32LE(crc, 16);
    header.writeUInt32LE(compressed.length, 20);
    header.writeUInt32LE(data.length, 24);
    header.writeUInt16LE(nameBytes.length, 28);
    header.writeUInt32LE(0, 38);
    header.writeUInt32LE(offset, 42);
    central.push(header, nameBytes);

    offset += local.length + nameBytes.length + compressed.length;
  }

  const centralBuffer = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBuffer.length, 12);
  end.writeUInt32LE(offset, 16);

  const stream = createWriteStream(target);
  for (const chunk of [...chunks, centralBuffer, end]) stream.write(chunk);
  stream.end();
  return new Promise((done) => stream.on('close', done));
}

const entries = collect(dist);
mkdirSync(outDir, { recursive: true });
const target = resolve(outDir, outName);
await writeZip(entries, target);

const size = statSync(target).size;
console.log(`[fillwright] packaged ${entries.length} files`);
console.log(`  · ${relative(root, target)} (${(size / 1024).toFixed(0)} KB)`);
console.log(`  · version ${manifest.version}`);
