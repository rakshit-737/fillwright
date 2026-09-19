import puppeteer from 'puppeteer';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
/** The Workday-shaped hostname the passive-scan test visits. */
export const ATS_TEST_HOST = 'acme.myworkdayjobs.com';

export const DIST = process.env.FW_DIST ? resolve(process.env.FW_DIST) : resolve(root, 'dist-e2e');

/**
 * Resolves the browser to drive.
 *
 * Chrome for Testing (downloaded by puppeteer) is the default, because stable
 * Chrome removed support for `--load-extension` in M137 — an unpacked extension
 * simply will not load there, which makes stable Chrome unusable for this
 * harness. CHROME_PATH overrides it for anyone on a build that still allows it.
 */
export async function findChrome() {
  if (process.env.CHROME_PATH && existsSync(process.env.CHROME_PATH)) {
    return process.env.CHROME_PATH;
  }
  // Puppeteer 25 resolves the downloaded browser asynchronously.
  return await puppeteer.executablePath();
}

/**
 * Launches Chrome with the built extension loaded.
 *
 * This is the validation jsdom cannot provide: a genuine extension runtime, a
 * real service worker, real shadow DOM, real CSP enforcement, and the browser's
 * own event plumbing.
 */
export async function launch({ headless = true } = {}) {
  if (!existsSync(resolve(DIST, 'manifest.json'))) {
    throw new Error('dist/manifest.json is missing — run `npm run build` first.');
  }

  const browser = await puppeteer.launch({
    executablePath: await findChrome(),
    // The current headless mode loads extensions; the old one could not.
    headless,
    args: [
      `--disable-extensions-except=${DIST}`,
      `--load-extension=${DIST}`,
      '--no-first-run',
      '--no-default-browser-check',
      // A real ATS hostname, mapped onto the local HTTPS fixture server, so
      // site adapters run in the test exactly as they would on the real site.
      // The certificate is a throwaway self-signed one; this browser is a test
      // browser and nothing else.
      `--host-resolver-rules=MAP ${ATS_TEST_HOST} 127.0.0.1`,
      '--ignore-certificate-errors',
      // Needed in containerised CI; harmless locally.
      process.env.CI ? '--no-sandbox' : null,
    ].filter(Boolean),
  });

  const worker = await waitForServiceWorker(browser);
  const extensionId = new URL(worker.url()).host;

  return { browser, worker, extensionId };
}

async function waitForServiceWorker(browser, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;

  for (;;) {
    const target = browser
      .targets()
      .find(
        (candidate) =>
          candidate.type() === 'service_worker' && candidate.url().includes('background.js'),
      );
    if (target) return target;

    if (Date.now() > deadline) {
      throw new Error(
        'The extension service worker did not start within 20s. ' +
          'Stable Chrome 137 and later cannot load unpacked extensions; use Chrome for Testing.',
      );
    }
    await new Promise((done) => setTimeout(done, 150));
  }
}

/** Evaluates an expression inside the service worker and returns its value. */
export async function evalInWorker(worker, expression) {
  const client = await worker.createCDPSession();
  try {
    const { result, exceptionDetails } = await client.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (exceptionDetails) {
      throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text);
    }
    return result.value;
  } finally {
    await client.detach().catch(() => undefined);
  }
}

/**
 * Grants the extension access to the fixture origin, exactly as a user does.
 *
 * `chrome.permissions.request` requires a genuine user gesture, and a service
 * worker can never have one. So this opens an extension page, adds a button,
 * and clicks it with a real input event — the same sequence as a person
 * approving the optional site-access prompt. No permission check is bypassed;
 * the gesture Chrome demands is simply supplied.
 */
export async function grantOrigin(browser, extensionId, origin) {
  const page = await browser.newPage();
  await page.goto(`chrome-extension://${extensionId}/options.html`, {
    waitUntil: 'domcontentloaded',
  });

  await page.evaluate((target) => {
    const button = document.createElement('button');
    button.id = 'fw-e2e-grant';
    button.textContent = 'grant';
    button.style.cssText = 'position:fixed;top:0;left:0;z-index:99999';
    button.addEventListener('click', () => {
      chrome.permissions.request({ origins: [target + '/*'] }).then(
        (granted) => {
          window.__granted = granted;
        },
        (error) => {
          window.__granted = 'error: ' + error.message;
        },
      );
    });
    document.body.appendChild(button);
  }, origin);

  await page.click('#fw-e2e-grant');
  await page.waitForFunction(() => window.__granted !== undefined, { timeout: 10_000 });
  const granted = await page.evaluate(() => window.__granted);
  await page.close();

  if (granted !== true) throw new Error(`Site access was not granted: ${granted}`);
  return granted;
}

/** Reads the Fillwright panel out of the page's shadow root. */
export async function readWidget(page) {
  return page.evaluate(() => {
    const host = document.querySelector('[data-fillwright-widget]');
    if (!host || !host.shadowRoot) return null;
    const panel = host.shadowRoot.querySelector('.fw-widget');
    if (!panel) return null;
    return {
      text: (panel.textContent || '').replace(/\s+/g, ' ').trim(),
      buttons: Array.from(panel.querySelectorAll('button')).map((button) =>
        (button.textContent || '').trim(),
      ),
      items: Array.from(panel.querySelectorAll('.fw-item')).map((item) => {
        const label = item.querySelector('.fw-item__label');
        const value = item.querySelector('.fw-item__new');
        const badge = item.querySelector('.fw-badge');
        return {
          label: label ? label.textContent.trim() : '',
          value: value ? value.textContent.trim() : '',
          badge: badge ? badge.textContent.trim() : '',
        };
      }),
    };
  });
}

/**
 * Clicks elements with real (trusted) input: puppeteer moves the mouse and
 * presses it through the DevTools protocol, exactly as a person would. The
 * panel ignores `element.click()` from page script — `isTrusted` is false —
 * so every test that drives the panel goes through here.
 *
 * `finder` runs in the page (or frame) and returns an element, an array of
 * elements, or null. A panel button that is not armed yet (aria-disabled) is
 * waited for first.
 */
export async function trustedClick(target, finder, ...args) {
  const handle = await target.evaluateHandle(finder, ...args);
  const list = [];
  const single = handle.asElement();
  if (single) list.push(single);
  else {
    const props = await handle.getProperties().catch(() => new Map());
    for (const value of props.values()) {
      const element = value.asElement();
      if (element) list.push(element);
    }
  }
  for (const element of list) {
    await element
      .evaluate(
        (node) =>
          new Promise((done) => {
            const deadline = Date.now() + 5_000;
            const tick = () => {
              if (node.getAttribute('aria-disabled') !== 'true' || Date.now() > deadline) done();
              else setTimeout(tick, 50);
            };
            tick();
          }),
      )
      .catch(() => undefined);
    await element.click();
  }
  return list.length > 0;
}

/** Clicks a button in the panel by its visible label. */
export async function clickWidgetButton(page, label) {
  return trustedClick(
    page,
    (wanted) => {
      const host = document.querySelector('[data-fillwright-widget]');
      if (!host || !host.shadowRoot) return null;
      const buttons = Array.from(host.shadowRoot.querySelectorAll('button'));
      return (
        buttons.find((candidate) => (candidate.textContent || '').trim().startsWith(wanted)) ?? null
      );
    },
    label,
  );
}

export async function waitForWidget(page, predicate, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const widget = await readWidget(page);
    if (widget && predicate(widget)) return widget;
    if (Date.now() > deadline) {
      throw new Error(`Timed out waiting for the panel. Last state: ${JSON.stringify(widget)}`);
    }
    await new Promise((done) => setTimeout(done, 250));
  }
}

export const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
