/**
 * Profile editor polish, in real Chrome: inline checks, bulk skills, the
 * autofill preview, keyboard reordering, the failed-save leave guard, and
 * the optional history's "last used".
 *
 * Trust note: drives the TEST build only.
 */
import { sleep, waitForWidget, clickWidgetButton } from './harness.mjs';

export async function runEditorSuite(ctx) {
  const { browser, extensionId, server, test, assert, assertEqual, worker, evalInWorker } = ctx;
  const options = (route) => `chrome-extension://${extensionId}/options.html#/${route}`;

  const control = await browser.newPage();
  await control.goto(options('privacy'), { waitUntil: 'domcontentloaded' });
  const ui = (message) => control.evaluate((m) => chrome.runtime.sendMessage(m), message);
  const activeProfile = async () => {
    const state = await ui({ type: 'ui:get-state' });
    return (await ui({ type: 'ui:get-profile', profileId: state.data.settings.activeProfileId }))
      .data;
  };

  const inputByLabel = (page, label) =>
    page.evaluateHandle((l) => {
      const node = Array.from(document.querySelectorAll('label')).find((candidate) =>
        candidate.textContent.trim().startsWith(l),
      );
      return node ? document.getElementById(node.htmlFor) : null;
    }, label);

  const clickButton = (page, text) =>
    page.evaluate((t) => {
      const button = Array.from(document.querySelectorAll('button')).find(
        (b) => b.textContent.trim() === t && !b.disabled,
      );
      button?.click();
      return Boolean(button);
    }, text);

  await test('editor: email and URL checks, with https:// added on blur', async () => {
    const page = await browser.newPage();
    await page.goto(options('profile'), { waitUntil: 'networkidle0' });
    await page.waitForSelector('.fw-tf__input');

    const email = await inputByLabel(page, 'Alternate email');
    await email.click({ clickCount: 3 });
    await email.type('not-an-email');
    await page.keyboard.press('Tab');
    const emailNote = await page.evaluate((el) => {
      const id = el.getAttribute('aria-describedby');
      return {
        invalid: el.getAttribute('aria-invalid'),
        note: id ? document.getElementById(id)?.textContent : '',
      };
    }, email);
    assertEqual(emailNote.invalid, 'true', 'bad email not marked invalid');
    assert(/email address/.test(emailNote.note), `no email note: ${emailNote.note}`);

    const site = await inputByLabel(page, 'Personal website');
    await site.click({ clickCount: 3 });
    await site.type('aditi.dev');
    await page.keyboard.press('Tab');
    await page.waitForFunction((el) => el.value === 'https://aditi.dev', {}, site);
    await sleep(1_200); // autosave
    const saved = await activeProfile();
    assertEqual(saved.links.website.value, 'https://aditi.dev', 'normalised URL not saved');
    assertEqual(saved.personal.alternateEmail.value, 'not-an-email', 'typed value was not kept');

    // Put things back for later suites.
    saved.personal.alternateEmail = { ...saved.personal.alternateEmail, value: '' };
    await ui({ type: 'ui:save-profile', profile: saved });
    await page.close();
  });

  await test('editor: bulk skills, autofill preview and keyboard reordering', async () => {
    const before = await activeProfile();
    const page = await browser.newPage();
    await page.goto(options('profile'), { waitUntil: 'networkidle0' });
    await page.waitForSelector('.fw-bulk textarea');

    await page.type('.fw-bulk textarea', 'Rust, Kotlin\nrust');
    assert(await clickButton(page, 'Add skills'), 'no Add skills');
    await page.waitForFunction(() => document.body.innerText.includes('Added 2 skills'));

    // The Contact preview shows what a form would receive.
    const opened = await page.evaluate(() => {
      const section = Array.from(document.querySelectorAll('section')).find((s) =>
        s.querySelector('h2')?.textContent.startsWith('Contact'),
      );
      const toggle = Array.from(section.querySelectorAll('button')).find(
        (b) => b.textContent === 'What autofill will see',
      );
      toggle.click();
      return true;
    });
    assert(opened, 'no preview toggle');
    await page.waitForFunction(
      (email) => document.querySelector('.fw-preview__body')?.textContent.includes(email),
      {},
      before.personal.email.value,
    );

    // Alt+ArrowDown moves the first education entry down, keeping focus on it.
    const firstKey = before.education[0].id;
    await page.focus(`[data-entry-key="${firstKey}"]`);
    await page.keyboard.down('Alt');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.up('Alt');
    await page.waitForFunction(
      (key) => document.activeElement?.getAttribute('data-entry-key') === key,
      {},
      firstKey,
    );
    await sleep(1_200);
    const after = await activeProfile();
    assertEqual(after.education[1].id, firstKey, 'entry was not moved down');
    assert(
      after.skills.filter((s) => /^(rust|kotlin)$/i.test(s.name)).length === 2,
      'bulk skills not saved once each',
    );

    // Restore.
    after.education = before.education;
    after.skills = before.skills;
    await ui({ type: 'ui:save-profile', profile: after });
    await page.close();
  });

  await test('editor: leaving with a failed save asks first', async () => {
    const PASS = 'editor guard passphrase';
    assert((await ui({ type: 'ui:vault-enable', passphrase: PASS })).ok, 'vault enable');
    const page = await browser.newPage();
    const dialogs = [];
    page.on('dialog', (dialog) => {
      dialogs.push(dialog.message());
      void (dialogs.length === 1 ? dialog.dismiss() : dialog.accept());
    });
    try {
      await page.goto(options('profile'), { waitUntil: 'networkidle0' });
      await page.waitForSelector('.fw-tf__input');
      await ui({ type: 'ui:vault-lock' });
      const city = await inputByLabel(page, 'Postal code');
      await city.type('9');
      await page.waitForFunction(() => document.body.innerText.includes('Not saved yet'), {
        timeout: 10_000,
      });

      await clickButton(page, 'Privacy Center');
      await sleep(300);
      assertEqual(dialogs.length, 1, 'no confirmation before leaving');
      assertEqual(
        await page.evaluate(() => location.hash),
        '#/profile',
        'navigated away although the user said no',
      );
      await clickButton(page, 'Privacy Center');
      await page.waitForFunction(() => location.hash === '#/privacy', { timeout: 5_000 });
    } finally {
      await page.close();
      await ui({ type: 'ui:vault-unlock', passphrase: PASS });
      assert((await ui({ type: 'ui:vault-disable', passphrase: PASS })).ok, 'vault disable');
    }
  });

  await test('history: fills are recorded once per posting, with the profile used', async () => {
    await ui({ type: 'ui:clear-history' });
    await ui({ type: 'ui:set-settings', patch: { privacy: { keepApplicationHistory: true } } });
    try {
      for (const run of ['h1', 'h2']) {
        const url = `${server.origin}/greenhouse.html?history-${run}`;
        const page = await browser.newPage();
        await page.goto(url, { waitUntil: 'domcontentloaded' });
        await evalInWorker(
          worker,
          `(async () => {
            const [tab] = await chrome.tabs.query({ url: ${JSON.stringify(url)} });
            await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => { globalThis.__fillwrightActivation = Date.now(); } });
            await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
          })()`,
        );
        await waitForWidget(page, (s) => s.text.includes('application field'));
        await clickWidgetButton(page, 'Fill');
        await waitForWidget(page, (s) => s.text.includes('updated'));
        await sleep(400);
        await page.close();
      }
      const history = await ui({ type: 'ui:list-history' });
      assertEqual(history.data.length, 1, 'the same posting was listed twice');
      const [entry] = history.data;
      assert(entry.role.length > 0, 'no role recorded');
      assert(entry.fieldsFilled > 0, 'no count recorded');
      const state = await ui({ type: 'ui:get-state' });
      assertEqual(entry.profileId, state.data.settings.activeProfileId, 'profile not recorded');
      const keys = Object.keys(entry).sort().join(',');
      assertEqual(
        keys,
        'appliedAt,company,fieldsFilled,id,origin,profileId,role',
        'history stores more than metadata',
      );

      const page = await browser.newPage();
      await page.goto(options('profiles'), { waitUntil: 'networkidle0' });
      await page.waitForFunction(() => document.body.innerText.includes('last used'), {
        timeout: 10_000,
      });
      await page.close();
    } finally {
      await ui({ type: 'ui:set-settings', patch: { privacy: { keepApplicationHistory: false } } });
      await ui({ type: 'ui:clear-history' });
    }
  });

  await control.close();
}
