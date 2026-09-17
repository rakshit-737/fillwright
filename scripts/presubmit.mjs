/**
 * Pre-submission check for the Chrome Web Store.
 *
 * Trust boundary: a developer/CI tool. Builds the release zip with
 * `npm run package` (which runs the full check first), then opens the zip and
 * inspects every file in it for things that must never ship.
 *
 *   npm run presubmit
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { unzipSync, strFromU8 } from 'fflate';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
const zipPath = resolve(root, 'release', `fillwright-${pkg.version}.zip`);

if (!process.argv.includes('--no-build')) {
  const run = spawnSync('npm run package', { cwd: root, stdio: 'inherit', shell: true });
  if (run.status !== 0) {
    console.error('\n[presubmit] npm run package failed.');
    process.exit(1);
  }
}

const files = unzipSync(readFileSync(zipPath));
const names = Object.keys(files).sort();
const problems = [];
const notes = [];
const fail = (message) => problems.push(message);

const text = (name) => strFromU8(files[name]);
const isText = (name) => /\.(?:m?js|html|css|json|txt|svg)$/.test(name);

/* --- structure ------------------------------------------------------ */

const manifest = JSON.parse(text('manifest.json'));
if (manifest.manifest_version !== 3) fail('manifest_version is not 3');
if (manifest.version !== pkg.version) {
  fail(`manifest version ${manifest.version} does not match package.json ${pkg.version}`);
}
if ((manifest.host_permissions ?? []).length) fail('host_permissions is not empty');
if (manifest.optional_permissions?.length) {
  fail(`unexpected optional permissions: ${manifest.optional_permissions.join(', ')}`);
}
const allowedPermissions = ['storage', 'scripting', 'activeTab'];
for (const permission of manifest.permissions ?? []) {
  if (!allowedPermissions.includes(permission)) fail(`unexpected permission: ${permission}`);
}
const allowedOptionalHosts = ['https://*/*', 'http://localhost/*', 'http://127.0.0.1/*'];
for (const host of manifest.optional_host_permissions ?? []) {
  if (!allowedOptionalHosts.includes(host)) fail(`unexpected optional host permission: ${host}`);
}
const csp = manifest.content_security_policy?.extension_pages ?? '';
if (csp !== "script-src 'self'; object-src 'self'; connect-src 'self'") {
  fail(`extension CSP changed: ${csp}`);
}
if (manifest.web_accessible_resources?.length) fail('web_accessible_resources must stay absent');
if (manifest.externally_connectable) fail('externally_connectable must stay absent');

for (const required of [
  'background.js',
  'content.js',
  'popup.html',
  'options.html',
  'practice.html',
]) {
  if (!files[required]) fail(`missing ${required}`);
}

/* --- things that must never ship -------------------------------------- */

for (const name of names) {
  if (/\.map$/.test(name)) fail(`source map in package: ${name}`);
  if (/perf-probe|test-pages|dist-e2e|\.test\./.test(name)) fail(`test file in package: ${name}`);
  if (!isText(name)) continue;
  const body = text(name);

  if (/sourceMappingURL=/.test(body)) fail(`${name} references a source map`);
  if (/__fwPerf|end-to-end test build|FW_SOURCE_DIST/.test(body)) {
    fail(`${name} contains test-only code`);
  }
  if (/attachShadow\(\{\s*mode:\s*["'`]open/.test(body)) {
    fail(`${name} attaches an OPEN shadow root (test build leaked)`);
  }

  // Remote code and remote fetches. Plain URLs in comments, licences, XML
  // namespaces and user-facing links are fine; loading anything is not.
  if (/import\(\s*["']https?:/.test(body) || /<script[^>]+src=["']https?:/i.test(body)) {
    fail(`${name} loads remote code`);
  }
  if (/(?:fetch|importScripts)\(\s*["']https?:/.test(body)) fail(`${name} fetches a remote URL`);
  if (/<link[^>]+href=["']https?:/i.test(body)) fail(`${name} loads a remote stylesheet`);

  // eval-like constructs. pdf.js carries `new Function` behind its
  // isEvalSupported switch, which Fillwright turns off; the CSP forbids eval
  // regardless. Anything else is a failure.
  const evalish = body.match(/\beval\(|new Function\(/g) ?? [];
  if (evalish.length) {
    const pdfjs = /pdf/.test(name) && /isEvalSupported/.test(body);
    if (pdfjs)
      notes.push(
        `${name}: ${evalish.length} eval-like construct(s) inside pdf.js, disabled (isEvalSupported: false) and blocked by CSP`,
      );
    else fail(`${name} contains ${evalish.join(', ')}`);
  }
}

const content = text('content.js');
if (!/attachShadow\(\{\s*mode:\s*(["'`])closed/.test(content)) {
  fail('content.js does not use a closed shadow root');
}
const contentKB = files['content.js'].length / 1024;
if (contentKB > 100) fail(`content.js is ${contentKB.toFixed(1)} KB (budget 100 KB)`);

const zipMB = statSync(zipPath).size / (1024 * 1024);
if (zipMB > 10) fail(`package is ${zipMB.toFixed(1)} MB`);

/* --- report ----------------------------------------------------------- */

console.log(`\n[presubmit] ${zipPath}`);
console.log(
  `  ${names.length} files, ${zipMB.toFixed(2)} MB, content.js ${contentKB.toFixed(1)} KB`,
);
for (const note of notes) console.log(`  note: ${note}`);
if (problems.length) {
  console.error(`\n[presubmit] ${problems.length} problem(s):`);
  for (const problem of problems) console.error(`  ✗ ${problem}`);
  process.exit(1);
}
console.log('  ✓ nothing disallowed found');
