/**
 * Real-world applicant-tracking-system layouts (test-pages/ats/).
 *
 * Each fixture states its expected behaviour at the top of the page; these
 * tests assert exactly that. Trust note: drives the TEST build only.
 */
import { readWidget, clickWidgetButton, waitForWidget, sleep, ATS_TEST_HOST } from './harness.mjs';

export async function runAtsSuite(ctx) {
  const { secure, browser, extensionId, server, test, assert, assertEqual, worker, evalInWorker } =
    ctx;
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
  // For the dependent State dropdown on the Greenhouse fixture.
  profile.address.state = { value: 'Karnataka', provenance: profile.address.city.provenance };
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

  await test('ats/greenhouse: phone code, month/year parts, role location and current box', async () => {
    const page = await open('greenhouse.html');
    await fill(page);
    const got = await values(page, [
      '#phone_country_code',
      '#phone',
      '#edu_start_month',
      '#edu_start_year',
      '#edu_end_month',
      '#edu_end_year',
      '#emp_title',
      '#emp_location',
      '#emp_start_month',
      '#emp_start_year',
      '#emp_end_month',
      '#emp_end_year',
    ]);
    const current = await page.evaluate(() => document.getElementById('emp_current').checked);
    // Read back from the live profile: earlier suites replace its entries.
    const latest = (
      await ui({ type: 'ui:get-profile', profileId: state.data.settings.activeProfileId })
    ).data;
    const edu = latest.education[0];
    const eduEnd = edu.graduationDate || edu.endDate;
    const role = [...latest.experience].sort((a, b) => Number(b.current) - Number(a.current))[0];
    const month = (date) => String(Number(date.slice(5, 7)));
    assertEqual(got['#phone_country_code'], 'IN', 'phone country code');
    assertEqual(got['#phone'], P.phone.replace(/^\+\d+\s+/, ''), 'phone without its code');
    assertEqual(got['#edu_start_month'], edu.startDate.slice(5, 7), 'education start month');
    assertEqual(got['#edu_start_year'], edu.startDate.slice(0, 4), 'education start year');
    assertEqual(got['#edu_end_month'], eduEnd.slice(5, 7), 'education end month');
    assertEqual(got['#edu_end_year'], eduEnd.slice(0, 4), 'education end year');
    assertEqual(got['#emp_title'], role.title, 'role title');
    assertEqual(got['#emp_location'], role.location, 'role location');
    assertEqual(got['#emp_start_month'], month(role.startDate), 'role start month (by name)');
    assertEqual(got['#emp_start_year'], role.startDate.slice(0, 4), 'role start year');
    assertEqual(current, role.current, 'the current-role box');
    assertEqual(got['#emp_end_month'], role.current ? '' : month(role.endDate), 'role end month');
    assertEqual(got['#emp_end_year'], role.current ? '' : role.endDate.slice(0, 4), 'role end year');
    await page.close();
  });

  await test('ats/greenhouse: State loads after Country — offered as a second pass, never auto-filled', async () => {
    const page = await open('greenhouse.html');
    const step = (label, promise) =>
      promise.catch((error) => {
        throw new Error(`${label}: ${error.message}`);
      });
    const before = await step('review list', reviewItems(page));
    const state = before.find((i) => i.label.startsWith('State'));
    assert(state, `State not listed\n      ${dump(before)}`);
    assertEqual(state.value, '', 'State cannot be proposed before its options load');
    await step('first fill', fill(page));
    assertEqual(await page.evaluate(() => document.getElementById('country').value), 'India');
    const offered = await step(
      'second-pass offer',
      waitForWidget(page, (s) => s.text.includes('can be filled now'), 15_000),
    );
    assert(offered.text.includes('1 more field can be filled now'), `offer: ${offered.text}`);
    await sleep(1_500);
    assertEqual(
      await page.evaluate(() => document.getElementById('state').value),
      '',
      'State was filled without the user asking',
    );
    assert(await clickWidgetButton(page, 'Review them'), 'no Review them');
    await step(
      'plan after Review them',
      waitForWidget(page, (s) => s.text.includes('application field'), 15_000),
    );
    await step('second fill', fill(page));
    assertEqual(await page.evaluate(() => document.getElementById('state').value), 'KA', 'State');
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
        phoneCode: byLabel('Country Phone Code'),
        phone: byLabel('Phone Number'),
        presses: window.__nextPresses,
      };
    });
    assertEqual(got.country, 'India', 'country dropdown');
    assertEqual(got.first, P.first, 'first name');
    assertEqual(got.email, P.email, 'email');
    assertEqual(got.phoneCode, 'IN_91', 'country phone code');
    assertEqual(got.phone, P.phone.replace(/^\+\d+\s+/, ''), 'phone without its code');
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
    const years = await page.evaluate(() =>
      Array.from(document.querySelectorAll('[data-automation-id^="education-"]')).map((block) =>
        ['firstYearAttended', 'lastYearAttended']
          .map((id) => block.querySelector(`[data-automation-id="${id}"]`).value)
          .join('-'),
      ),
    );
    assertEqual(
      years.join(' | '),
      profile.education
        .map((e) => `${e.startDate.slice(0, 4)}-${(e.graduationDate || e.endDate).slice(0, 4)}`)
        .join(' | '),
      'years attended by block',
    );
    const work = await page.evaluate(() => {
      const block = document.querySelector('[data-automation-id="workExperience-1"]');
      const v = (id) => block.querySelector(`[data-automation-id="${id}"]`);
      const date = (key, part) =>
        block.querySelector(`[data-automation-id="formField-${key}"] [data-automation-id="dateSection${part}-input"]`).value;
      return {
        title: v('jobTitle').value,
        company: v('company').value,
        location: v('location').value,
        current: v('currentlyWorkHere').checked,
        from: `${date('startDate', 'Month')}/${date('startDate', 'Year')}`,
        to: `${date('endDate', 'Month')}/${date('endDate', 'Year')}`,
      };
    });
    const role = profile.experience[0];
    assertEqual(work.title, role.title, 'job title');
    assertEqual(work.company, role.company, 'company');
    assertEqual(work.location, role.location, 'role location');
    assertEqual(work.current, false, 'past role marked current');
    assertEqual(work.from, `${role.startDate.slice(5, 7)}/${role.startDate.slice(0, 4)}`, 'From');
    assertEqual(work.to, `${role.endDate.slice(5, 7)}/${role.endDate.slice(0, 4)}`, 'To');
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

  /* --- adapters stay out of passive scans ---------------------------- */

  await test('ats/workday: Smart mode presses no page button until the user opens the panel', async () => {
    if (!secure) {
      console.log('    (skipped: openssl is unavailable, so the HTTPS fixture could not start)');
      return;
    }
    const pageUrl = `https://${ATS_TEST_HOST}:${secure.port}/ats/workday.html`;
    await ui({ type: 'ui:set-settings', patch: { autofill: { mode: 'smart' } } });
    const sync = await ui({ type: 'ui:sync-auto-detect' });
    assert(sync.data.registered, `passive script not registered: ${sync.data.reason}`);
    const page = await browser.newPage();
    try {
      await page.goto(pageUrl, { waitUntil: 'domcontentloaded' });
      // Smart mode prepares the plan on its own; wait until it has.
      await page.waitForFunction(
        () => {
          const node = document
            .querySelector('[data-fillwright-widget]')
            ?.shadowRoot?.querySelector('.fw-pill');
          return node && /\d+ ready/.test(node.textContent);
        },
        { timeout: 20_000 },
      );
      // A form change triggers another quiet scan; give it time to happen.
      await page.evaluate(() => {
        const extra = document.createElement('input');
        extra.setAttribute('aria-label', 'Middle Name');
        document.getElementById('page').appendChild(extra);
      });
      await sleep(2_500);
      assertEqual(
        await page.evaluate(() => window.__pagePresses),
        0,
        'a passive scan pressed a page button',
      );
      // The user opens the panel from the pill: adapters may run now, and still must not
      // press a dropdown or a navigation menu.
      await page.evaluate(() =>
        document
          .querySelector('[data-fillwright-widget]')
          .shadowRoot.querySelector('.fw-pill')
          .click(),
      );
      await waitForWidget(page, (s) => s.text.includes('application field'), 15_000);
      assertEqual(
        await page.evaluate(() => window.__pagePresses),
        0,
        'an explicit scan pressed a dropdown or nav menu',
      );
    } finally {
      await page.close();
      await ui({ type: 'ui:set-settings', patch: { autofill: { mode: 'manual' } } });
      await ui({ type: 'ui:sync-auto-detect' });
    }
  });

  await ctx.workdayPage?.close();
  await control.close();
}
