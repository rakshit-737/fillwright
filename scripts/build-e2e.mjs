/**
 * Produces `dist-e2e/`: the shipped build plus one test-only change.
 *
 * The end-to-end suite drives headless Chrome, which cannot accept the optional
 * site-access prompt — there is nobody to click it. So the fixture origin is
 * pre-granted in `host_permissions` here instead.
 *
 * This folder is NEVER shipped. `dist/` keeps `host_permissions` empty, and
 * `verify-build.mjs` fails the release build if that ever stops being true, so
 * the test convenience cannot leak into production.
 */
import { cpSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = resolve(root, 'dist');
const target = resolve(root, 'dist-e2e');

if (!existsSync(resolve(dist, 'manifest.json'))) {
  console.error('[fillwright] dist/ is missing — run `npm run build` first.');
  process.exit(1);
}

rmSync(target, { recursive: true, force: true });
cpSync(dist, target, { recursive: true });

const manifestPath = resolve(target, 'manifest.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));

manifest.name = 'Fillwright (end-to-end test build)';
manifest.host_permissions = ['http://127.0.0.1/*', 'http://localhost/*'];

writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

// The shipped panel uses a closed shadow root so page scripts cannot read it.
// The harness drives the panel from the page's world, so the test build — and
// only the test build — reopens it.
const contentPath = resolve(target, 'content.js');
const content = readFileSync(contentPath, 'utf8');
const reopened = content.replace(
  /attachShadow\(\{(\s*)mode:(\s*)(["'])closed\3/,
  'attachShadow({$1mode:$2$3open$3',
);
if (reopened === content) {
  console.error('[fillwright] could not find the closed shadow root in content.js');
  process.exit(1);
}
writeFileSync(contentPath, reopened);

console.log('[fillwright] wrote dist-e2e/ with loopback access pre-granted (test build only)');
