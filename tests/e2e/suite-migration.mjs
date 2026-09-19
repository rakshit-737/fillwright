/**
 * Old records and the handler boundary, in real Chrome.
 *
 *  - A profile record written by an older release (tests/fixtures/profile-v1.json,
 *    missing keys newer releases added) is put straight into IndexedDB, then
 *    opened in the editor and used to fill test-pages/migration.html.
 *  - Malformed payloads to ui:save-profile and ui:set-settings are rejected
 *    with a code and nothing is stored.
 *
 * Trust note: drives the TEST build only.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { waitForWidget, clickWidgetButton } from './harness.mjs';

const FIXTURE = JSON.parse(
  readFileSync(resolve(import.meta.dirname, '../fixtures/profile-v1.json'), 'utf8'),
);

export async function runMigrationSuite(ctx) {
  const { browser, extensionId, server, test, assert, assertEqual, worker, scanPage } = ctx;
  const options = (route) => `chrome-extension://${extensionId}/options.html#/${route}`;

  const control = await browser.newPage();
  await control.goto(options('privacy'), { waitUntil: 'domcontentloaded' });
  const ui = (message) => control.evaluate((m) => chrome.runtime.sendMessage(m), message);
  const before = (await ui({ type: 'ui:get-state' })).data.settings;

  // Raw write, bypassing the worker: this is what an older release left behind.
  await control.evaluate(
    (record) =>
      new Promise((done, fail) => {
        const open = indexedDB.open('fillwright');
        open.onerror = () => fail(new Error('open failed'));
        open.onsuccess = () => {
          const tx = open.result.transaction('profiles', 'readwrite');
          tx.objectStore('profiles').put(record);
          tx.oncomplete = () => {
            open.result.close();
            done();
          };
          tx.onerror = () => fail(new Error('write failed'));
        };
      }),
    FIXTURE,
  );

  try {
    await test('migration: a stored v1 profile loads with the missing keys filled in', async () => {
      const loaded = await ui({ type: 'ui:get-profile', profileId: FIXTURE.id });
      assert(loaded.ok, `v1 profile did not load: ${loaded.error}`);
      assertEqual(loaded.data.personal.firstName.value, 'Aditi', 'stored value lost');
      assertEqual(loaded.data.personal.pronouns.value, '', 'missing key not hydrated');
      assertEqual(loaded.data.experience[0].id, FIXTURE.experience[0].id, 'entry id changed');
      const active = await ui({ type: 'ui:set-active-profile', profileId: FIXTURE.id });
      assert(active.ok, `could not activate the v1 profile: ${active.error}`);
    });

    await test('migration: the editor opens a v1 profile', async () => {
      const page = await browser.newPage();
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.goto(options('profile'), { waitUntil: 'networkidle0' });
      await page.waitForSelector('.fw-tf__input');
      const first = await page.evaluate(() => {
        const label = Array.from(document.querySelectorAll('label')).find((l) =>
          l.textContent.trim().startsWith('First name'),
        );
        return label ? document.getElementById(label.htmlFor)?.value : null;
      });
      assertEqual(first, 'Aditi', 'editor did not show the stored first name');
      assertEqual(errors.length, 0, `editor threw: ${errors.join('; ')}`);
      await page.close();
    });

    await test('migration: a v1 profile fills a form', async () => {
      const url = `${server.origin}/migration.html`;
      const page = await browser.newPage();
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      await scanPage(worker, url);
      await waitForWidget(page, (state) => state.text.includes('application field'));
      assert(await clickWidgetButton(page, 'Fill'), 'the Fill button was not found');
      await waitForWidget(page, (state) => state.text.includes('updated'));
      const values = await page.evaluate(() =>
        Object.fromEntries(
          ['m-first', 'm-last', 'm-email', 'm-city', 'm-pronouns'].map((id) => [
            id,
            document.getElementById(id).value,
          ]),
        ),
      );
      assertEqual(values['m-first'], 'Aditi', 'first name');
      assertEqual(values['m-last'], 'Rao', 'last name');
      assertEqual(values['m-email'], 'aditi@example.com', 'email');
      assertEqual(values['m-city'], 'Pune', 'city');
      assertEqual(values['m-pronouns'], '', 'a key the record never had must stay empty');
      await page.close();
    });

    await test('boundary: a malformed profile is rejected and not stored', async () => {
      const result = await ui({ type: 'ui:save-profile', profile: { id: '../evil', name: 'x' } });
      assertEqual(result.ok, false, 'malformed profile accepted');
      assertEqual(result.code, 'EBADPROFILE', 'wrong code');
      const list = (await ui({ type: 'ui:list-profiles' })).data;
      assert(!list.some((p) => p.id === '../evil'), 'malformed profile was stored');
    });

    await test('boundary: malformed settings are rejected and not stored', async () => {
      const current = (await ui({ type: 'ui:get-settings' })).data;
      for (const patch of [
        { autofill: { mode: 'yolo' } },
        { privacy: { autoLockMinutes: 'never' } },
        { autofill: { confidenceThreshold: 'high' } },
      ]) {
        const result = await ui({ type: 'ui:set-settings', patch });
        assertEqual(result.ok, false, `accepted ${JSON.stringify(patch)}`);
        assertEqual(result.code, 'EBADSETTINGS', 'wrong code');
      }
      const clamped = await ui({
        type: 'ui:set-settings',
        patch: { autofill: { confidenceThreshold: 7 } },
      });
      assertEqual(clamped.data.autofill.confidenceThreshold, 0.99, 'threshold not clamped');
      const after = (await ui({ type: 'ui:get-settings' })).data;
      assertEqual(after.autofill.mode, current.autofill.mode, 'mode changed');
      assertEqual(after.privacy.autoLockMinutes, current.privacy.autoLockMinutes, 'lock changed');
      await ui({
        type: 'ui:set-settings',
        patch: { autofill: { confidenceThreshold: current.autofill.confidenceThreshold } },
      });
    });
  } finally {
    if (before.activeProfileId)
      await ui({ type: 'ui:set-active-profile', profileId: before.activeProfileId });
    await ui({ type: 'ui:delete-profile', profileId: FIXTURE.id });
    await control.close();
  }
}
