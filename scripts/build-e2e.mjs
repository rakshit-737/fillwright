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
import { build } from 'vite';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// Overridable so a before/after perf run can package an older build.
const dist = process.env.FW_SOURCE_DIST
  ? resolve(process.env.FW_SOURCE_DIST)
  : resolve(root, 'dist');
const target = process.env.FW_E2E_OUT ? resolve(process.env.FW_E2E_OUT) : resolve(root, 'dist-e2e');

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
const alreadyOpen = /attachShadow\(\{\s*mode:\s*["']open/.test(content);
if (reopened === content && !(process.env.FW_SOURCE_DIST && alreadyOpen)) {
  // Only an older build measured for comparison may already be open.
  console.error('[fillwright] could not find the closed shadow root in content.js');
  process.exit(1);
}
writeFileSync(contentPath, reopened);

console.log('[fillwright] wrote dist-e2e/ with loopback access pre-granted (test build only)');

// The performance probe (tests/perf/probe.ts) is test-only code, bundled here
// and nowhere else.
const probeRoot = process.env.FW_PROBE_SRC
  ? resolve(process.env.FW_PROBE_SRC)
  : resolve(root, 'src');
await build({
  configFile: false,
  logLevel: 'warn',
  // Without this, Vite copies public/manifest.json over the test manifest.
  publicDir: false,
  resolve: {
    alias: [
      // The observer module is standalone, so a before/after run can measure
      // an older source tree with the current probe.
      { find: '@/content/observe', replacement: resolve(root, 'src/content/observe.ts') },
      { find: '@', replacement: probeRoot },
    ],
  },
  build: {
    outDir: target,
    emptyOutDir: false,
    sourcemap: false,
    target: 'chrome116',
    lib: {
      entry: resolve(root, 'tests/perf/probe.ts'),
      formats: ['iife'],
      name: '__fillwrightPerf__',
      fileName: () => 'perf-probe.js',
    },
  },
});
console.log('[fillwright] wrote dist-e2e/perf-probe.js (test build only)');
