/**
 * End-to-end coverage for the v0.4 features that previously had unit tests
 * only: proactive modes, "add another", one-off corrections, mapping
 * management, SPA navigation, panel movement and focus, import/export, and
 * multi-fill undo.
 *
 * Trust note: this file drives the TEST build (dist-e2e), whose panel root is
 * reopened so the page world can read it. Nothing here runs in the shipped
 * extension.
 */
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { readWidget, clickWidgetButton, waitForWidget, sleep, evalInWorker } from './harness.mjs';

export async function runV05Suite(ctx) {
  const { browser, extensionId, server, test, assert, assertEqual, scanPage, worker } = ctx;
  const url = (name) => `${server.origin}/${name}`;
  const optionsUrl = (route = '') => `chrome-extension://${extensionId}/options.html${route}`;

  const control = await browser.newPage();
  await control.goto(optionsUrl(), { waitUntil: 'domcontentloaded' });
  const ui = (message) => control.evaluate((m) => chrome.runtime.sendMessage(m), message);

  /** Opens a fixture, activates Fillwright, and opens the review list. */
  async function openAndReview(name) {
    const page = await browser.newPage();
    await page.goto(url(name), { waitUntil: 'domcontentloaded' });
    await scanPage(worker, url(name));
    await waitForWidget(page, (state) => state.text.includes('application field'));
    assert(await clickWidgetButton(page, 'Review'), 'no Review button');
    await waitForWidget(page, (state) => state.items.length > 0);
    return page;
  }

  const itemFor = (widget, prefix) =>
    widget.items.find((item) => item.label.toLowerCase().startsWith(prefix.toLowerCase()));

  const hasPanel = (page) =>
    page.evaluate(() => {
      const host = document.querySelector('[data-fillwright-widget]');
      return Boolean(host?.shadowRoot?.querySelector('.fw-widget')?.childElementCount);
    });

  /** Clicks a row link, with the remember box set as asked, and confirms. */
  async function correct(page, label, field, remember) {
    return page.evaluate(
      (prefix, target, keep) => {
        const root = document.querySelector('[data-fillwright-widget]').shadowRoot;
        const row = Array.from(root.querySelectorAll('.fw-item')).find((item) =>
          item.querySelector('.fw-item__label')?.textContent.trim().startsWith(prefix),
        );
        if (!row) return 'no row';
        const open = Array.from(row.querySelectorAll('button')).find((button) =>
          ['Set what this is', 'Change'].includes(button.textContent.trim()),
        );
        if (!open) return 'no change link';
        open.click();
        const fresh = Array.from(root.querySelectorAll('.fw-item')).find((item) =>
          item.querySelector('.fw-item__label')?.textContent.trim().startsWith(prefix),
        );
        const select = fresh.querySelector('.fw-teach__select');
        const box = fresh.querySelector('.fw-teach__remember input');
        if (!select || !box) return 'no picker';
        select.value = target;
        box.checked = keep;
        const use = Array.from(fresh.querySelectorAll('button')).find(
          (button) => button.textContent.trim() === 'Use this',
        );
        use.click();
        return 'ok';
      },
      label,
      field,
      remember,
    );
  }

  /* --- deterministic profile for this suite ------------------------- */

  const state = await ui({ type: 'ui:get-state' });
  const active = await ui({
    type: 'ui:get-profile',
    profileId: state.data.settings.activeProfileId,
  });
  const EDUCATION = ['Vellore Institute of Technology', 'Delhi Public School', 'Open University'];
  const DEGREES = ['B.Tech', 'High School Diploma', 'Certificate in Statistics'];
  const profile = active.data;
  const prov = { source: 'user', confidence: 1, updatedAt: new Date().toISOString() };
  profile.education = EDUCATION.map((institution, index) => ({
    id: `v05-edu-${index}`,
    institution,
    degree: DEGREES[index],
    major: '',
    minor: '',
    location: '',
    startDate: `${2016 + index * 3}-08`,
    endDate: `${2019 + index * 3}-05`,
    graduationDate: `${2019 + index * 3}-05`,
    gpa: '',
    gpaScale: '',
    honors: '',
    coursework: [],
    current: false,
    provenance: prov,
  }));
  profile.links.github = { value: 'https://github.com/aditir', provenance: prov };
  const saved = await ui({ type: 'ui:save-profile', profile });
  assert(saved.ok, `could not seed the v0.5 profile: ${saved.error}`);
  const PROFILE_EMAIL = profile.personal.email.value;

  /* --- proactive modes ------------------------------------------------ */

  await test('assist mode offers help on an application without a click', async () => {
    await ui({ type: 'ui:set-settings', patch: { autofill: { mode: 'assist' } } });
    const sync = await ui({ type: 'ui:sync-auto-detect' });
    assert(sync.ok && sync.data.registered, `auto-detect not registered: ${JSON.stringify(sync)}`);

    const page = await browser.newPage();
    await page.goto(url('greenhouse.html'), { waitUntil: 'domcontentloaded' });
    const widget = await waitForWidget(
      page,
      (s) => s.text.includes('Application form found'),
      15_000,
    );
    assert(
      widget.buttons.includes('Review with Fillwright'),
      `no review action: ${widget.buttons.join(', ')}`,
    );
    const values = await page.evaluate(() => document.getElementById('first_name').value);
    assertEqual(values, '', 'assist mode must not fill anything by itself');
    await page.close();
  });

  for (const name of ['newsletter.html', 'login.html']) {
    await test(`assist mode stays silent on ${name}`, async () => {
      const page = await browser.newPage();
      await page.goto(url(name), { waitUntil: 'domcontentloaded' });
      await sleep(4_000);
      assertEqual(await hasPanel(page), false, `a panel appeared on ${name}`);
      await page.close();
    });
  }

  await test('smart mode prepares the plan and shows only a pill', async () => {
    await ui({ type: 'ui:set-settings', patch: { autofill: { mode: 'smart' } } });
    const page = await browser.newPage();
    await page.goto(url('greenhouse.html'), { waitUntil: 'domcontentloaded' });
    const pill = await page
      .waitForFunction(
        () => {
          const root = document.querySelector('[data-fillwright-widget]')?.shadowRoot;
          const node = root?.querySelector('.fw-pill');
          return node && /\d+ ready/.test(node.textContent) ? node.textContent.trim() : false;
        },
        { timeout: 15_000 },
      )
      .then((handle) => handle.jsonValue());
    assert(/[1-9]\d* ready/.test(pill), `unexpected pill: ${pill}`);
    const dialog = await page.evaluate(
      () =>
        document.querySelector('[data-fillwright-widget]').shadowRoot.querySelector('.fw-card') !==
        null,
    );
    assertEqual(dialog, false, 'smart mode must not open the full panel uninvited');
    await page.close();
  });

  await test('smart mode stays silent on a sign-in page', async () => {
    const page = await browser.newPage();
    await page.goto(url('login.html'), { waitUntil: 'domcontentloaded' });
    await sleep(4_000);
    assertEqual(await hasPanel(page), false, 'a panel appeared on the sign-in page');
    await page.close();
  });

  await test('manual mode unregisters the passive script', async () => {
    await ui({ type: 'ui:set-settings', patch: { autofill: { mode: 'manual' } } });
    const sync = await ui({ type: 'ui:sync-auto-detect' });
    assertEqual(sync.data.registered, false, 'script still registered in manual mode');
    const page = await browser.newPage();
    await page.goto(url('greenhouse.html'), { waitUntil: 'domcontentloaded' });
    await sleep(3_000);
    assertEqual(await hasPanel(page), false, 'manual mode showed a panel without a click');
    await page.close();
  });

  /* --- per-site access (test-pages/site-access.html) -------------------- */

  await test('site access: one granted origin registers there only; revoking unregisters', async () => {
    const site = 'https://fillwright-e2e.example';
    const pattern = `${site}/*`;
    const registered = () =>
      evalInWorker(
        worker,
        `chrome.scripting.getRegisteredContentScripts({ ids: ['fillwright-auto-detect'] })
           .then((scripts) => (scripts[0] ? scripts[0].matches : []))`,
      );
    // Headless Chrome cannot accept a permission prompt, so the test build
    // (scripts/build-e2e.mjs) grants this one origin at install instead.
    await ui({ type: 'ui:set-settings', patch: { autofill: { mode: 'assist' } } });
    try {
      await ui({ type: 'ui:sync-auto-detect' });
      const matches = await registered();
      assert(matches.includes(pattern), `not registered for the granted site: ${matches}`);
      assert(!matches.includes('https://*/*'), `registered for every https site: ${matches}`);
      assert(
        matches.every((m) => m === pattern || /^http:\/\/(localhost|127\.0\.0\.1)\//.test(m)),
        `registered beyond what was granted: ${matches}`,
      );

      // Revoke from the Permissions pane, the way a user does.
      const pane = await browser.newPage();
      await pane.goto(optionsUrl('#/permissions'), { waitUntil: 'domcontentloaded' });
      await pane.waitForSelector('[data-testid="granted-sites"]', { timeout: 10_000 });
      const clicked = await pane.evaluate((name) => {
        const row = Array.from(document.querySelectorAll('[data-testid="granted-sites"] li')).find(
          (li) => li.textContent.includes(name),
        );
        const button = row?.querySelector('button');
        button?.click();
        return Boolean(button);
      }, 'fillwright-e2e.example');
      assert(clicked, 'the granted site is not listed with a Revoke button');
      const notice = await pane
        .waitForFunction(
          () => document.querySelector('.fw-section [role="status"]')?.textContent || false,
          { timeout: 10_000 },
        )
        .then((handle) => handle.jsonValue());
      let after = await registered();
      for (let i = 0; i < 20 && after.includes(pattern); i += 1) {
        await sleep(100);
        after = await registered();
      }
      await pane.close();
      if (/removed\.$/.test(notice)) {
        assert(!after.includes(pattern), `still registered after revoke: ${after}`);
      } else {
        // Chrome refuses to remove an origin granted at install, which is how
        // this headless build has to grant it. The pane must then say so
        // rather than claim success, and nothing may change. The unregister
        // path itself is covered in tests/auto-detect.test.ts.
        assert(/didn’t remove/.test(notice), `unexpected revoke notice: ${notice}`);
        assert(after.includes(pattern), `registration changed without a revoke: ${after}`);
      }
    } finally {
      await ui({ type: 'ui:set-settings', patch: { autofill: { mode: 'manual' } } });
    }
  });

  /* --- add another entry ---------------------------------------------- */

  await test('add another: the offer appears and adds exactly the missing blocks', async () => {
    const page = await browser.newPage();
    await page.goto(url('add-another.html'), { waitUntil: 'domcontentloaded' });
    await scanPage(worker, url('add-another.html'));
    const offered = await waitForWidget(page, (s) => s.text.includes('more education'));
    assert(offered.text.includes('2 more education'), `unexpected offer: ${offered.text}`);
    assert(await clickWidgetButton(page, 'Add them'), 'no Add them control');
    await page.waitForFunction(() => window.__blocks === 3, { timeout: 10_000 });
    await waitForWidget(
      page,
      (s) => s.text.includes('application field') && !s.text.includes('more education'),
    );
    await sleep(500);
    assertEqual(await page.evaluate(() => window.__blocks), 3, 'wrong number of blocks added');

    assert(await clickWidgetButton(page, 'Fill'), 'no Fill button');
    await waitForWidget(page, (s) => s.text.includes('updated'));
    const schools = await page.evaluate(() =>
      [0, 1, 2].map((i) => document.getElementById(`edu-${i}-school`).value),
    );
    assertEqual(schools.join(' | '), EDUCATION.join(' | '), 'blocks did not map to entries 1–3');
    const degrees = await page.evaluate(() =>
      [0, 1, 2].map((i) => document.getElementById(`edu-${i}-degree`).value),
    );
    assertEqual(degrees[1], DEGREES[1], 'block 2 degree came from the wrong entry');
    assertEqual(await page.evaluate(() => window.__submitted), false, 'the form was submitted');
    await page.close();
  });

  /* --- one-off vs remembered corrections ------------------------------ */

  await test('a one-off correction fills now and is forgotten after reload', async () => {
    const page = await openAndReview('one-off.html');
    const before = itemFor(await readWidget(page), 'Candidate Code');
    assertEqual(before?.badge, 'Not recognised', 'the fixture field should start unrecognised');

    assertEqual(await correct(page, 'Candidate Code', 'personal.email', false), 'ok', 'correction');
    const after = await waitForWidget(page, (s) => itemFor(s, 'Candidate Code')?.value !== '');
    assertEqual(itemFor(after, 'Candidate Code').value, PROFILE_EMAIL, 'one-off value');
    const chip = await page.evaluate(() =>
      Array.from(
        document.querySelector('[data-fillwright-widget]').shadowRoot.querySelectorAll('.fw-chip'),
      ).map((node) => node.textContent),
    );
    assert(chip.includes('your choice'), `expected "your choice" chip, saw ${chip.join(',')}`);
    await page.close();

    const mappings = await ui({ type: 'ui:list-saved-mappings' });
    assert(
      !mappings.data.some((mapping) => mapping.label.startsWith('Candidate Code')),
      'a one-off correction was saved',
    );

    const again = await openAndReview('one-off.html');
    assertEqual(
      itemFor(await readWidget(again), 'Candidate Code')?.badge,
      'Not recognised',
      'the one-off correction survived a reload',
    );
    await again.close();
  });

  /* --- mapping management from the options page ----------------------- */

  const scanCode = async () => {
    const page = await openAndReview('one-off.html');
    const item = itemFor(await readWidget(page), 'Candidate Code');
    await page.close();
    return item;
  };

  /**
   * Runs `action(label, ...args)` inside the "What Fillwright learned" pane,
   * accepting any confirm dialog, then closes it.
   */
  async function onLearned(action, ...args) {
    const page = await browser.newPage();
    page.on('dialog', (dialog) => dialog.accept());
    await page.goto(optionsUrl('#/learned'), { waitUntil: 'networkidle0' });
    await page.waitForFunction(() =>
      document.body.innerText.includes('What Fillwright has learned'),
    );
    await sleep(300);
    const result = await page.evaluate(action, ...args);
    await sleep(600);
    await page.close();
    return result;
  }

  /** Presses a button inside the saved-mapping row whose label starts with `label`. */
  function pressInRow(label, text) {
    const row = Array.from(document.querySelectorAll('.fw-mapping')).find((node) =>
      node.querySelector('.fw-mapping__label')?.textContent.startsWith(label),
    );
    if (!row) return 'no row';
    const button = Array.from(row.querySelectorAll('button')).find(
      (candidate) => candidate.textContent.trim() === text,
    );
    if (!button) return 'no button';
    button.click();
    return 'ok';
  }

  async function retargetInRow(label, field) {
    const find = () =>
      Array.from(document.querySelectorAll('.fw-mapping')).find((node) =>
        node.querySelector('.fw-mapping__label')?.textContent.startsWith(label),
      );
    const change = Array.from(find()?.querySelectorAll('button') ?? []).find(
      (b) => b.textContent.trim() === 'Change',
    );
    if (!change) return 'no change';
    change.click();
    await new Promise((done) => setTimeout(done, 200));
    const select = find()?.querySelector('select');
    if (!select) return 'no select';
    select.value = field;
    select.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise((done) => setTimeout(done, 100));
    const save = Array.from(find().querySelectorAll('button')).find(
      (b) => b.textContent.trim() === 'Save',
    );
    if (!save) return 'no save';
    save.click();
    return 'ok';
  }

  await test('mappings: a remembered correction applies on the next visit', async () => {
    const page = await openAndReview('one-off.html');
    assertEqual(await correct(page, 'Candidate Code', 'links.github', true), 'ok', 'correction');
    await waitForWidget(page, (s) => itemFor(s, 'Candidate Code')?.value !== '');
    await page.close();
    const item = await scanCode();
    assertEqual(item?.value, 'https://github.com/aditir', 'remembered mapping not applied');
  });

  await test('mappings: changing the target from settings takes effect', async () => {
    const outcome = await onLearned(retargetInRow, 'Candidate Code', 'personal.email');
    assertEqual(outcome, 'ok', 'could not change the target');
    const item = await scanCode();
    assertEqual(item?.value, PROFILE_EMAIL, 'the new target was not used');
  });

  await test('mappings: pause stops the rule, resume restores it', async () => {
    assertEqual(await onLearned(pressInRow, 'Candidate Code', 'Pause'), 'ok', 'pause');
    assertEqual((await scanCode())?.badge, 'Not recognised', 'a paused rule was applied');
    assertEqual(await onLearned(pressInRow, 'Candidate Code', 'Resume'), 'ok', 'resume');
    assertEqual((await scanCode())?.value, PROFILE_EMAIL, 'a resumed rule was not applied');
  });

  await test('mappings: reset this site removes its rules', async () => {
    const outcome = await onLearned(() => {
      const section = Array.from(document.querySelectorAll('section')).find((node) =>
        node.textContent.includes('127.0.0.1'),
      );
      const button = Array.from(section?.querySelectorAll('button') ?? []).find(
        (b) => b.textContent.trim() === 'Reset this site',
      );
      if (!button) return 'no button';
      button.click();
      return 'ok';
    });
    assertEqual(outcome, 'ok', 'reset');
    const left = await ui({ type: 'ui:list-saved-mappings', origin: server.origin });
    assertEqual(left.data.length, 0, 'rules remain for the site');
    assertEqual((await scanCode())?.badge, 'Not recognised', 'a reset rule was applied');
  });

  await test('mappings: forget all clears every site', async () => {
    const page = await openAndReview('one-off.html');
    await correct(page, 'Candidate Code', 'links.github', true);
    await waitForWidget(page, (s) => itemFor(s, 'Candidate Code')?.value !== '');
    await page.close();
    const outcome = await onLearned(() => {
      const button = Array.from(document.querySelectorAll('button')).find(
        (b) => b.textContent.trim() === 'Forget all learned fields',
      );
      if (!button) return 'no button';
      button.click();
      return 'ok';
    });
    assertEqual(outcome, 'ok', 'forget all');
    const left = await ui({ type: 'ui:list-saved-mappings' });
    assertEqual(left.data.length, 0, 'rules remain after forget all');
    assertEqual((await scanCode())?.badge, 'Not recognised', 'a forgotten rule was applied');
  });

  /* --- SPA navigation --------------------------------------------------- */

  await test('spa: a pushState step change is rescanned, but not while typing', async () => {
    const page = await browser.newPage();
    await page.goto(url('spa-steps.html'), { waitUntil: 'domcontentloaded' });
    await scanPage(worker, url('spa-steps.html'));
    await waitForWidget(page, (s) => s.text.includes('3 application fields found'));

    await page.evaluate(() => window.__continue());
    await page.focus('#s-notes');
    // Keep typing for ~5 s — longer than the poll + debounce — and check the
    // panel has not been redrawn underneath the user.
    for (let i = 0; i < 20; i++) {
      await page.keyboard.type('x');
      await sleep(250);
      const widget = await readWidget(page);
      assert(
        widget.text.includes('3 application fields found'),
        `panel rescanned while typing (after ${i + 1} keystrokes): ${widget.text.slice(0, 80)}`,
      );
    }
    const after = await waitForWidget(
      page,
      (s) => /application fields found/.test(s.text) && !s.text.includes('3 application fields'),
      10_000,
    );
    assert(/[45] application fields found/.test(after.text), `unexpected rescan: ${after.text}`);
    assertEqual(await page.evaluate(() => window.__step), 2, 'the step changed unexpectedly');
    await page.close();
  });

  await test('spa: an open review list gets a banner instead of a redraw', async () => {
    const page = await openAndReview('spa-steps.html');
    const before = (await readWidget(page)).items.length;
    await page.evaluate(() => window.__continue());
    const widget = await waitForWidget(page, (s) => s.text.includes('This page changed'), 10_000);
    assertEqual(widget.items.length, before, 'the review list was redrawn under the user');
    assert(widget.buttons.includes('Refresh'), 'no Refresh action on the banner');
    await page.close();
  });

  /* --- panel movement and focus ---------------------------------------- */

  await test('panel: drag, arrow keys, contained Tab, and Esc with focus return', async () => {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });
    await page.goto(url('greenhouse.html?panel'), { waitUntil: 'domcontentloaded' });
    await page.focus('#last_name');
    await scanPage(worker, url('greenhouse.html?panel'));
    await waitForWidget(page, (s) => s.text.includes('application field'));

    const rect = () =>
      page.evaluate(() => {
        const root = document.querySelector('[data-fillwright-widget]').shadowRoot;
        const box = root.querySelector('.fw-widget').getBoundingClientRect();
        const grip = root.querySelector('.fw-grip').getBoundingClientRect();
        return { left: box.left, top: box.top, gx: grip.left + 20, gy: grip.top + grip.height / 2 };
      });

    const start = await rect();
    await page.mouse.move(start.gx, start.gy);
    await page.mouse.down();
    await page.mouse.move(start.gx - 200, start.gy - 150, { steps: 8 });
    await page.mouse.up();
    const dragged = await rect();
    assert(
      Math.abs(dragged.left - (start.left - 200)) <= 2,
      `drag x: ${start.left} → ${dragged.left}`,
    );
    assert(Math.abs(dragged.top - (start.top - 150)) <= 2, `drag y: ${start.top} → ${dragged.top}`);

    await page.evaluate(() =>
      document
        .querySelector('[data-fillwright-widget]')
        .shadowRoot.querySelector('.fw-grip')
        .focus(),
    );
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowUp');
    const nudged = await rect();
    assertEqual(Math.round(dragged.left - nudged.left), 16, 'ArrowLeft should move 16px');
    assertEqual(Math.round(dragged.top - nudged.top), 16, 'ArrowUp should move 16px');

    for (let i = 0; i < 25; i++) {
      const back = i % 7 === 6;
      if (back) await page.keyboard.down('Shift');
      await page.keyboard.press('Tab');
      if (back) await page.keyboard.up('Shift');
      const inside = await page.evaluate(
        () => document.activeElement?.hasAttribute('data-fillwright-widget') === true,
      );
      assert(inside, `Tab escaped the panel after ${i + 1} presses`);
    }

    await page.keyboard.press('Escape');
    const minimised = await page.evaluate(() => {
      const root = document.querySelector('[data-fillwright-widget]').shadowRoot;
      return { pill: root.querySelector('.fw-pill') !== null, focus: document.activeElement?.id };
    });
    assert(minimised.pill, 'Esc did not minimise the panel');
    assertEqual(minimised.focus, 'last_name', 'focus did not return to the page field');
    await page.close();
  });

  /* --- import / export through the real options page -------------------- */

  await test('export asks about sensitivity, and the file imports back', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'fw-export-'));
    const page = await browser.newPage();
    const dialogs = [];
    page.on('dialog', (dialog) => {
      dialogs.push(dialog.message());
      void dialog.accept();
    });
    const cdp = await page.createCDPSession();
    await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: dir });
    await page.goto(optionsUrl('#/privacy'), { waitUntil: 'networkidle0' });

    await page.evaluate(() =>
      Array.from(document.querySelectorAll('button'))
        .find((b) => b.textContent.trim() === 'Export a local copy')
        .click(),
    );
    const deadline = Date.now() + 15_000;
    let file = '';
    while (!file && Date.now() < deadline) {
      file = readdirSync(dir).find((name) => name.endsWith('.json')) ?? '';
      if (!file) await sleep(200);
    }
    assert(file, 'no export file was downloaded');
    assert(
      dialogs.some((message) => message.includes('sensitive personal information')),
      `no sensitivity warning: ${dialogs.join(' / ')}`,
    );
    await sleep(300);
    const exported = JSON.parse(readFileSync(join(dir, file), 'utf8'));
    assertEqual(exported.format, 'fillwright-export', 'export format marker');
    assert(!('history' in exported), 'history exported although not ticked');

    const importFile = join(dir, 'to-import.json');
    writeFileSync(importFile, JSON.stringify(exported));
    const before = (await ui({ type: 'ui:list-profiles' })).data.length;
    const input = await page.$('input[type="file"]');
    await input.uploadFile(importFile);
    await page.waitForFunction(() => document.body.innerText.includes('Imported'), {
      timeout: 15_000,
    });
    const after = await ui({ type: 'ui:list-profiles' });
    assertEqual(after.data.length, before + exported.profiles.length, 'profiles were not added');
    assert(
      after.data.some((summary) => summary.name.endsWith('(imported)')),
      'an imported profile replaced an existing one',
    );
    await page.close();
  });

  /* --- undo across two fills ------------------------------------------- */

  await test('undo after two consecutive fills restores both', async () => {
    // A unique URL: other greenhouse tabs are still open from earlier tests.
    const page = await openAndReview('greenhouse.html?undo');
    const unticked = await page.evaluate(() => {
      const root = document.querySelector('[data-fillwright-widget]').shadowRoot;
      const row = Array.from(root.querySelectorAll('.fw-item')).find((item) =>
        item.querySelector('.fw-item__label')?.textContent.trim().startsWith('Email'),
      );
      const box = row?.querySelector('input.fw-check');
      if (!box) return false;
      box.click();
      return true;
    });
    assert(unticked, 'could not untick the email row');
    assert(await clickWidgetButton(page, 'Fill'), 'no Fill button');
    await waitForWidget(page, (s) => s.text.includes('updated'));
    let values = await page.evaluate(() => ({
      first: document.getElementById('first_name').value,
      email: document.getElementById('email').value,
    }));
    assert(
      values.first !== '' && values.email === '',
      `first fill wrong: ${JSON.stringify(values)}`,
    );

    assert(await clickWidgetButton(page, 'Review the rest'), 'no Review the rest');
    await waitForWidget(page, (s) => s.buttons.some((b) => /^Fill [1-9]/.test(b)));
    assert(await clickWidgetButton(page, 'Fill'), 'no second Fill');
    await waitForWidget(page, (s) => s.text.includes('updated'));
    values = await page.evaluate(() => ({
      first: document.getElementById('first_name').value,
      email: document.getElementById('email').value,
    }));
    assertEqual(values.email, PROFILE_EMAIL, 'second fill did not write the email');

    assert(await clickWidgetButton(page, 'Undo'), 'no Undo');
    await waitForWidget(page, (s) => s.text.includes('Restored'));
    values = await page.evaluate(() => ({
      first: document.getElementById('first_name').value,
      email: document.getElementById('email').value,
    }));
    assertEqual(`${values.first}|${values.email}`, '|', 'undo did not restore both fills');
    await page.close();
  });

  /* --- on-device drafting --------------------------------------------- */

  const clickRowLinkIn = (page, prefix, text) =>
    page.evaluate(
      (p, t) => {
        const root = document.querySelector('[data-fillwright-widget]').shadowRoot;
        const row = Array.from(root.querySelectorAll('.fw-item')).find((item) =>
          item.querySelector('.fw-item__label')?.textContent.trim().startsWith(p),
        );
        const link = Array.from(row?.querySelectorAll('button') ?? []).find(
          (b) => b.textContent.trim() === t,
        );
        if (!link) return false;
        link.click();
        return true;
      },
      prefix,
      text,
    );

  const draftPanel = (page) =>
    page.evaluate(() => {
      const panel = document
        .querySelector('[data-fillwright-widget]')
        .shadowRoot.querySelector('.fw-draft');
      if (!panel) return null;
      return {
        text: panel.textContent.replace(/\s+/g, ' ').trim(),
        busy: panel.getAttribute('aria-busy'),
        facts: Array.from(panel.querySelectorAll('.fw-facts label')).map((l) => l.textContent),
        draft: panel.querySelector('textarea')?.value ?? null,
      };
    });

  await ui({
    type: 'ui:set-settings',
    patch: { ai: { enabled: true, provider: 'chrome-builtin', assistAnswerDrafting: true } },
  });

  await test('drafting says plainly when this Chrome has no on-device model', async () => {
    const page = await openAndReview('greenhouse.html?draft-unavailable');
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    assert(
      await clickRowLinkIn(page, 'Why do you want', 'Draft with on-device AI'),
      'no draft link on the essay row',
    );
    await page.waitForFunction(
      () =>
        document
          .querySelector('[data-fillwright-widget]')
          .shadowRoot.querySelector('.fw-draft .fw-error') !== null,
      { timeout: 10_000 },
    );
    const panel = await draftPanel(page);
    assert(
      /on-device|model/i.test(panel.text) && !/undefined|TypeError|Error:/.test(panel.text),
      `unclear message: ${panel.text}`,
    );
    assertEqual(
      await page.evaluate(() => document.getElementById('q_why').value),
      '',
      'form changed',
    );
    assertEqual(errors.length, 0, `page error: ${errors.join(' | ')}`);
    await page.close();
  });

  await test('drafting shows the fact picker first and never offers contact or sensitive facts', async () => {
    // A stand-in for Chrome's on-device model, installed into the TEST
    // browser's worker only. It records what it was given.
    await ctx.evalInWorker(
      worker,
      `(() => {
        globalThis.__prompts = [];
        globalThis.LanguageModel = {
          availability: async () => 'available',
          create: async () => ({
            prompt: async (text) => { globalThis.__prompts.push(text); return 'I build reliable payment systems.'; },
            destroy() {},
          }),
        };
        return true;
      })()`,
    );

    const page = await openAndReview('greenhouse.html?draft-fake');
    assert(
      await clickRowLinkIn(page, 'Why do you want', 'Draft with on-device AI'),
      'no draft link',
    );
    await page.waitForFunction(
      () =>
        document
          .querySelector('[data-fillwright-widget]')
          .shadowRoot.querySelector('.fw-draft .fw-facts') !== null,
      { timeout: 10_000 },
    );
    const picker = await draftPanel(page);
    assert(picker.facts.length > 0, 'no facts offered');
    assertEqual(picker.draft, null, 'a draft was generated before the user chose facts');
    const offered = picker.facts.join(' | ');
    assert(!offered.includes(PROFILE_EMAIL), `email offered: ${offered}`);
    assert(!/\+91|98450/.test(offered), `phone offered: ${offered}`);
    assert(!/authori[sz]|gender|visa|sponsor/i.test(offered), `sensitive fact offered: ${offered}`);

    assert(await clickRowLinkIn(page, 'Why do you want', 'Write a draft'), 'no Write a draft');
    await page.waitForFunction(
      () =>
        document
          .querySelector('[data-fillwright-widget]')
          .shadowRoot.querySelector('.fw-draft textarea') !== null,
      { timeout: 10_000 },
    );
    assertEqual(
      await page.evaluate(() => document.getElementById('q_why').value),
      '',
      'a draft reached the form before "Use this answer"',
    );
    const prompts = await ctx.evalInWorker(worker, 'globalThis.__prompts');
    assertEqual(prompts.length, 1, 'expected one prompt');
    assert(!prompts[0].includes(PROFILE_EMAIL), 'the prompt contained the email address');

    assert(await clickRowLinkIn(page, 'Why do you want', 'Use this answer'), 'no Use this answer');
    await page.waitForFunction(() => document.getElementById('q_why').value.length > 0, {
      timeout: 10_000,
    });
    assertEqual(
      await page.evaluate(() => document.getElementById('q_why').value),
      'I build reliable payment systems.',
      'the approved draft was not written',
    );
    await ctx.evalInWorker(
      worker,
      'delete globalThis.LanguageModel; delete globalThis.__prompts; true',
    );
    await page.close();
  });

  await ui({ type: 'ui:set-settings', patch: { ai: { enabled: false, provider: 'none' } } });

  /* --- error recovery ------------------------------------------------- */

  await test('errors: a form that rejects every value gets one plain summary', async () => {
    const page = await browser.newPage();
    await page.goto(url('rejecting.html'), { waitUntil: 'domcontentloaded' });
    await scanPage(worker, url('rejecting.html'));
    await waitForWidget(page, (s) => s.text.includes('application field'));
    assert(await clickWidgetButton(page, 'Fill'), 'no Fill button');
    const widget = await waitForWidget(page, (s) => s.text.includes('didn’t accept any'));
    assertEqual(widget.items.length, 0, 'failures were listed one by one');
    assert(widget.text.includes('Nothing on the form was changed'), 'no reassurance');
    assert(!widget.buttons.includes('Try again'), 'a pointless retry was offered');
    const values = await page.evaluate(() =>
      Array.from(document.querySelectorAll('input'))
        .map((input) => input.value)
        .join(''),
    );
    assertEqual(values, '', 'the form was changed');
    await page.close();
  });

  await test('errors: a form in an unreachable frame is explained', async () => {
    if (!ctx.foreign) {
      console.log('      (skipped: 127.0.0.2 is not bindable here)');
      return;
    }
    const host = url(
      `frame-host.html?frame=${encodeURIComponent(`${ctx.foreign.origin}/greenhouse.html`)}`,
    );
    const page = await browser.newPage();
    await page.goto(host, { waitUntil: 'networkidle0' });
    const started = await scanPage(worker, host);
    assert(started?.ok !== false, `activation failed: ${JSON.stringify(started)}`);
    const widget = await waitForWidget(page, (s) => s.text.includes('frame'));
    assert(widget.text.includes('can’t reach'), `unexpected text: ${widget.text}`);
    assert(widget.text.includes('Nothing on the form was changed'), 'no reassurance');
    await page.close();
  });

  await test('errors: a vault locked after the scan shows the unlock screen, not a fill', async () => {
    const PASS = 'correct horse battery staple v05';
    const enabled = await ui({ type: 'ui:vault-enable', passphrase: PASS });
    assert(enabled.ok, `vault enable failed: ${enabled.error}`);
    try {
      const page = await browser.newPage();
      await page.goto(url('greenhouse.html?locked'), { waitUntil: 'domcontentloaded' });
      await scanPage(worker, url('greenhouse.html?locked'));
      await waitForWidget(page, (s) => s.text.includes('application field'));
      await ui({ type: 'ui:vault-lock' });
      assert(await clickWidgetButton(page, 'Fill'), 'no Fill button');
      const widget = await waitForWidget(page, (s) => s.text.includes('Fillwright is locked'));
      assert(widget.buttons.includes('Unlock Fillwright'), 'no unlock action');
      assertEqual(
        await page.evaluate(() => document.getElementById('first_name').value),
        '',
        'a stale plan was written after locking',
      );
      await page.close();
    } finally {
      await ui({ type: 'ui:vault-unlock', passphrase: PASS });
      const disabled = await ui({ type: 'ui:vault-disable', passphrase: PASS });
      assert(disabled.ok, `vault disable failed: ${disabled.error}`);
    }
  });

  await test('errors: the popup explains a page it cannot fill before you try', async () => {
    // Opened as a tab, the popup's own extension page is the active tab — one
    // of the pages Chrome keeps off-limits.
    const popup = await browser.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup.html`, { waitUntil: 'networkidle0' });
    await popup.waitForFunction(() => document.querySelector('.fw-page-block') !== null, {
      timeout: 10_000,
    });
    const state = await popup.evaluate(() => ({
      text: document.querySelector('.fw-page-block').textContent,
      disabled: Array.from(document.querySelectorAll('button')).find((b) =>
        b.textContent.includes('Fill this page'),
      )?.disabled,
    }));
    assert(state.text.includes('off-limits'), `unclear message: ${state.text}`);
    assertEqual(state.disabled, true, 'Fill this page should be disabled here');
    await popup.close();
  });

  await control.close();
}
