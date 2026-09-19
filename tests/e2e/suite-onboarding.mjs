/**
 * First run, end to end: welcome → import → details → practice fill →
 * privacy → finish, including resuming after a reload.
 *
 * Trust note: drives the TEST build only. Runs last, because it imports a
 * resume into the active profile (fill-gaps, so earlier values are kept).
 */
import { sleep } from './harness.mjs';

const RESUME = `Priya Natarajan
priya.natarajan@example.com | +91 90000 11111 | Chennai, India
linkedin.com/in/priya-n | github.com/priyan

EDUCATION
Anna University — B.E. Computer Science, 2021 – 2025

EXPERIENCE
Software Engineering Intern, Freshworks — Chennai
Jun 2024 – Aug 2024
- Built billing dashboards in React

SKILLS
Python, React, SQL`;

export async function runOnboardingSuite(ctx) {
  const { browser, extensionId, test, assert, assertEqual } = ctx;
  const options = `chrome-extension://${extensionId}/options.html`;
  const text = (page) => page.evaluate(() => document.body.innerText);
  const explain = (page, what) => async (cause) => {
    const body = await page.evaluate(() => document.body.innerText.slice(0, 600)).catch(() => '');
    throw new Error(`${what}: ${cause.message}
      page: ${body.replace(/\s+/g, ' ')}`);
  };
  const waitText = (page, needle, timeout = 15_000) =>
    page
      .waitForFunction((n) => document.body.innerText.includes(n), { timeout }, needle)
      .catch(explain(page, `waiting for "${needle}"`));
  const waitStep = (page, title, timeout = 15_000) =>
    page
      .waitForFunction(
        (t) => document.querySelector('.fw-welcome__title')?.textContent === t,
        { timeout },
        title,
      )
      .catch(explain(page, `waiting for step "${title}"`));
  const press = (page, label) =>
    page.evaluate((l) => {
      const button = Array.from(document.querySelectorAll('button')).find(
        (b) => b.textContent.trim() === l && !b.disabled,
      );
      if (!button) return false;
      button.click();
      return true;
    }, label);

  await test('onboarding: a new user reaches a filled practice form, resuming after a reload', async () => {
    const started = Date.now();
    const page = await browser.newPage();
    await page.goto(options, { waitUntil: 'networkidle0' });
    await waitText(page, 'Step 1 of 5');

    assert(await press(page, 'Continue'), 'no Continue on step 1');
    await waitStep(page, 'Import your resume');
    await page.type('textarea[aria-label="Resume text"]', RESUME);
    assert(await press(page, 'Read pasted text'), 'no Read pasted text');
    await waitText(page, 'Here is what Fillwright read');
    await page.evaluate(() =>
      Array.from(document.querySelectorAll('button'))
        .find((b) => b.textContent.trim().startsWith('Save to my profile'))
        .click(),
    );
    await waitStep(page, 'Check your details');
    await waitText(page, 'Email');

    // Close and come back: setup resumes at the same step.
    await page.reload({ waitUntil: 'networkidle0' });
    await waitText(page, 'Step 3 of 5');
    await waitStep(page, 'Check your details');

    assert(await press(page, 'Continue'), 'no Continue on step 3');
    await waitStep(page, 'Try it');
    const practiceTarget = browser.waitForTarget((t) => t.url().endsWith('/practice.html'));
    assert(await press(page, 'Open the practice form'), 'no practice button');
    const practice = await (await practiceTarget).page();
    await practice.waitForFunction(
      () => {
        // The practice page is Fillwright's own page; its panel is reached
        // through the widget element the page created.
        const host = document.querySelector('[data-fillwright-widget]');
        return host !== null;
      },
      { timeout: 15_000 },
    );
    // The panel's root is closed even here; drive it with the keyboard, as a
    // user would: focus lands on the primary action ("Fill N ready").
    await practice.waitForFunction(
      () => document.activeElement?.hasAttribute('data-fillwright-widget'),
      { timeout: 15_000 },
    );
    // Fill arms only after the panel has been visible for about 500 ms.
    await sleep(1_000);
    await practice.keyboard.press('Enter');
    await practice.waitForFunction(() => document.getElementById('email').value !== '', {
      timeout: 15_000,
    });
    const filled = await practice.evaluate(() => ({
      email: document.getElementById('email').value,
      why: document.getElementById('why').value,
    }));
    assert(filled.email.includes('@'), 'the practice form was not filled');
    assertEqual(filled.why, '', 'the written question was filled');
    await practice.close();

    await page.bringToFront();
    await waitText(page, 'Practice form filled');
    assert(await press(page, 'Continue'), 'no Continue on step 4');
    await waitStep(page, 'Your privacy');
    const privacy = await text(page);
    assert(privacy.includes('Network requests are blocked'), 'network fact missing');
    assert(
      /No website access is granted|can read these sites without a click/.test(privacy),
      'host-access fact missing',
    );
    assert(privacy.includes('Nothing is ever submitted automatically'), 'submission fact missing');

    assert(await press(page, 'Finish'), 'no Finish');
    await page.waitForFunction(() => location.hash === '#/profile', { timeout: 10_000 });
    const settings = await page.evaluate(() =>
      chrome.runtime.sendMessage({ type: 'ui:get-settings' }),
    );
    assertEqual(settings.data.onboardingCompleted, true, 'setup was not recorded as complete');

    const seconds = (Date.now() - started) / 1000;
    assert(seconds < 180, `setup took ${seconds.toFixed(0)} s`);
    await page.close();
    await sleep(100);
  });
}
