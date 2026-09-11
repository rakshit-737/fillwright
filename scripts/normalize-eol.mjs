/**
 * Normalises text files to LF.
 *
 * Mixed line endings are not merely cosmetic here: they defeat exact-match
 * tooling, produce diffs full of phantom changes, and make review harder. The
 * repository is LF-only, enforced by .gitattributes; this fixes anything that
 * slipped through.
 */
import { readdirSync, statSync, readFileSync, writeFileSync } from 'node:fs';
import { join, extname, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const TEXT = new Set([
  '.ts', '.tsx', '.js', '.mjs', '.cjs', '.json', '.css', '.html', '.md', '.yml', '.yaml', '.txt',
]);
const SKIP = new Set(['node_modules', 'dist', 'dist-e2e', 'release', '.git', 'coverage']);

let changed = 0;

function walk(dir) {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      walk(path);
      continue;
    }
    if (!TEXT.has(extname(name))) continue;

    const before = readFileSync(path, 'utf8');
    if (!before.includes('\r')) continue;
    writeFileSync(path, before.replace(/\r\n/g, '\n'), 'utf8');
    changed++;
  }
}

walk(root);
console.log(`[fillwright] normalised ${changed} file${changed === 1 ? '' : 's'} to LF`);
