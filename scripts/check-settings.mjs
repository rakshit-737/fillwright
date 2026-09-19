/**
 * Fails when a setting exists that nothing uses.
 *
 * Every leaf key of DEFAULT_SETTINGS (src/types/settings.ts) must be read
 * somewhere outside src/types and src/options — declaring a switch and giving
 * it a control is not the same as making it do something. Storage plumbing
 * (settings.ts, which merges and migrates, and portable.ts, which copies the
 * whole record on export) does not count as a use either.
 *
 * A key counts as read when some other source file accesses it as a property
 * (`.theme`) or destructures it (`{ theme }` / `{ theme, …`).
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, dirname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const src = resolve(root, 'src');

const EXCLUDED_DIRS = ['types', 'options'].map((dir) => resolve(src, dir) + sep);
const EXCLUDED_FILES = ['storage/settings.ts', 'profile/portable.ts'].map((file) =>
  resolve(src, file),
);

/**
 * Not settings but onboarding progress, which only the onboarding page (in
 * src/options) has any reason to read. Listed by name so nothing else slips in.
 */
const OPTIONS_ONLY = new Set(['onboardingStep', 'onboardingTriedFill']);

/** Leaf paths of the object literal after `DEFAULT_SETTINGS … = {`. */
export function leafKeys(source) {
  const start = source.indexOf('export const DEFAULT_SETTINGS');
  if (start < 0) throw new Error('DEFAULT_SETTINGS not found');
  const open = source.indexOf('{', source.indexOf('=', start));
  const keys = [];
  const stack = [];
  let depth = 0;
  let pending = null;
  for (let i = open; i < source.length; i += 1) {
    const char = source[i];
    if (char === '{') {
      if (pending) stack.push(pending);
      pending = null;
      depth += 1;
      continue;
    }
    if (char === '}') {
      depth -= 1;
      if (depth === 0) break;
      stack.pop();
      continue;
    }
    const rest = source.slice(i);
    const match = /^([A-Za-z_$][\w$]*)\s*:/.exec(rest);
    if (match && /[\s{,]/.test(source[i - 1] ?? '')) {
      const after = rest.slice(match[0].length).trimStart();
      if (after.startsWith('{')) pending = match[1];
      else keys.push([...stack, match[1]].join('.'));
      i += match[0].length - 1;
    }
  }
  // The version stamp is bookkeeping, not a setting.
  return keys.filter((key) => key !== 'version');
}

function sources(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) sources(path, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(path);
  }
  return out;
}

const escape = (text) => text.replace(/[$]/g, '\\$');

export function unusedKeys(keys, files) {
  return keys.filter((key) => {
    const leaf = escape(key.split('.').pop());
    const read = new RegExp(`\\.${leaf}\\b|[{,]\\s*${leaf}\\s*[,}]`);
    return !files.some((text) => read.test(text));
  });
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const keys = leafKeys(readFileSync(resolve(src, 'types/settings.ts'), 'utf8'));
  const files = sources(src)
    .filter((path) => !EXCLUDED_DIRS.some((dir) => path.startsWith(dir)))
    .filter((path) => !EXCLUDED_FILES.includes(path))
    .map((path) => readFileSync(path, 'utf8'));
  const unused = unusedKeys(
    keys.filter((key) => !OPTIONS_ONLY.has(key)),
    files,
  );
  if (unused.length > 0) {
    console.error(
      `[fillwright] settings that nothing outside src/types and src/options reads:\n  ${unused.join('\n  ')}\nWire each one up, or remove it with a settings migration.`,
    );
    process.exit(1);
  }
  console.log(`[fillwright] check-settings: all ${keys.length} settings are used.`);
}
