/**
 * Non-English application forms (test-pages/i18n/<lang>.html).
 *
 * Each fixture states its expected behaviour at the top of the page: labels
 * and name attributes carry no English, so only the locale pack can identify
 * the fields. Ordinary fields fill, the gender question and the referee's
 * email are left alone, and nothing is submitted.
 *
 * Trust note: drives the TEST build only.
 */
import { clickWidgetButton, readWidget, waitForWidget } from './harness.mjs';

export const I18N_LOCALES = ['de', 'fr', 'es', 'pt', 'nl', 'it'];

export async function runI18nSuite(ctx) {
  const { browser, extensionId, server, test, assert, assertEqual, worker, evalInWorker } = ctx;
  const url = (lang) => `${server.origin}/i18n/${lang}.html`;

  const control = await browser.newPage();
  await control.goto(`chrome-extension://${extensionId}/options.html`, {
    waitUntil: 'domcontentloaded',
  });
  const ui = (message) => control.evaluate((m) => chrome.runtime.sendMessage(m), message);
  const state = await ui({ type: 'ui:get-state' });
  const profile = (
    await ui({ type: 'ui:get-profile', profileId: state.data.settings.activeProfileId })
  ).data;
  const P = {
    first: profile.personal.firstName.value,
    last: profile.personal.lastName.value,
    email: profile.personal.email.value,
    phone: profile.personal.phone.value,
  };

  async function activate(tabUrl) {
    return evalInWorker(
      worker,
      `(async () => {
        const [tab] = await chrome.tabs.query({ url: ${JSON.stringify(tabUrl)} });
        if (!tab) return { ok: false };
        const target = { tabId: tab.id };
        await chrome.scripting.executeScript({ target, func: () => { globalThis.__fillwrightActivation = Date.now(); } });
        await chrome.scripting.executeScript({ target, files: ['content.js'] });
        return { ok: true };
      })()`,
    );
  }

  for (const lang of I18N_LOCALES) {
    await test(`i18n/${lang}: locale labels fill; gender and referee stay empty`, async () => {
      const page = await browser.newPage();
      await page.setViewport({ width: 1280, height: 900 });
      await page.goto(url(lang), { waitUntil: 'networkidle0' });
      await activate(url(lang));
      await waitForWidget(page, (s) => s.text.includes('application field'), 15_000);
      assert(await clickWidgetButton(page, 'Fill'), 'no Fill button');
      await waitForWidget(page, (s) => /updated|didn’t accept/.test(s.text), 30_000);

      const got = await page.evaluate(() => ({
        first: document.getElementById('f1').value,
        last: document.getElementById('f2').value,
        email: document.getElementById('f3').value,
        phone: document.getElementById('f4').value,
        gender: document.getElementById('f5').value,
        referee: document.getElementById('f6').value,
        submitted: window.__submitted,
      }));
      const widget = await readWidget(page);
      const context = `\n      ${widget.text}`;
      assertEqual(got.first, P.first, `first name${context}`);
      assertEqual(got.last, P.last, `last name${context}`);
      assertEqual(got.email, P.email, `email${context}`);
      assertEqual(got.phone, P.phone, `phone${context}`);
      assertEqual(got.gender, '', 'the gender question was answered');
      assertEqual(got.referee, '', "the referee's email was filled with the candidate's");
      assertEqual(got.submitted, false, 'submitted');
      await page.close();
    });
  }

  await control.close();
}
