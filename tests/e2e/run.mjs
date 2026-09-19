/**
 * End-to-end validation in real Chrome.
 *
 * Everything else in the suite runs under jsdom, which is fast but is not a
 * browser: it has no extension runtime, no real service worker, no CSP
 * enforcement, and its own approximations of shadow DOM and layout. This run
 * exercises the built extension exactly as a user would receive it.
 */
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from './server.mjs';
import { runV05Suite } from './suite-v05.mjs';
import { runAtsSuite } from './suite-ats.mjs';
import { runA11ySuite } from './suite-a11y.mjs';
import { runOnboardingSuite } from './suite-onboarding.mjs';
import { runEditorSuite } from './suite-editor.mjs';
import {
  launch,
  evalInWorker,
  readWidget,
  clickWidgetButton,
  waitForWidget,
  sleep,
} from './harness.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/* ------------------------------------------------------------ tiny runner */

let passed = 0;
const failures = [];
const notes = [];

async function test(name, fn) {
  if (
    process.env.E2E_ONLY &&
    !name.startsWith(process.env.E2E_ONLY) &&
    !name.startsWith('the service worker')
  ) {
    return;
  }
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (cause) {
    failures.push({ name, message: cause instanceof Error ? cause.message : String(cause) });
    console.log(`  ✗ ${name}`);
    console.log(`      ${cause instanceof Error ? cause.message : cause}`);
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(
      `${message}\n      expected: ${JSON.stringify(expected)}\n      actual:   ${JSON.stringify(actual)}`,
    );
  }
}

/**
 * Finds a listed field by label prefix.
 *
 * Real labels carry required markers and separators ("First Name *",
 * "Resume/CV *"), so matching on a prefix is what a person reading the panel
 * would do.
 */
function findItem(widget, prefix) {
  return widget.items.find((item) => item.label.toLowerCase().startsWith(prefix.toLowerCase()));
}

/** Clicks a per-row link ("Why?", "Set what this is") by row label. */
async function clickRowLink(page, labelPrefix, linkText) {
  return page.evaluate(
    (prefix, text) => {
      const host = document.querySelector('[data-fillwright-widget]');
      if (!host || !host.shadowRoot) return false;
      const rows = Array.from(host.shadowRoot.querySelectorAll('.fw-item'));
      const row = rows.find((item) => {
        const label = item.querySelector('.fw-item__label');
        return label && label.textContent.trim().toLowerCase().startsWith(prefix.toLowerCase());
      });
      if (!row) return false;
      const link = Array.from(row.querySelectorAll('button')).find(
        (button) => (button.textContent || '').trim() === text,
      );
      if (!link) return false;
      link.click();
      return true;
    },
    labelPrefix,
    linkText,
  );
}

/** Chooses a canonical field in an open correction picker and confirms it. */
async function teachField(page, labelPrefix, canonical) {
  return page.evaluate(
    (prefix, field) => {
      const host = document.querySelector('[data-fillwright-widget]');
      if (!host || !host.shadowRoot) return false;
      const rows = Array.from(host.shadowRoot.querySelectorAll('.fw-item'));
      const row = rows.find((item) => {
        const label = item.querySelector('.fw-item__label');
        return label && label.textContent.trim().toLowerCase().startsWith(prefix.toLowerCase());
      });
      if (!row) return false;
      const select = row.querySelector('.fw-teach__select');
      if (!select) return false;
      select.value = field;
      select.dispatchEvent(new Event('change', { bubbles: true }));
      const use = Array.from(row.querySelectorAll('button')).find(
        (button) => (button.textContent || '').trim() === 'Use this',
      );
      if (!use) return false;
      use.click();
      return true;
    },
    labelPrefix,
    canonical,
  );
}

function dumpItems(widget) {
  return widget.items
    .map((item) => `${item.label} => ${item.value || '(none)'} [${item.badge}]`)
    .join('\n      ');
}

/* ------------------------------------------------------------- the profile */

const TEST_PROFILE = {
  firstName: 'Aditi',
  lastName: 'Ramachandran',
  email: 'aditi@example.com',
  phone: '+91 98450 12345',
  city: 'Bengaluru',
  country: 'India',
  linkedin: 'https://linkedin.com/in/aditi-ramachandran',
  github: 'https://github.com/aditir',
  institution: 'Vellore Institute of Technology',
  degree: 'B.Tech',
  major: 'Computer Science',
  graduationDate: '2026-05',
  gpa: '8.94',
  company: 'Zeta Payments',
  title: 'Software Engineering Intern',
  secondInstitution: 'Delhi Public School',
  secondCompany: 'Indian Institute of Science',
};

/**
 * Seeds a profile through the real message protocol, from the options page.
 * Nothing is written directly to storage — this is the same path the UI uses.
 */
async function seedProfile(browser, extensionId) {
  const page = await browser.newPage();
  await page.goto(`chrome-extension://${extensionId}/options.html`, {
    waitUntil: 'domcontentloaded',
  });

  const result = await page.evaluate(async (data) => {
    const send = (message) => chrome.runtime.sendMessage(message);

    const created = await send({ type: 'ui:create-profile', name: 'E2E Profile' });
    if (!created.ok) return { ok: false, error: created.error };
    const profile = created.data;

    const user = (value) => ({
      value,
      provenance: { source: 'user', confidence: 1, updatedAt: new Date().toISOString() },
    });

    profile.personal.firstName = user(data.firstName);
    profile.personal.lastName = user(data.lastName);
    profile.personal.email = user(data.email);
    profile.personal.phone = user(data.phone);
    profile.address.city = user(data.city);
    profile.address.country = user(data.country);
    profile.links.linkedin = user(data.linkedin);
    profile.links.github = user(data.github);

    profile.education = [
      {
        id: 'edu-1',
        institution: data.institution,
        degree: data.degree,
        major: data.major,
        minor: '',
        location: 'Vellore',
        startDate: '2022-08',
        endDate: data.graduationDate,
        graduationDate: data.graduationDate,
        gpa: data.gpa,
        gpaScale: '10',
        honors: '',
        coursework: [],
        current: true,
        provenance: { source: 'user', confidence: 1, updatedAt: new Date().toISOString() },
      },
      {
        id: 'edu-2',
        institution: data.secondInstitution,
        degree: 'High School Diploma',
        major: '',
        minor: '',
        location: 'Bengaluru',
        startDate: '2020-06',
        endDate: '2022-05',
        graduationDate: '2022-05',
        gpa: '',
        gpaScale: '',
        honors: '',
        coursework: [],
        current: false,
        provenance: { source: 'user', confidence: 1, updatedAt: new Date().toISOString() },
      },
    ];

    profile.experience = [
      {
        id: 'exp-1',
        company: data.company,
        title: data.title,
        employmentType: 'internship',
        location: 'Bengaluru',
        locationType: '',
        startDate: '2025-06',
        endDate: '2025-08',
        current: false,
        description: '',
        highlights: [],
        technologies: [],
        provenance: { source: 'user', confidence: 1, updatedAt: new Date().toISOString() },
      },
      {
        id: 'exp-2',
        company: data.secondCompany,
        title: 'Research Intern',
        employmentType: 'internship',
        location: 'Bengaluru',
        locationType: '',
        startDate: '2024-12',
        endDate: '2025-02',
        current: false,
        description: '',
        highlights: [],
        technologies: [],
        provenance: { source: 'user', confidence: 1, updatedAt: new Date().toISOString() },
      },
    ];

    // Only a US answer: the edge-case page asks two UK questions, one of them
    // under "please tell us", and neither may borrow the US answer.
    profile.sensitive.workAuthorization.authorizedIn = { US: 'yes' };

    const saved = await send({ type: 'ui:save-profile', profile });
    if (!saved.ok) return { ok: false, error: saved.error };
    const active = await send({ type: 'ui:set-active-profile', profileId: profile.id });
    return { ok: active.ok, profileId: profile.id, error: active.error };
  }, TEST_PROFILE);

  await page.close();
  if (!result.ok) throw new Error(`Could not seed the profile: ${result.error}`);
  return result.profileId;
}

/** Injects the content script the way the toolbar button does. */
async function scanPage(worker, tabUrl) {
  return evalInWorker(
    worker,
    `(async () => {
       const tabs = await chrome.tabs.query({ url: ${JSON.stringify(tabUrl)} });
       const tab = tabs[0];
       if (!tab) return { ok: false, error: 'tab not found' };
       // Same two steps as scanActiveTab: mark the injection as explicit, then load.
       await chrome.scripting.executeScript({
         target: { tabId: tab.id },
         func: () => { globalThis.__fillwrightActivation = Date.now(); },
       });
       await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
       return { ok: true };
     })()`,
  );
}

async function readInputs(page, ids) {
  return page.evaluate(
    (list) =>
      Object.fromEntries(
        list.map((id) => {
          const element = document.getElementById(id);
          if (!element) return [id, null];
          if (element.type === 'checkbox' || element.type === 'radio') return [id, element.checked];
          return [id, element.value];
        }),
      ),
    ids,
  );
}

/* --------------------------------------------------------------- the run */

async function main() {
  const server = await startServer(resolve(root, 'test-pages'));
  // A second loopback address is a different origin that the test build has
  // no host access to — the "form in someone else's iframe" case.
  const foreign = await startServer(resolve(root, 'test-pages'), 0, '127.0.0.2').catch(() => null);
  const { browser, worker, extensionId } = await launch({ headless: process.env.HEADED !== '1' });

  console.log(`\nFillwright end-to-end (real Chrome)`);
  console.log(`  extension: ${extensionId}`);
  console.log(`  fixtures:  ${server.origin}\n`);

  try {
    /* --- extension surfaces load ------------------------------------- */

    await test('the service worker starts and answers messages', async () => {
      const page = await browser.newPage();
      await page.goto(`chrome-extension://${extensionId}/options.html`, {
        waitUntil: 'domcontentloaded',
      });
      const state = await page.evaluate(() => chrome.runtime.sendMessage({ type: 'ui:get-state' }));
      assert(state?.ok, `ui:get-state failed: ${state?.error}`);
      assert(state.data.settings, 'settings were not returned');
      await page.close();
    });

    await test('the options page renders without console errors', async () => {
      const page = await browser.newPage();
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      page.on('console', (message) => {
        if (message.type() === 'error') errors.push(message.text());
      });
      await page.goto(`chrome-extension://${extensionId}/options.html#/privacy`, {
        waitUntil: 'networkidle0',
      });
      const heading = await page.$eval('h1', (node) => node.textContent?.trim());
      assertEqual(heading, 'Privacy Center', 'the Privacy Center did not render');
      assertEqual(errors.length, 0, `console errors on the options page: ${errors.join(' | ')}`);
      await page.close();
    });

    await test('the popup renders without console errors', async () => {
      const page = await browser.newPage();
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.goto(`chrome-extension://${extensionId}/popup.html`, {
        waitUntil: 'networkidle0',
      });
      const text = await page.evaluate(() => document.body.innerText);
      assert(text.includes('Fillwright'), 'the popup did not render the brand');
      assertEqual(errors.length, 0, `console errors in the popup: ${errors.join(' | ')}`);
      await page.close();
    });

    /* --- the CSP guarantee is real, not just declared ----------------- */

    await test('the extension cannot make an outbound network request', async () => {
      const page = await browser.newPage();
      await page.goto(`chrome-extension://${extensionId}/options.html`, {
        waitUntil: 'domcontentloaded',
      });
      const outcome = await page.evaluate(async () => {
        try {
          await fetch('https://example.com/collect', { method: 'POST', body: 'x' });
          return 'ALLOWED';
        } catch (error) {
          return `BLOCKED: ${error instanceof Error ? error.message : 'unknown'}`;
        }
      });
      assert(
        outcome.startsWith('BLOCKED'),
        `the CSP did not block an outbound request — got "${outcome}"`,
      );
      notes.push(`CSP enforcement confirmed in Chrome (${outcome.slice(0, 60)}…)`);
      await page.close();
    });

    /* --- seed a profile ----------------------------------------------- */

    await seedProfile(browser, extensionId);

    await test('every options pane renders without console errors', async () => {
      const routes = [
        ['profile', 'E2E Profile'],
        ['import', 'Resume'],
        ['preferences', 'Application preferences'],
        ['profiles', 'Profiles'],
        ['history', 'Application history'],
        ['learned', 'What Fillwright has learned'],
        ['security', 'Security'],
        ['assistance', 'Writing assistance'],
        ['privacy', 'Privacy Center'],
        ['permissions', 'Permissions'],
        ['settings', 'Settings'],
        ['welcome', 'Welcome'],
      ];

      for (const [route, heading] of routes) {
        const page = await browser.newPage();
        const errors = [];
        page.on('pageerror', (error) => errors.push(`${route}: ${error.message}`));
        page.on('console', (message) => {
          if (message.type() === 'error') errors.push(`${route}: ${message.text()}`);
        });

        await page.goto(`chrome-extension://${extensionId}/options.html#/${route}`, {
          waitUntil: 'networkidle0',
        });
        // Panes load their data asynchronously; give them a beat to settle.
        await sleep(400);

        const text = await page.evaluate(() => document.body.innerText);
        assert(
          text.includes(heading),
          `the ${route} pane did not render "${heading}"
      saw: ${text.slice(0, 160)}`,
        );
        assertEqual(errors.length, 0, `console errors: ${errors.join(' | ')}`);
        await page.close();
      }
    });

    /* --- the Greenhouse-shaped form ----------------------------------- */

    const greenhouse = await browser.newPage();
    await greenhouse.goto(`${server.origin}/greenhouse.html`, { waitUntil: 'domcontentloaded' });

    await test('the panel appears on an application form', async () => {
      await scanPage(worker, `${server.origin}/greenhouse.html`);
      const widget = await waitForWidget(greenhouse, (state) =>
        state.text.includes('application field'),
      );
      assert(widget.text.includes('Fillwright'), 'the panel did not render its heading');
      assert(
        /\d+ application fields? found/.test(widget.text),
        `no field count shown: ${widget.text}`,
      );
    });

    await test('it renders inside a shadow root, isolated from the page', async () => {
      const isolated = await greenhouse.evaluate(() => {
        const host = document.querySelector('[data-fillwright-ui]');
        return Boolean(host?.shadowRoot) && host.shadowRoot.querySelector('.fw-widget') !== null;
      });
      assert(isolated, 'the panel is not inside a shadow root');
    });

    await test('the review list explains each proposed value', async () => {
      assert(await clickWidgetButton(greenhouse, 'Review'), 'the Review button was not found');
      const widget = await waitForWidget(greenhouse, (state) => state.items.length > 0);
      const detail = dumpItems(widget);

      assertEqual(
        findItem(widget, 'First Name')?.value,
        TEST_PROFILE.firstName,
        `first name is wrong
      ${detail}`,
      );
      assertEqual(
        findItem(widget, 'Last Name')?.value,
        TEST_PROFILE.lastName,
        'last name is wrong',
      );
      assertEqual(findItem(widget, 'Email')?.value, TEST_PROFILE.email, 'email is wrong');
      assertEqual(
        findItem(widget, 'University')?.value,
        TEST_PROFILE.institution,
        `university is wrong
      ${detail}`,
      );
      assertEqual(findItem(widget, 'Phone')?.value, TEST_PROFILE.phone, 'phone is wrong');
      assertEqual(findItem(widget, 'LinkedIn')?.value, TEST_PROFILE.linkedin, 'linkedin is wrong');
    });

    await test('an essay question is marked as needing a written answer', async () => {
      const widget = await readWidget(greenhouse);
      const essay = findItem(widget, 'Why do you want');
      assert(essay, 'the essay question was not listed');
      assertEqual(essay.badge, 'You need to write this', 'the essay question was not flagged');
    });

    await test('a resume file input is flagged rather than attempted', async () => {
      const widget = await readWidget(greenhouse);
      const resume = findItem(widget, 'Resume');
      assert(
        resume,
        `the resume field was not listed
      ${dumpItems(widget)}`,
      );
      assertEqual(
        resume.badge,
        'You need to write this',
        `a file input must be flagged as manual
      ${dumpItems(widget)}`,
      );
    });

    await test('filling writes real values into the form', async () => {
      assert(await clickWidgetButton(greenhouse, 'Fill'), 'the Fill button was not found');
      await waitForWidget(greenhouse, (state) => state.text.includes('updated'));

      const values = await readInputs(greenhouse, [
        'first_name',
        'last_name',
        'email',
        'phone',
        'q_linkedin',
        'q_github',
        'q_school',
      ]);

      assertEqual(values.first_name, TEST_PROFILE.firstName, 'first name was not written');
      assertEqual(values.last_name, TEST_PROFILE.lastName, 'last name was not written');
      assertEqual(values.email, TEST_PROFILE.email, 'email was not written');
      assertEqual(values.q_linkedin, TEST_PROFILE.linkedin, 'LinkedIn was not written');
      assertEqual(values.q_school, TEST_PROFILE.institution, 'university was not written');
    });

    await test('the form was not submitted', async () => {
      const submitted = await greenhouse.evaluate(() => window.__submitted === true);
      assert(!submitted, 'the form was submitted — this must never happen');
      assertEqual(greenhouse.url(), `${server.origin}/greenhouse.html`, 'the page navigated away');
    });

    await test('undo restores the form', async () => {
      assert(await clickWidgetButton(greenhouse, 'Undo'), 'the Undo button was not found');
      await waitForWidget(greenhouse, (state) => state.text.includes('Restored'));
      const values = await readInputs(greenhouse, ['first_name', 'email']);
      assertEqual(values.first_name, '', 'first name was not restored');
      assertEqual(values.email, '', 'email was not restored');
    });

    await greenhouse.close();

    /* --- React-controlled inputs -------------------------------------- */

    const react = await browser.newPage();
    await react.goto(`${server.origin}/react-form.html`, { waitUntil: 'domcontentloaded' });

    await test('controlled inputs accept the value and update component state', async () => {
      await scanPage(worker, `${server.origin}/react-form.html`);
      await waitForWidget(react, (state) => state.text.includes('application field'));
      assert(await clickWidgetButton(react, 'Fill'), 'the Fill button was not found');
      await waitForWidget(react, (state) => state.text.includes('updated'));

      // The fixture reverts any value written without a real input event, so a
      // stale value here means the native-setter path is broken.
      await sleep(900);
      const values = await readInputs(react, ['c1', 'c2']);
      assertEqual(values.c1, TEST_PROFILE.firstName, 'the controlled input reverted the value');

      const state = await react.evaluate(() =>
        JSON.parse(document.getElementById('state').textContent),
      );
      assertEqual(state.firstName, TEST_PROFILE.firstName, 'component state did not update');
      assertEqual(state.email, TEST_PROFILE.email, 'component state did not update for email');
    });

    await react.close();

    /* --- edge cases ---------------------------------------------------- */

    const edge = await browser.newPage();
    await edge.goto(`${server.origin}/edge-cases.html`, { waitUntil: 'domcontentloaded' });

    await test('credential fields are never listed', async () => {
      await scanPage(worker, `${server.origin}/edge-cases.html`);
      const widget = await waitForWidget(edge, (state) => state.text.includes('application field'));
      await clickWidgetButton(edge, 'Review');
      const listed = await waitForWidget(edge, (state) => state.items.length > 0);
      const labels = listed.items.map((item) => item.label.toLowerCase()).join(' | ');
      assert(!labels.includes('password'), 'a password field was listed');
      assert(!labels.includes('one-time'), 'an OTP field was listed');
      assert(!labels.includes('social security'), 'an SSN field was listed');
      void widget;
    });

    await test('prefilled fields are reported as already filled', async () => {
      const widget = await readWidget(edge);
      const prefilled = findItem(widget, 'First Name');
      assert(
        prefilled,
        `the prefilled field was not listed
      ${dumpItems(widget)}`,
      );
      assertEqual(prefilled.badge, 'Already filled in', 'a prefilled field was not protected');
    });

    await test('a UK authorisation question is not answered from a US answer', async () => {
      const widget = await readWidget(edge);
      const uk = widget.items.find((item) => item.label.includes('United Kingdom'));
      assert(uk, 'the UK question was not listed');
      assertEqual(uk.value, '', 'a UK question was answered from a different country');
    });

    await test('"please tell us" does not make a UK question a US one', async () => {
      const widget = await readWidget(edge);
      const tellUs = findItem(widget, 'Right to work (UK)');
      if (tellUs) assertEqual(tellUs.value, '', 'the "tell us" UK question got the US answer');
    });

    await test('a shadow-DOM field is detected', async () => {
      const widget = await readWidget(edge);
      const shadow = findItem(widget, 'GitHub URL');
      assert(shadow, 'the shadow-root field was not detected');
      assertEqual(shadow.value, TEST_PROFILE.github, 'the shadow-root field got the wrong value');
    });

    await test('prompt injection in a label is treated as text', async () => {
      const injected = await edge.evaluate(() => document.getElementById('e13').value);
      assertEqual(injected, '', 'an injected instruction caused a value to be written');
      const widget = await readWidget(edge);
      const item = findItem(widget, 'Ignore all previous');
      if (item) assert(item.value === '', 'an injected instruction produced a proposed value');
    });

    await test('prefilled values survive a fill', async () => {
      assert(await clickWidgetButton(edge, 'Fill'), 'the Fill button was not found');
      await waitForWidget(edge, (state) => state.text.includes('updated'));
      const values = await readInputs(edge, ['e1', 'e2', 'e14']);
      assertEqual(values.e14, '', 'the "tell us" UK question was filled from the US answer');
      assertEqual(values.e1, 'Alexandra', 'a prefilled value was overwritten');
      assertEqual(values.e2, 'alex@existing.example', 'a prefilled value was overwritten');
    });

    await edge.close();

    /* --- hard mode: repeated blocks and custom dropdowns -------------- */

    const hard = await browser.newPage();
    await hard.goto(`${server.origin}/hard-mode.html`, { waitUntil: 'domcontentloaded' });

    await test('hard mode: the page is scanned in full', async () => {
      await scanPage(worker, `${server.origin}/hard-mode.html`);
      const widget = await waitForWidget(hard, (state) => state.text.includes('application field'));
      const count = Number(widget.text.match(/(\d+) application fields? found/)?.[1] ?? 0);
      assert(count >= 40, `expected a large form to be detected, saw ${count}`);
    });

    await test('hard mode: repeated education blocks get different entries', async () => {
      await clickWidgetButton(hard, 'Review');
      const widget = await waitForWidget(hard, (state) => state.items.length > 0);

      const schools = widget.items.filter((item) => item.label.startsWith('University / College'));
      assert(schools.length >= 2, `expected repeated university fields, saw ${schools.length}`);

      const values = schools.map((item) => item.value).filter(Boolean);
      assert(
        values.includes(TEST_PROFILE.institution),
        `block 1 should hold the most recent entry\n      ${dumpItems(widget)}`,
      );
      assert(
        values.includes(TEST_PROFILE.secondInstitution),
        `block 2 should hold the second entry\n      ${dumpItems(widget)}`,
      );
      // The bug this guards against: every block filled from entry one.
      assertEqual(
        values.filter((value) => value === TEST_PROFILE.institution).length,
        1,
        'the same education entry was used for more than one block',
      );
    });

    await test('hard mode: a third block with no matching entry is left empty', async () => {
      const widget = await readWidget(hard);
      const schools = widget.items.filter((item) => item.label.startsWith('University / College'));
      const empty = schools.filter((item) => !item.value);
      assert(empty.length >= 1, 'the extra block should not have been filled');
    });

    await test('hard mode: structurally repeated experience blocks differ', async () => {
      const widget = await readWidget(hard);
      const companies = widget.items
        .filter((item) => item.label === 'Company')
        .map((item) => item.value)
        .filter(Boolean);

      assert(
        companies.includes(TEST_PROFILE.company),
        `expected the current role first, saw ${JSON.stringify(companies)}`,
      );
      assert(
        companies.includes(TEST_PROFILE.secondCompany),
        `expected the second role in block 2, saw ${JSON.stringify(companies)}`,
      );
    });

    await test('hard mode: filling drives the custom dropdown', async () => {
      assert(await clickWidgetButton(hard, 'Fill'), 'the Fill button was not found');
      await waitForWidget(hard, (state) => state.text.includes('updated'), 30_000);

      const shown = await hard.evaluate(() => {
        const node = document.querySelector('[data-combo="degree"] .combo__value');
        return node ? node.textContent.trim() : null;
      });
      assertEqual(shown, TEST_PROFILE.degree, 'the custom dropdown did not take the selection');
    });

    await test('hard mode: an ambiguous dropdown is left alone', async () => {
      const shown = await hard.evaluate(() => {
        const node = document.querySelector('[data-combo="ambiguous"] .combo__value');
        return node ? node.textContent.trim() : null;
      });
      assertEqual(shown, 'Select…', 'an ambiguous dropdown was guessed at');
    });

    await test('hard mode: no dropdown was left hanging open', async () => {
      const open = await hard.evaluate(() =>
        Array.from(document.querySelectorAll('[aria-expanded="true"]')).map(
          (node) => node.getAttribute('data-combo') || node.tagName,
        ),
      );
      const menus = await hard.evaluate(() => document.querySelectorAll('.combo__menu').length);
      assertEqual(
        open.length,
        0,
        'a dropdown was left open over the form: ' + JSON.stringify(open) + ' menus=' + menus,
      );
    });

    await test('hard mode: a rejected write is reported, not claimed as filled', async () => {
      const widget = await readWidget(hard);
      assert(
        /did not take/.test(widget.text),
        `a rejected write should be reported\n      ${widget.text}`,
      );
      const value = await hard.evaluate(() => document.getElementById('h-reject').value);
      assertEqual(value, '', 'the rejecting field should not hold a value');
    });

    await test('hard mode: aria-only and placeholder-only fields still fill', async () => {
      const values = await readInputs(hard, ['h-email', 'h-linkedin', 'h-github', 'h-phone']);
      assertEqual(values['h-email'], TEST_PROFILE.email, 'aria-labelledby field was missed');
      assertEqual(values['h-linkedin'], TEST_PROFILE.linkedin, 'aria-label field was missed');
      assertEqual(values['h-github'], TEST_PROFILE.github, 'placeholder-only field was missed');
      assertEqual(values['h-phone'], TEST_PROFILE.phone, 'visually hidden label was missed');
    });

    await test('hard mode: the injected instruction field stays empty', async () => {
      const value = await hard.evaluate(() => document.getElementById('h-inject').value);
      assertEqual(value, '', 'an injected instruction produced a write');
    });

    await test('hard mode: nothing was submitted', async () => {
      const submitted = await hard.evaluate(() => window.__submitted === true);
      assert(!submitted, 'the form was submitted');
    });

    await hard.close();

    /* --- corrections: teaching Fillwright a field ---------------------- */

    const teach = await browser.newPage();
    await teach.goto(`${server.origin}/hard-mode.html`, { waitUntil: 'domcontentloaded' });

    await test('review rows explain themselves on request', async () => {
      await scanPage(worker, `${server.origin}/hard-mode.html`);
      await waitForWidget(teach, (state) => state.text.includes('application field'));
      await clickWidgetButton(teach, 'Review');
      await waitForWidget(teach, (state) => state.items.length > 0);

      assert(await clickRowLink(teach, 'Email Address', 'Why?'), 'no Why? control on a mapped row');
      const explained = await teach.evaluate(() => {
        const host = document.querySelector('[data-fillwright-widget]');
        const why = host.shadowRoot.querySelector('.fw-why');
        return why ? why.textContent.trim() : '';
      });
      assert(explained.length > 10, 'the explanation was empty');
      assert(
        /matched/i.test(explained),
        `the explanation should say what matched, got: ${explained}`,
      );
    });

    await test('an unrecognised field offers a correction', async () => {
      const widget = await readWidget(teach);
      // `xq_7734` is the deliberately meaningless field on the fixture. Naming
      // it explicitly keeps this test from drifting onto some other row.
      const mystery = widget.items.find((item) => item.label.startsWith('xq_7734'));
      assert(mystery, `expected the unrecognised field\n      ${dumpItems(widget)}`);
      assertEqual(mystery.badge, 'Not recognised', 'the mystery field should not have been mapped');
      assert(
        await clickRowLink(teach, 'xq_7734', 'Set what this is'),
        'no correction control on an unrecognised row',
      );
      const hasPicker = await teach.evaluate(() => {
        const host = document.querySelector('[data-fillwright-widget]');
        return host.shadowRoot.querySelector('.fw-teach__select') !== null;
      });
      assert(hasPicker, 'the correction picker did not open');
    });

    await test('a correction is applied and remembered', async () => {
      assert(
        await teachField(teach, 'xq_7734', 'personal.preferredName'),
        'the correction could not be submitted',
      );

      // Teaching triggers a rescan. Wait for THIS row to gain a value: other
      // rows resolve to the same name, so a looser predicate is satisfied by a
      // plan that has not been rebuilt yet, and the assertion below then reads
      // a stale row. That produced a genuinely flaky test.
      const after = await waitForWidget(
        teach,
        (state) =>
          state.items.some((item) => item.label.startsWith('xq_7734') && item.value !== ''),
        20_000,
      );

      const taught = after.items.find((item) => item.label.startsWith('xq_7734'));
      assert(taught, 'the corrected field vanished after the rescan');
      // preferredName falls back to the first name when none is set.
      assertEqual(taught.value, TEST_PROFILE.firstName, 'the correction did not take effect');
      // A taught mapping is near-certain, and a ready row shows its confidence.
      assert(
        /^9\d%$/.test(taught.badge),
        `a taught mapping should read as high confidence, got "${taught.badge}"`,
      );
    });

    await test('the correction survives a fresh page load', async () => {
      // Only one tab may hold the fixture URL, or the scan targets the wrong one.
      await teach.close();
      const second = await browser.newPage();
      await second.goto(`${server.origin}/hard-mode.html`, { waitUntil: 'domcontentloaded' });
      await scanPage(worker, `${server.origin}/hard-mode.html`);
      await waitForWidget(second, (state) => state.text.includes('application field'));
      await clickWidgetButton(second, 'Review');
      const widget = await waitForWidget(second, (state) => state.items.length > 0);

      const remembered = widget.items.filter((item) => item.value === TEST_PROFILE.firstName);
      assert(
        remembered.length >= 1,
        `the remembered mapping was not reapplied\n      ${dumpItems(widget)}`,
      );
      await second.close();
    });

    await test('saved mappings are listed in settings', async () => {
      const page = await browser.newPage();
      await page.goto(`chrome-extension://${extensionId}/options.html`, {
        waitUntil: 'domcontentloaded',
      });
      const mappings = await page.evaluate(() =>
        chrome.runtime.sendMessage({ type: 'ui:list-saved-mappings' }),
      );
      assert(mappings.ok, `could not list mappings: ${mappings.error}`);
      assert(mappings.data.length >= 1, 'the correction was not stored');
      assertEqual(
        mappings.data[0].canonical,
        'personal.preferredName',
        'the stored mapping has the wrong target',
      );
      await page.close();
    });

    /* --- the encrypted vault ------------------------------------------ */

    const PASSPHRASE = 'correct horse battery staple';

    /** Runs a message against the background from an extension page. */
    async function ask(message) {
      const page = await browser.newPage();
      await page.goto(`chrome-extension://${extensionId}/options.html`, {
        waitUntil: 'domcontentloaded',
      });
      const result = await page.evaluate((payload) => chrome.runtime.sendMessage(payload), message);
      await page.close();
      return result;
    }

    await test('the vault starts off', async () => {
      const status = await ask({ type: 'ui:vault-status' });
      assert(status.ok, `status failed: ${status.error}`);
      assertEqual(status.data.state, 'off', 'encryption should be off by default');
    });

    await test('turning encryption on rewrites stored data as ciphertext', async () => {
      const enabled = await ask({ type: 'ui:vault-enable', passphrase: PASSPHRASE });
      assert(enabled.ok, `could not enable: ${enabled.error}`);

      const status = await ask({ type: 'ui:vault-status' });
      assertEqual(status.data.state, 'unlocked', 'the vault should be unlocked after enabling');

      // Read the raw IndexedDB record and confirm the resume data is not in it.
      const page = await browser.newPage();
      await page.goto(`chrome-extension://${extensionId}/options.html`, {
        waitUntil: 'domcontentloaded',
      });
      const raw = await page.evaluate(
        () =>
          new Promise((resolve, reject) => {
            const open = indexedDB.open('fillwright');
            open.onerror = () => reject(new Error('open failed'));
            open.onsuccess = () => {
              const tx = open.result.transaction('profiles', 'readonly');
              const all = tx.objectStore('profiles').getAll();
              all.onsuccess = () => resolve(JSON.stringify(all.result));
              all.onerror = () => reject(new Error('read failed'));
            };
          }),
      );
      await page.close();

      assert(raw.includes('"encrypted":true'), 'the stored record is not marked encrypted');
      assert(
        !raw.includes(TEST_PROFILE.email),
        'the email address is readable in the stored record',
      );
      assert(
        !raw.includes(TEST_PROFILE.institution),
        'the university is readable in the stored record',
      );
      // The profile name stays out of the blob so the list works while locked.
      assert(raw.includes('E2E Profile'), 'the profile name should remain listable');
    });

    await test('the profile is still readable while unlocked', async () => {
      const state = await ask({ type: 'ui:get-state' });
      const profileId = state.data.settings.activeProfileId;
      const profile = await ask({ type: 'ui:get-profile', profileId });
      assert(profile.ok, `the profile should be readable when unlocked: ${profile.error}`);
      assertEqual(profile.data.personal.email.value, TEST_PROFILE.email, 'wrong data came back');
    });

    await test('locking makes the profile unreadable', async () => {
      const locked = await ask({ type: 'ui:vault-lock' });
      assert(locked.ok, 'lock failed');

      const state = await ask({ type: 'ui:get-state' });
      const profileId = state.data.settings.activeProfileId;
      const profile = await ask({ type: 'ui:get-profile', profileId });

      assert(!profile.ok, 'a locked vault must not return the profile');
      assertEqual(profile.code, 'ELOCKED', `expected ELOCKED, got ${profile.code}`);
    });

    await test('a locked vault still lists profiles by name', async () => {
      const profiles = await ask({ type: 'ui:list-profiles' });
      assert(profiles.ok, 'listing should work while locked');
      assert(profiles.data.length >= 1, 'the profile list should not look empty while locked');
      assertEqual(profiles.data[0].name, 'E2E Profile', 'the name should still be listable');
    });

    await test('the on-page panel offers to unlock instead of failing', async () => {
      const page = await browser.newPage();
      await page.goto(`${server.origin}/greenhouse.html`, { waitUntil: 'domcontentloaded' });
      await scanPage(worker, `${server.origin}/greenhouse.html`);

      const widget = await waitForWidget(page, (state) => state.text.includes('locked'));
      assert(
        widget.buttons.some((label) => label.includes('Unlock')),
        `the panel should offer to unlock, saw: ${JSON.stringify(widget.buttons)}`,
      );

      // Nothing was written while locked.
      const values = await readInputs(page, ['first_name', 'email']);
      assertEqual(values.first_name, '', 'a locked vault must not fill anything');
      await page.close();
    });

    await test('the wrong passphrase is refused', async () => {
      const result = await ask({ type: 'ui:vault-unlock', passphrase: 'not the passphrase' });
      assert(!result.ok, 'a wrong passphrase must not unlock the vault');
      assertEqual(result.code, 'EBADPASS', 'the refusal should be typed');
    });

    await test('the right passphrase unlocks it', async () => {
      const result = await ask({ type: 'ui:vault-unlock', passphrase: PASSPHRASE });
      assert(result.ok, `unlock failed: ${result.error}`);

      const state = await ask({ type: 'ui:get-state' });
      const profile = await ask({
        type: 'ui:get-profile',
        profileId: state.data.settings.activeProfileId,
      });
      assert(profile.ok, 'the profile should be readable again');
      assertEqual(
        profile.data.personal.email.value,
        TEST_PROFILE.email,
        'data survived the round trip',
      );
    });

    await test('changing the passphrase re-encrypts everything', async () => {
      const changed = await ask({
        type: 'ui:vault-change-passphrase',
        current: PASSPHRASE,
        next: 'a completely different passphrase',
      });
      assert(changed.ok, `change failed: ${changed.error}`);

      await ask({ type: 'ui:vault-lock' });
      const stale = await ask({ type: 'ui:vault-unlock', passphrase: PASSPHRASE });
      assert(!stale.ok, 'the old passphrase must stop working');

      const fresh = await ask({
        type: 'ui:vault-unlock',
        passphrase: 'a completely different passphrase',
      });
      assert(fresh.ok, 'the new passphrase should work');

      const state = await ask({ type: 'ui:get-state' });
      const profile = await ask({
        type: 'ui:get-profile',
        profileId: state.data.settings.activeProfileId,
      });
      assert(profile.ok, 'the profile should survive a passphrase change');
      assertEqual(
        profile.data.education[0].institution,
        TEST_PROFILE.institution,
        'education survived re-encryption',
      );
    });

    await test('filling works again once unlocked', async () => {
      const page = await browser.newPage();
      await page.goto(`${server.origin}/greenhouse.html`, { waitUntil: 'domcontentloaded' });
      await scanPage(worker, `${server.origin}/greenhouse.html`);
      await waitForWidget(page, (state) => state.text.includes('application field'));
      assert(await clickWidgetButton(page, 'Fill'), 'the Fill button was not found');
      await waitForWidget(page, (state) => state.text.includes('updated'));

      const values = await readInputs(page, ['first_name', 'email']);
      assertEqual(values.first_name, TEST_PROFILE.firstName, 'filling should work when unlocked');
      await page.close();
    });

    await test('turning encryption off restores plaintext storage', async () => {
      const disabled = await ask({
        type: 'ui:vault-disable',
        passphrase: 'a completely different passphrase',
      });
      assert(disabled.ok, `disable failed: ${disabled.error}`);

      const status = await ask({ type: 'ui:vault-status' });
      assertEqual(status.data.state, 'off', 'encryption should be off');

      const state = await ask({ type: 'ui:get-state' });
      const profile = await ask({
        type: 'ui:get-profile',
        profileId: state.data.settings.activeProfileId,
      });
      assert(profile.ok, 'the profile should be readable with encryption off');
      assertEqual(profile.data.personal.email.value, TEST_PROFILE.email, 'data survived');
    });

    /* --- importing a real PDF through the UI -------------------------- */

    await test('a PDF resume imports and saves through the Resume pane', async () => {
      const { buildPdf } = await import('./make-pdf.mjs');
      const { writeFileSync: write, mkdtempSync } = await import('node:fs');
      const { join } = await import('node:path');
      const { tmpdir } = await import('node:os');

      const dir = mkdtempSync(join(tmpdir(), 'fw-pdf-'));
      const file = join(dir, 'resume.pdf');
      write(file, buildPdf());

      const page = await browser.newPage();
      const failures = [];
      page.on('pageerror', (error) => failures.push(error.message));
      await page.evaluateOnNewDocument(() => {
        window.__rejections = [];
        window.addEventListener('unhandledrejection', (event) => {
          window.__rejections.push(String(event.reason));
        });
      });

      await page.goto(`chrome-extension://${extensionId}/options.html#/import`, {
        waitUntil: 'networkidle0',
      });

      const input = await page.$('input[type="file"]');
      assert(input, 'the file input was not found');
      await input.uploadFile(file);

      await page.waitForFunction(
        () => document.body.innerText.indexOf('Here is what Fillwright read') !== -1,
        { timeout: 20_000 },
      );

      // pdf.js hands its worker the byte buffer and detaches the original. The
      // import still needs those bytes to store the file, so this is where the
      // "Saving to your profile…" hang used to begin.
      await page.evaluate(() => {
        const button = Array.from(document.querySelectorAll('button')).find(
          (candidate) => (candidate.textContent || '').trim().indexOf('Save to my profile') === 0,
        );
        if (button) button.click();
      });

      const outcome = await page
        .waitForFunction(
          () => {
            const text = document.body.innerText;
            if (text.indexOf('Profile updated') !== -1) return 'saved';
            if (text.indexOf('Try again') !== -1) return 'error';
            return false;
          },
          { timeout: 20_000 },
        )
        .then((handle) => handle.jsonValue())
        .catch(() => 'HUNG');

      const rejections = await page.evaluate(() => window.__rejections || []);
      assertEqual(
        outcome,
        'saved',
        `the PDF import did not complete (${rejections.join(' | ') || 'no rejection recorded'})`,
      );
      assertEqual(rejections.length, 0, `unhandled rejection: ${rejections.join(' | ')}`);
      assertEqual(failures.length, 0, `page error: ${failures.join(' | ')}`);

      await page.close();
    });

    await test('the imported PDF is stored, not silently dropped', async () => {
      const page = await browser.newPage();
      await page.goto(`chrome-extension://${extensionId}/options.html`, {
        waitUntil: 'domcontentloaded',
      });
      const stored = await page.evaluate(async () => {
        const state = await chrome.runtime.sendMessage({ type: 'ui:get-state' });
        const profile = await chrome.runtime.sendMessage({
          type: 'ui:get-profile',
          profileId: state.data.settings.activeProfileId,
        });
        return profile.ok ? { resumes: profile.data.resumeIds.length } : null;
      });
      await page.close();

      assert(stored, 'the profile could not be read back');
      assert(stored.resumes >= 1, 'the resume file was not kept');
    });

    /* --- v0.5: proactive modes, corrections, SPA, focus, portability --- */

    await runV05Suite({
      browser,
      worker,
      extensionId,
      server,
      test,
      assert,
      assertEqual,
      scanPage,
      evalInWorker,
      foreign,
    });

    /* --- real-world ATS layouts ------------------------------------------ */

    await runAtsSuite({
      browser,
      worker,
      extensionId,
      server,
      test,
      assert,
      assertEqual,
      evalInWorker,
    });

    /* --- accessibility ---------------------------------------------------- */

    await runA11ySuite({ browser, worker, extensionId, server, test, assert, evalInWorker });

    /* --- first run --------------------------------------------------------- */

    await runEditorSuite({
      browser,
      extensionId,
      server,
      test,
      assert,
      assertEqual,
      worker,
      evalInWorker,
    });

    await runOnboardingSuite({ browser, extensionId, test, assert, assertEqual });
  } finally {
    await browser.close();
    await server.close();
    await foreign?.close();
  }

  /* ------------------------------------------------------------- report */

  console.log('');
  for (const note of notes) console.log(`  · ${note}`);
  console.log(`\n  ${passed} passed, ${failures.length} failed\n`);

  if (failures.length > 0) {
    console.log('Failures:');
    for (const failure of failures) console.log(`  ${failure.name}\n    ${failure.message}`);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('\nThe end-to-end run could not start:\n', error);
  process.exit(1);
});
