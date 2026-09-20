/**
 * Click-jacking: a hostile page tries to press "Fill" without the user seeing
 * the panel. Fixture: test-pages/clickjack.html.
 */
import { clickWidgetButton, waitForWidget, sleep } from './harness.mjs';

export async function runClickjackSuite(ctx) {
  const { browser, worker, server, test, assert, assertEqual, scanPage } = ctx;
  const url = `${server.origin}/clickjack.html`;

  const formValues = (page) =>
    page.evaluate(() => ({
      first: document.getElementById('c-first').value,
      email: document.getElementById('c-email').value,
    }));

  const fillState = (page) =>
    page.evaluate(() => {
      const root = document.querySelector('[data-fillwright-widget]').shadowRoot;
      const button = Array.from(root.querySelectorAll('button')).find((b) =>
        (b.textContent || '').trim().startsWith('Fill'),
      );
      if (!button) return null;
      const rect = button.getBoundingClientRect();
      return {
        armed: !button.disabled && button.getAttribute('aria-disabled') !== 'true',
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
        topLayer: document.querySelector('[data-fillwright-widget]').matches(':popover-open'),
      };
    });

  await test('click-jacking: synthetic clicks, a see-through overlay, then a real click', async () => {
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await scanPage(worker, url);
    await waitForWidget(page, (s) => s.text.includes('application field'));

    // The panel is in the top layer and arms after its visibility delay.
    await sleep(1_200);
    const initial = await fillState(page);
    assert(initial, 'no Fill button');
    assert(initial.topLayer, 'the panel is not shown as a top-layer popover');
    assert(initial.armed, 'Fill never armed on an unobscured panel');

    // 1. Synthetic events from page script are ignored, even when armed.
    assertEqual(await page.evaluate(() => window.__fwAttack.synthetic()), true, 'no target');
    await sleep(800);
    assertEqual(
      JSON.stringify(await formValues(page)),
      JSON.stringify({ first: '', email: '' }),
      'a synthetic click filled the form',
    );

    // 2. A see-through, pointer-events:none overlay kept above the panel.
    await page.evaluate(() => window.__fwAttack.cover());
    await sleep(1_500);
    const covered = await fillState(page);
    assertEqual(covered.armed, false, 'Fill stayed armed under an overlay');
    const text = await page.evaluate(
      () => document.querySelector('[data-fillwright-widget]').shadowRoot.textContent,
    );
    assert(text.includes('covering Fillwright'), 'the panel did not say why Fill is paused');
    // A real click at the button's position falls through the overlay onto Fill.
    await page.mouse.click(covered.x, covered.y);
    await sleep(1_000);
    assertEqual(
      JSON.stringify(await formValues(page)),
      JSON.stringify({ first: '', email: '' }),
      'a click through the overlay filled the form',
    );

    // 3. Overlay gone: after the arming delay a normal click works.
    await page.evaluate(() => window.__fwAttack.uncover());
    assert(await clickWidgetButton(page, 'Fill'), 'no Fill button');
    await page.waitForFunction(() => document.getElementById('c-email').value !== '', {
      timeout: 15_000,
    });
    const filled = await formValues(page);
    assert(filled.email.includes('@'), 'a normal click after arming did not fill');
    await page.close();
  });
}
