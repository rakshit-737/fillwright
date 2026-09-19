/**
 * Produces the zip that gets uploaded to the Chrome Web Store.
 *
 * Trust boundary: a developer/CI tool.
 *
 * Runs only after `npm run check` has passed (typecheck, lint, tests, build,
 * and the structural verification in verify-build.mjs), so a package that
 * exists is one that has been checked.
 *
 * The zip is reproducible: sorted entries, one fixed timestamp taken from
 * SOURCE_DATE_EPOCH or the last commit, fixed deflate settings (see
 * scripts/lib/zip.mjs). The SHA-256 is printed and written to
 * release/SHA256SUMS so anyone can rebuild a tag and compare.
 *
 *   node scripts/package.mjs [--out <dir>]
 */
import { readFileSync, readdirSync, statSync, mkdirSync, existsSync, writeFileSync } from 'node:fs';
import { resolve, dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { buildZip, resolveEpoch } from './lib/zip.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = resolve(root, 'dist');
const outFlag = process.argv.indexOf('--out');
const outDir = outFlag > -1 ? resolve(process.argv[outFlag + 1]) : resolve(root, 'release');

if (!existsSync(dist)) {
  console.error('[fillwright] dist/ is missing — run `npm run build` first.');
  process.exit(1);
}

const manifest = JSON.parse(readFileSync(resolve(dist, 'manifest.json'), 'utf8'));
const outName = `fillwright-${manifest.version}.zip`;

function collect(dir, base = dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory()
      ? collect(path, base)
      : [{ name: relative(base, path).replace(/\\/g, '/'), data: readFileSync(path) }];
  });
}

const epoch = resolveEpoch(process.env, () =>
  execFileSync('git', ['log', '-1', '--format=%ct'], { cwd: root, encoding: 'utf8' }),
);

const entries = collect(dist);
const zip = buildZip(entries, epoch);
const sha256 = createHash('sha256').update(zip).digest('hex');

mkdirSync(outDir, { recursive: true });
const target = resolve(outDir, outName);
writeFileSync(target, zip);
writeFileSync(resolve(outDir, 'SHA256SUMS'), `${sha256}  ${outName}\n`);

console.log(`[fillwright] packaged ${entries.length} files`);
console.log(`  · ${relative(root, target)} (${(zip.length / 1024).toFixed(0)} KB)`);
console.log(`  · version ${manifest.version}, timestamp ${new Date(epoch * 1000).toISOString()}`);
console.log(`  · SHA-256 ${sha256}`);
