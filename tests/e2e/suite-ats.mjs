/**
 * Real-world applicant-tracking-system layouts (test-pages/ats/).
 *
 * Each fixture states its expected behaviour at the top of the page; these
 * tests assert exactly that. Trust note: drives the TEST build only.
 */
import { readWidget, clickWidgetButton, waitForWidget, sleep } from './harness.mjs';

export async function runAtsSuite(ctx) {
  const { browser, extensionId, server, test, assert, assertEqual, worker, evalInWorker } = ctx;
  const url = (name) => `${server.origin}/ats/${name}`;

  const control = await browser.newPage();
  await control.goto(`chrome-extension://${extensionId}/options.html`, {
    waitUntil: 'domcontentloaded',
  });
  const ui = (message) => control.evaluate((m) => chrome.runtime.sendMessage(m), message);

  const state = await ui({ type: 'ui:get-state' });
  const profile = (
    await ui({ type: 'ui:get-profile', profileId: state.data.settings.activeProfileId })
  ).data;
  profile.preferences.workModePreference = 'remote';
  profile.links.portfolio = { value: '', provenance: profile.links.portfolio.provenance };
  assert((await ui({ type: 'ui:save-profile', profile })).ok, 'could not update the profile');
  const P = {
    first: profile.personal.firstName.value,
    last: profile.personal.lastName.value,
    email: profile.personal.email.value,
    phone: profile.personal.phone.value,
    linkedin: profile.links.linkedin.value,
    github: profile.links.github.value,
    company: profile.experience[0].company,
    school: profile.education.map((entry) => entry.institution),
    degree: profile.education.map((entry) => entry.degree),
  };

  /** Explicit activation, optionally into every frame (as the toolbar does). */
  async function activate(tabUrl, allFrames = false) {
    return evalInWorker(
      worker,
      `(async () => {
        const [tab] = await chrome.tabs.query({ url: ${JSON.stringify(tabUrl)} });
        if (!tab) return { ok: false };
        const target = { tabId: tab.id, allFrames: ${allFrames} };
        await chrome.scripting.executeScript({ target, func: () => { globalThis.__fillwrightActivation = Date.now(); } });
        await chrome.scripting.executeScript({ target, files: ['content.js'] });
        return { ok: true };
      })()`,
    );
  }

  async function open(name) {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });
    await page.goto(url(name), { waitUntil: 'networkidle0' });
    await activate(url(name));
    await waitForWidget(page, (s) => s.text.includes('application field'), 15_000);
    return page;
  }

  async function reviewItems(page) {
    if (!(await readWidget(page)).items.length) {
      assert(await clickWidgetButton(page, 'Review'), 'no Review button');
    }
    return (await waitForWidget(page, (s) => s.items.length > 0)).items;
  }

  const fill = async (page) => {
    assert(await clickWidgetButton(page, 'Fill'), 'no Fill button');
    return waitForWidget(page, (s) => /updated|didn’t accept/.test(s.text), 30_000);
  };

  const values = (page, selectors) =>
    page.evaluate(
      (list) =>
        Object.fromEntries(
          list.map((selector) => {
            const node = document.querySelector(selector);
            if (!node) return [selector, null];
            if (node.getAttribute('role') === 'radio') {
              return [selector, node.getAttribute('aria-checked')];
            }
            return [selector, node.value ?? node.textContent];
          }),
        ),
      selectors,
    );

  const dump = (items) =>
    items.map((i) => `${i.label} => ${i.value || '-'} [${i.badge}]`).join('\n      ');

  /* --- Greenhouse --------------------------------------------------- */

  await test('ats/greenhouse: fields, React-Select school and degree, EEO untouched', async () => {
    const page = await open('greenhouse.html');
    const items = await reviewItems(page);
    for (const label of ['Gender', 'Veteran Status', 'Disability Status', 'Are you Hispanic']) {
      const item = items.find((i) => i.label.startsWith(label));
      assert(item, `EEO field ${label} not listed\n      ${dump(items)}`);
      assertEqual(item.value, '', `${label} must not be proposed`);
    }
    await fill(page);
    const got = await values(page, [
      '#first_name',
      '#last_name',
      '#email',
      '#phone',
      '#job_application_answers_attributes_0_text_value',
      'input[name="job_application[educations][][school_name_id]"]',
      'input[name="job_application[educations][][degree_id]"]',
      '#job_application_gender',
      '#job_application_race',
      '#job_application_veteran_status',
      '#job_application_disability_status',
    ]);
    assertEqual(got['#first_name'], P.first, 'first name');
    assertEqual(got['#email'], P.email, 'email');
    assertEqual(got['#job_application_answers_attributes_0_text_value'], P.linkedin, 'LinkedIn');
    assertEqual(
      got['input[name="job_application[educations][][school_name_id]"]'],
      P.school[0],
      'React-Select school',
    );
    assertEqual(
      got['input[name="job_application[educations][][degree_id]"]'],
      P.degree[0],
      'React-Select degree',
    );
    for (const id of ['gender', 'race', 'veteran_status', 'disability_status']) {
      assertEqual(got[`#job_application_${id}`], '', `EEO ${id} was changed`);
    }
    assertEqual(await page.evaluate(() => window.__submitted), false, 'submitted');
    await page.close();
  });

  /* --- Lever -------------------------------------------------------- */

  await test('ats/lever: div labels and names; written answer left alone', async () => {
    const page = await open('lever.html');
    await fill(page);
    const got = await values(page, [
      'input[name="name"]',
      'input[name="email"]',
      'input[name="phone"]',
      'input[name="org"]',
      'input[name="urls[LinkedIn]"]',
      'input[name="urls[GitHub]"]',
      'textarea[name="comments"]',
    ]);
    assertEqual(got['input[name="name"]'], `${P.first} ${P.last}`, 'full name');
    assertEqual(got['input[name="email"]'], P.email, 'email');
    assertEqual(got['input[name="phone"]'], P.phone, 'phone');
    assertEqual(got['input[name="org"]'], P.company, 'current company');
    assertEqual(got['input[name="urls[LinkedIn]"]'], P.linkedin, 'LinkedIn URL');
    assertEqual(got['input[name="urls[GitHub]"]'], P.github, 'GitHub URL');
    assertEqual(got['textarea[name="comments"]'], '', 'additional information was written');
    assertEqual(await page.evaluate(() => window.__submitted), false, 'submitted');
    await page.close();
  });

  /* --- Workday ------------------------------------------------------ */

  await test('ats/workday: step 1 fills; Save and Continue is never pressed by Fillwright', async () => {
    const page = await open('workday.html');
    await fill(page);
    const got = await page.evaluate(() => {
      const byLabel = (text) => {
        const label = Array.from(document.querySelectorAll('label')).find(
          (l) => l.textContent === text,
        );
        return document.querySelector(`[aria-labelledby="${label.id}"]`).value;
      };
      return {
        country: byLabel('Country'),
        first: byLabel('First Name'),
        email: byLabel('Email Address'),
        phone: byLabel('Phone Number'),
        presses: window.__nextPresses,
      };
    });
    assertEqual(got.country, 'India', 'country dropdown');
    assertEqual(got.first, P.first, 'first name');
    assertEqual(got.email, P.email, 'email');
    assertEqual(got.phone, P.phone, 'phone');
    assertEqual(got.presses, 0, 'Fillwright pressed Save and Continue');
    ctx.workdayPage = page;
  });

  await test('ats/workday: step 2 is read afresh and education blocks are added and filled', async () => {
    const page = ctx.workdayPage;
    assert(page, 'step 1 did not run');
    await page.click('#next');
    const offered = await waitForWidget(page, (s) => s.text.includes('more education'), 15_000);
    assert(offered.text.includes('2 more education'), `unexpected offer: ${offered.text}`);
    assert(await clickWidgetButton(page, 'Add them'), 'no Add them');
    await page.waitForFunction(
      () => document.querySelectorAll('[data-automation-id^="education-"]').length === 3,
      { timeout: 10_000 },
    );
    await waitForWidget(
      page,
      (s) => s.text.includes('application field') && !s.text.includes('more education'),
    );
    await fill(page);
    const degrees = await page.evaluate(() =>
      Array.from(document.querySelectorAll('[data-automation-id="degree"]')).map((s) => s.value),
    );
    assertEqual(degrees.join(' | '), P.degree.join(' | '), 'degrees by block');
    // The school prompt loads options only after typing: each block gets its
    // own school, and Fillwright typed only short prefixes.
    const schools = await page.evaluate(() =>
      Array.from(document.querySelectorAll('[data-automation-id="selectedItem"]')).map(
        (node) => node.textContent,
      ),
    );
    assertEqual(schools.join(' | '), P.school.join(' | '), 'async school prompts by block');
    const searches = await page.evaluate(() => window.__searches);
    assert(searches.length > 0, 'no search was typed');
    for (const query of searches) {
      assert(query.length <= 6, `typed more than a short prefix: "${query}"`);
      assert(!P.school.includes(query), `typed a whole school name: "${query}"`);
    }
    assertEqual(await page.evaluate(() => window.__nextPresses), 1, 'only the test pressed Next');
  });

  /* --- Ashby -------------------------------------------------------- */

  await test('ats/ashby: controlled inputs keep their values; ARIA radio answered', async () => {
    const page = await open('ashby.html');
    const items = await reviewItems(page);
    const relocate = items.find((i) => i.label.startsWith('Are you willing to relocate'));
    assert(relocate, `relocation question not listed\n      ${dump(items)}`);
    assertEqual(relocate.value, '', 'relocation must not be proposed');
    await fill(page);
    await sleep(600); // let the page's own re-render run
    const got = await page.evaluate(() => ({ ...window.__state, submitted: window.__submitted }));
    assertEqual(got.name, `${P.first} ${P.last}`, 'name kept after re-render');
    assertEqual(got.email, P.email, 'email kept after re-render');
    assertEqual(got.linkedin, P.linkedin, 'LinkedIn kept');
    assertEqual(got.workMode, 'Remote', 'work setting radio');
    assertEqual(got.relocate, '', 'relocation was answered');
    assertEqual(got.submitted, false, 'submitted');
    await page.close();
  });

  /* --- iCIMS / SmartRecruiters (same-origin iframe) ------------------ */

  await test('ats/icims: one panel, inside the frame, and the frame form fills', async () => {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });
    await page.goto(url('icims.html'), { waitUntil: 'networkidle0' });
    await activate(url('icims.html'), true);
    const frame = page.frames().find((f) => f.url().endsWith('icims-frame.html'));
    assert(frame, 'frame not found');
    await frame.waitForFunction(
      () =>
        document
          .querySelector('[data-fillwright-widget]')
          ?.shadowRoot?.textContent.includes('application field'),
      { timeout: 15_000 },
    );
    await sleep(800);
    const topPanel = await page.evaluate(() =>
      Boolean(
        document.querySelector('[data-fillwright-widget]')?.shadowRoot?.querySelector('.fw-card'),
      ),
    );
    assertEqual(topPanel, false, 'the outer page showed its own empty panel');
    await frame.evaluate(() => {
      const button = Array.from(
        document.querySelector('[data-fillwright-widget]').shadowRoot.querySelectorAll('button'),
      ).find((b) => b.textContent.startsWith('Fill'));
      button.click();
    });
    await frame.waitForFunction(
      () => document.getElementById('PersonProfileFields.Email').value !== '',
      { timeout: 15_000 },
    );
    const got = await frame.evaluate(() => ({
      first: document.getElementById('PersonProfileFields.FirstName').value,
      country: document.getElementById('PersonProfileFields.Country').value,
      submitted: window.__submitted,
    }));
    assertEqual(got.first, P.first, 'frame first name');
    assertEqual(got.country, 'IN', 'frame country');
    assertEqual(got.submitted, false, 'submitted');
    await page.close();
  });

  /* --- LinkedIn Easy Apply ------------------------------------------ */

  await test('ats/linkedin: modal steps fill; Next, Review and Submit are never pressed', async () => {
    const page = await open('linkedin.html');
    await fill(page);
    let got = await page.evaluate(() =>
      Array.from(document.querySelectorAll('#easy-apply input')).map((i) => i.value),
    );
    assertEqual(got.join(' | '), `${P.first} | ${P.last} | ${P.phone} | ${P.email}`, 'step 1');
    assertEqual(
      JSON.stringify(await page.evaluate(() => window.__presses)),
      JSON.stringify({ next: 0, review: 0, submit: 0 }),
      'Fillwright pressed a navigation button',
    );

    await page.click('#next');
    await waitForWidget(page, (s) => s.text.includes('2 application field'), 15_000);
    const items = await reviewItems(page);
    const years = items.find((i) => i.label.startsWith('How many years'));
    assert(years, `years question not listed\n      ${dump(items)}`);
    assertEqual(
      years.value,
      '',
      'a skill-specific years question was answered from total experience',
    );
    await fill(page);
    got = await page.evaluate(() =>
      Array.from(document.querySelectorAll('#easy-apply input')).map((i) => i.value),
    );
    assertEqual(got[0], '', 'years question was written');
    assertEqual(got[1], P.linkedin, 'LinkedIn on step 2');
    assertEqual(
      JSON.stringify(await page.evaluate(() => window.__presses)),
      JSON.stringify({ next: 1, review: 0, submit: 0 }),
      'Fillwright pressed Review or Submit',
    );
    await page.close();
  });

  /* --- virtualised list --------------------------------------------- */

  await test('ats/virtual-list: an option outside the rendered window is found and chosen', async () => {
    const page = await browser.newPage();
    await page.goto(`${server.origin}/virtual-list.html`, { waitUntil: 'networkidle0' });
    await activate(`${server.origin}/virtual-list.html`);
    await waitForWidget(page, (s) => s.text.includes('application field'), 15_000);
    const listed = await reviewItems(page);
    const after = await fill(page);
    const got = await page.evaluate(() => ({
      country: document.getElementById('country').value,
      rendered: window.__rendered,
    }));
    assertEqual(
      got.country,
      profile.address.country.value,
      `virtualised country
      ${dump(listed)}
      ${after.text}`,
    );
    assert(got.rendered <= 10, 'the list rendered more than its window');
    await page.close();
  });

  /* --- hostile markup ----------------------------------------------- */

  await test('ats/hostile: controls disguised as dropdowns and radios are never pressed', async () => {
    const url = `${server.origin}/hostile-roles.html`;
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: 'networkidle0' });
    await activate(url);
    await waitForWidget(page, (s) => s.text.includes('application field'), 15_000);
    await reviewItems(page);
    // Tick everything that can be ticked, then fill.
    await page.evaluate(() => {
      const root = document.querySelector('[data-fillwright-widget]').shadowRoot;
      root.querySelectorAll('input.fw-check').forEach((box) => {
        if (!box.checked) box.click();
      });
    });
    await fill(page);
    const after = await page.evaluate(() => ({
      submitted: window.__submitted,
      href: location.href,
      first: document.getElementById('h-first').value,
    }));
    assertEqual(after.submitted, 0, 'a disguised submit button was pressed');
    assertEqual(after.href, url, 'a disguised link was followed');
    assertEqual(after.first, P.first, 'ordinary fields should still fill');
    await page.close();
  });

  await ctx.workdayPage?.close();
  await control.close();
}
