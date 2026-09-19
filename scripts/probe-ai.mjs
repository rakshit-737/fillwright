/**
 * Reports where Chrome's on-device Prompt API is exposed in the browser the
 * end-to-end suite drives: the extension service worker, an extension page,
 * an offscreen document, and an ordinary web page.
 *
 * Trust boundary: a developer diagnostic. It loads the test build, calls only
 * the availability check (never a prompt), and prints the result.
 */
import { launch, evalInWorker } from '../tests/e2e/harness.mjs';

const PROBE = `(async () => {
  const scope = globalThis;
  const api = scope.LanguageModel ?? scope.ai?.languageModel ?? scope.ai?.assistant;
  const out = {
    LanguageModel: typeof scope.LanguageModel,
    ai: typeof scope.ai,
    api: Boolean(api),
  };
  const languages = {
    expectedInputs: [{ type: 'text', languages: ['en'] }],
    expectedOutputs: [{ type: 'text', languages: ['en'] }],
  };
  if (api && typeof api.availability === 'function') {
    try { out.availability = await api.availability(); } catch (e) { out.availability = 'threw: ' + e.message; }
    try { out.availabilityEnglish = await api.availability(languages); } catch (e) { out.availabilityEnglish = 'threw: ' + e.message; }
  } else if (api && typeof api.capabilities === 'function') {
    try { out.availability = (await api.capabilities()).available; } catch (e) { out.availability = 'threw: ' + e.message; }
  }
  // The state Fillwright's options page would show (src/ai/provider.ts).
  const raw = out.availabilityEnglish ?? out.availability;
  out.fillwrightState = !api
    ? 'unavailable'
    : raw === 'available' || raw === 'readily'
      ? 'ready'
      : raw === 'downloadable' || raw === 'after-download'
        ? 'downloadable (offers "Download the on-device model")'
        : raw === 'downloading'
          ? 'downloading (shows progress)'
          : raw === undefined
            ? 'ready (no availability check)'
            : 'unavailable';
  return out;
})()`;

const { browser, worker, extensionId } = await launch({ headless: process.env.HEADED !== '1' });
try {
  const version = await browser.version();
  const results = { chrome: version };
  results.serviceWorker = await evalInWorker(worker, PROBE);

  const page = await browser.newPage();
  await page.goto(`chrome-extension://${extensionId}/options.html`, {
    waitUntil: 'domcontentloaded',
  });
  results.extensionPage = await page.evaluate(PROBE);

  const web = await browser.newPage();
  await web.goto('about:blank');
  results.aboutBlank = await web.evaluate(PROBE);

  console.log(JSON.stringify(results, null, 2));
} finally {
  await browser.close();
}
