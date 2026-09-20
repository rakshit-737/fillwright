/**
 * Performance budget, measured in Chrome for Testing.
 *
 * Trust boundary: a developer/CI tool. Drives the TEST build (dist-e2e, with
 * the test-only perf probe) against local fixtures; reads only timings.
 *
 *   npm run perf                 measure, compare with budgets, exit 1 if over
 *   FW_DIST=<dir> node scripts/perf.mjs --no-budget   measure another build
 *
 * Budgets:
 *   content.js (shipped)                ≤ 100 KB (the panel and the review list
 *                                       live in panel.js, injected on first
 *                                       open, and are not counted here)
 *   inject content.js, 50-field form    < 50 ms  (median of 7)
 *   harvest + classify, hard-mode.html  < 120 ms (median of 9)
 *   MutationObserver callback           < 2 ms   (2,000-node burst)
 */
import { statSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch, evalInWorker, DIST } from '../tests/e2e/harness.mjs';
import { startServer } from '../tests/e2e/server.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const enforce = !process.argv.includes('--no-budget');

const BUDGET = {
  bundleKB: 100,
  injectMs: 50,
  harvestMs: 120,
  observerMs: 2,
};

const shipped = resolve(process.env.FW_SHIPPED_DIST ?? resolve(root, 'dist'), 'content.js');
const results = {
  chrome: '',
  bundleKB: 0,
  injectMs: 0,
  harvestMs: 0,
  observerMs: 0,
  observerLegacyMs: 0,
};
results.bundleKB = existsSync(shipped)
  ? Math.round((statSync(shipped).size / 1024) * 10) / 10
  : NaN;

const server = await startServer(resolve(root, 'test-pages'));
const { browser, worker } = await launch({ headless: true });

const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

async function inWorker(tabUrl, body) {
  return evalInWorker(
    worker,
    `(async () => {
      const [tab] = await chrome.tabs.query({ url: ${JSON.stringify(tabUrl)} });
      if (!tab) throw new Error('tab not found: ${tabUrl}');
      ${body}
    })()`,
  );
}

try {
  results.chrome = await browser.version();

  // Injection: parse + evaluate + synchronous boot, on a fresh page each time.
  const injectTimes = [];
  for (let run = 0; run < 7; run += 1) {
    const page = await browser.newPage();
    const url = `${server.origin}/perf-fifty.html?run=${run}`;
    await page.goto(url, { waitUntil: 'load' });
    injectTimes.push(
      await inWorker(
        url,
        `const start = performance.now();
         await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
         return performance.now() - start;`,
      ),
    );
    await page.close();
  }
  results.injectMs = round(median(injectTimes));

  // Harvest + classify on the large form, inside the extension's world.
  const hard = await browser.newPage();
  const hardUrl = `${server.origin}/hard-mode.html`;
  await hard.goto(hardUrl, { waitUntil: 'load' });
  await inWorker(
    hardUrl,
    `await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['perf-probe.js'] }); return true;`,
  );
  results.harvestMs = round(
    await inWorker(
      hardUrl,
      `const [r] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => globalThis.__fwPerf.harvestClassify(9) });
       return r.result;`,
    ),
  );
  const observer = await inWorker(
    hardUrl,
    `const [r] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => globalThis.__fwPerf.observer(2000) });
     return r.result;`,
  );
  results.observerMs = round(observer.current);
  results.observerLegacyMs = round(observer.legacy);
  await hard.close();
} finally {
  await browser.close();
  await server.close();
}

const rows = [
  ['content.js size (KB)', results.bundleKB, BUDGET.bundleKB],
  ['inject, 50-field form (ms)', results.injectMs, BUDGET.injectMs],
  ['harvest + classify, hard-mode (ms)', results.harvestMs, BUDGET.harvestMs],
  ['observer callback, 2k nodes (ms)', results.observerMs, BUDGET.observerMs],
];

console.log(`\nFillwright performance — ${results.chrome} — build: ${DIST}`);
for (const [name, value, budget] of rows) {
  const flag = value <= budget ? 'ok  ' : 'OVER';
  console.log(`  ${flag}  ${name.padEnd(38)} ${String(value).padStart(8)}   budget ${budget}`);
}
console.log(`        v0.4.0 observer check, same burst (ms)  ${results.observerLegacyMs}`);
console.log(`\n${JSON.stringify(results)}`);

const over = rows.filter(([, value, budget]) => !(value <= budget));
if (enforce && over.length) {
  console.error(`\n${over.length} measurement(s) over budget.`);
  process.exit(1);
}

function round(value) {
  return Math.round(value * 100) / 100;
}
