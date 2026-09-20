/**
 * Post-build sanity checks.
 *
 * Chrome reports a broken extension with a terse, unhelpful message and often
 * only at runtime, so the cheap structural mistakes — a manifest pointing at a
 * file the build did not emit, an accidental remote script, a permission that
 * crept in — are caught here instead.
 *
 * Exits non-zero on any failure so it can gate `npm run package`.
 */
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = resolve(root, 'dist');

const problems = [];
const notes = [];

function fail(message) {
  problems.push(message);
}

if (!existsSync(dist)) {
  console.error('[fillwright] dist/ does not exist — run `npm run build` first.');
  process.exit(1);
}

const manifestPath = resolve(dist, 'manifest.json');
if (!existsSync(manifestPath)) fail('manifest.json is missing from dist/');

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));

/* -------------------------------------------------- referenced files exist */

const referenced = new Set();
const addRef = (value) => {
  if (typeof value === 'string' && !value.startsWith('http') && value.includes('.')) {
    referenced.add(value);
  }
};

addRef(manifest.background?.service_worker);
addRef(manifest.action?.default_popup);
addRef(manifest.options_page);
Object.values(manifest.icons ?? {}).forEach(addRef);
Object.values(manifest.action?.default_icon ?? {}).forEach(addRef);
(manifest.web_accessible_resources ?? []).forEach((entry) =>
  (entry.resources ?? []).forEach(addRef),
);
(manifest.content_scripts ?? []).forEach((entry) => {
  (entry.js ?? []).forEach(addRef);
  (entry.css ?? []).forEach(addRef);
});

for (const file of referenced) {
  if (!existsSync(resolve(dist, file))) {
    fail(`manifest references "${file}" but dist/${file} does not exist`);
  }
}

/* --------------------- the injected scripts must be injectable standalone */

// Both are injected with chrome.scripting.executeScript: content.js on
// activation, panel.js when the panel is first opened.
for (const name of ['content.js', 'panel.js']) {
  if (!existsSync(resolve(dist, name))) {
    fail(
      `dist/${name} is missing — the ${name === 'content.js' ? 'content script' : 'panel'} build did not run`,
    );
    continue;
  }
  const source = readFileSync(resolve(dist, name), 'utf8');
  // executeScript cannot resolve ES module imports, so the bundle must be flat.
  if (/^\s*import\s|^\s*export\s/m.test(source)) {
    fail(`${name} contains ES module syntax; it must be a self-contained IIFE`);
  }
  // The panel shows values before the user approves them. A closed shadow root
  // keeps the page's own scripts from reading that preview.
  if (/attachShadow\(\{\s*mode:\s*["'`]open["'`]/.test(source)) {
    fail(`${name} attaches an open shadow root; page scripts could read the preview`);
  }
}

if (existsSync(resolve(dist, 'panel.js'))) {
  const panel = readFileSync(resolve(dist, 'panel.js'), 'utf8');
  if (!/attachShadow\(\{\s*mode:\s*(["'`])closed/.test(panel)) {
    fail('panel.js must attach the panel to a closed shadow root');
  }
}

/* ------------------------------------------------- no remotely hosted code */

const REMOTE_RE = /https?:\/\/(?!localhost)[^"'`\s)]+\.(?:js|mjs|css)\b/gi;
const IMPORT_RE = /\bimport\s*\(\s*['"`]https?:/gi;

function walk(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      walk(path);
      continue;
    }
    if (!/\.(?:js|mjs|html|css)$/.test(name)) continue;
    const source = readFileSync(path, 'utf8');
    const relative = path.slice(dist.length + 1).replace(/\\/g, '/');

    for (const match of source.match(REMOTE_RE) ?? []) {
      fail(`${relative} references remote code: ${match}`);
    }
    if (IMPORT_RE.test(source)) fail(`${relative} performs a remote dynamic import`);
  }
}
walk(dist);

/* ------------------------------------------------------- permission budget */

const ALLOWED_PERMISSIONS = new Set(['storage', 'scripting', 'activeTab']);
for (const permission of manifest.permissions ?? []) {
  if (!ALLOWED_PERMISSIONS.has(permission)) {
    fail(
      `permission "${permission}" is not in the agreed set (${[...ALLOWED_PERMISSIONS].join(', ')}). ` +
        'Add it to ALLOWED_PERMISSIONS here and document it in the Permissions page if it is genuinely needed.',
    );
  }
}

if ((manifest.host_permissions ?? []).length > 0) {
  fail(
    `host_permissions must stay empty — found ${JSON.stringify(manifest.host_permissions)}. ` +
      'Site access is requested at runtime via optional_host_permissions.',
  );
}

for (const host of manifest.optional_host_permissions ?? []) {
  if (host === '<all_urls>') fail('optional_host_permissions must not include <all_urls>');
}

/* ------------------------------------------------------------------- CSP */

const csp = manifest.content_security_policy?.extension_pages ?? '';
if (!/script-src\s+'self'/.test(csp)) fail("CSP must pin script-src to 'self'");
if (!/connect-src\s+'self'/.test(csp)) {
  fail(
    "CSP must pin connect-src to 'self' — this is what makes 'no data leaves the device' enforceable",
  );
}
if (/unsafe-eval|unsafe-inline/.test(csp)) fail('CSP must not allow unsafe-eval or unsafe-inline');

/* ------------------------------------------------------------------ report */

const totalBytes = (function size(dir) {
  return readdirSync(dir).reduce((sum, name) => {
    const path = join(dir, name);
    const info = statSync(path);
    return sum + (info.isDirectory() ? size(path) : info.size);
  }, 0);
})(dist);

notes.push(`bundle size: ${(totalBytes / 1024).toFixed(0)} KB`);
notes.push(`permissions: ${(manifest.permissions ?? []).join(', ') || 'none'}`);
notes.push(
  `optional host permissions: ${(manifest.optional_host_permissions ?? []).join(', ') || 'none'}`,
);

if (problems.length > 0) {
  console.error('\n[fillwright] build verification FAILED:\n');
  for (const problem of problems) console.error(`  ✗ ${problem}`);
  console.error('');
  process.exit(1);
}

console.log('[fillwright] build verified');
for (const note of notes) console.log(`  · ${note}`);
