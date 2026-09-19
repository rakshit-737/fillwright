/**
 * Automated WCAG 2.1 AA checks with axe-core, in real Chrome.
 *
 * Trust boundary: test-only. axe is injected into extension pages with the
 * test browser's CSP bypass, and into fixture pages; the shipped extension
 * never loads it.
 */
import { createRequire } from 'node:module';
import { waitForWidget, clickWidgetButton, sleep } from './harness.mjs';

const require = createRequire(import.meta.url);
const AXE = require.resolve('axe-core/axe.min.js');

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

export async function runA11ySuite(ctx) {
  const { browser, extensionId, server, test, assert, worker, evalInWorker } = ctx;

  async function audit(page, context) {
    await page.addScriptTag({ path: AXE });
    return page.evaluate(
      async (tags, include) => {
        const result = await window.axe.run(include ? { include } : document, {
          runOnly: { type: 'tag', values: tags },
          resultTypes: ['violations'],
        });
        return result.violations.map((v) => ({
          id: v.id,
          impact: v.impact,
          help: v.help,
          targets: v.nodes
            .slice(0, 4)
            .map((n) => `${n.target.join(' >>> ')} ${n.failureSummary?.split('\n')[1] ?? ''}`),
        }));
      },
      TAGS,
      context ?? null,
    );
  }

  const describe = (violations) =>
    violations
      .map((v) => `${v.impact} ${v.id}: ${v.help}\n        ${v.targets.join('\n        ')}`)
      .join('\n      ');

  async function extensionPage(path, scheme, attempt = 0) {
    try {
      return await openExtensionPage(path, scheme);
    } catch (cause) {
      // A freshly closed tab can race page creation in headless Chrome.
      if (attempt < 2 && /Protocol error|Session/.test(String(cause))) {
        await sleep(300);
        return extensionPage(path, scheme, attempt + 1);
      }
      throw cause;
    }
  }

  async function openExtensionPage(path, scheme) {
    const page = await browser.newPage();
    await page.setBypassCSP(true);
    await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: scheme }]);
    await page.goto(`chrome-extension://${extensionId}/${path}`, { waitUntil: 'networkidle0' });
    await sleep(500);
    return page;
  }

  const routes = [
    'welcome',
    'profile',
    'import',
    'preferences',
    'profiles',
    'history',
    'learned',
    'privacy',
    'security',
    'permissions',
    'settings',
    'assistance',
  ];

  for (const scheme of ['light', 'dark']) {
    await test(`a11y/${scheme}: every options pane passes WCAG 2.1 AA checks`, async () => {
      const failures = [];
      for (const route of routes) {
        const page = await extensionPage(`options.html#/${route}`, scheme);
        const violations = await audit(page);
        if (violations.length) failures.push(`#/${route}\n      ${describe(violations)}`);
        await page.close();
      }
      assert(failures.length === 0, failures.join('\n      '));
    });

    await test(`a11y/${scheme}: the popup passes WCAG 2.1 AA checks`, async () => {
      const page = await extensionPage('popup.html', scheme);
      const violations = await audit(page);
      assert(violations.length === 0, describe(violations));
      await page.close();
    });

    await test(`a11y/${scheme}: the on-page panel passes WCAG 2.1 AA checks`, async () => {
      const url = `${server.origin}/greenhouse.html?a11y-${scheme}`;
      const page = await browser.newPage();
      await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: scheme }]);
      await page.goto(url, { waitUntil: 'networkidle0' });
      await evalInWorker(
        worker,
        `(async () => {
          const [tab] = await chrome.tabs.query({ url: ${JSON.stringify(url)} });
          await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => { globalThis.__fillwrightActivation = Date.now(); } });
          await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
        })()`,
      );
      await waitForWidget(page, (s) => s.text.includes('application field'));
      await clickWidgetButton(page, 'Review');
      await waitForWidget(page, (s) => s.items.length > 0);
      // Open one explanation and one correction picker so their markup is checked too.
      await page.evaluate(() => {
        const root = document.querySelector('[data-fillwright-widget]').shadowRoot;
        const buttons = Array.from(root.querySelectorAll('button'));
        buttons.find((b) => b.textContent === 'Why?')?.click();
      });
      await sleep(100);
      await page.evaluate(() => {
        const root = document.querySelector('[data-fillwright-widget]').shadowRoot;
        Array.from(root.querySelectorAll('button'))
          .find((b) => b.textContent === 'Change')
          ?.click();
      });
      await sleep(200);
      // And the in-row editor for "Edit for this form".
      await page.evaluate(() => {
        const root = document.querySelector('[data-fillwright-widget]').shadowRoot;
        Array.from(root.querySelectorAll('button'))
          .find((b) => b.textContent === 'Edit for this form')
          ?.click();
      });
      await sleep(200);
      const violations = await audit(page, [['[data-fillwright-widget]', '.fw-widget']]);
      assert(violations.length === 0, describe(violations));
      await page.close();
    });
  }

  await test('a11y: toggling a row by keyboard keeps focus and the list scroll position', async () => {
    const url = `${server.origin}/perf-fifty.html?a11y-review`;
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: 'networkidle0' });
    await evalInWorker(
      worker,
      `(async () => {
        const [tab] = await chrome.tabs.query({ url: ${JSON.stringify(url)} });
        await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => { globalThis.__fillwrightActivation = Date.now(); } });
        await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
      })()`,
    );
    await waitForWidget(page, (s) => s.text.includes('application field'));
    await clickWidgetButton(page, 'Review');
    await waitForWidget(page, (s) => s.items.length >= 15);

    // Scroll the 15th checkbox into the list's view and focus it.
    const before = await page.evaluate(() => {
      const root = document.querySelector('[data-fillwright-widget]').shadowRoot;
      const boxes = Array.from(root.querySelectorAll('.fw-list input.fw-check'));
      const box = boxes[14];
      if (!box) return { count: boxes.length };
      const list = root.querySelector('.fw-list');
      box.scrollIntoView({ block: 'center' });
      box.focus();
      return {
        count: boxes.length,
        key: box.getAttribute('data-fw-key'),
        checked: box.checked,
        scrollTop: list.scrollTop,
      };
    });
    assert(before.count >= 15, `only ${before.count} checkboxes in the list`);
    assert(before.scrollTop > 0, 'the list did not scroll, so the check would prove nothing');

    await page.keyboard.press('Space');
    await sleep(150);

    const after = await page.evaluate(() => {
      const root = document.querySelector('[data-fillwright-widget]').shadowRoot;
      const active = root.activeElement;
      return {
        key: active?.getAttribute('data-fw-key') ?? null,
        checked: active?.checked ?? null,
        scrollTop: root.querySelector('.fw-list').scrollTop,
      };
    });
    assert(after.key === before.key, `focus moved to ${after.key}, expected ${before.key}`);
    assert(after.checked === !before.checked, 'Space did not toggle the checkbox');
    assert(
      after.scrollTop === before.scrollTop,
      `the list scrolled from ${before.scrollTop} to ${after.scrollTop}`,
    );
    await page.close();
  });

  await test('a11y: the panel announces its tally once, not on every redraw', async () => {
    const url = `${server.origin}/spa-steps.html?a11y`;
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: 'networkidle0' });
    await evalInWorker(
      worker,
      `(async () => {
        const [tab] = await chrome.tabs.query({ url: ${JSON.stringify(url)} });
        await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => { globalThis.__fillwrightActivation = Date.now(); } });
        await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
      })()`,
    );
    await waitForWidget(page, (s) => s.text.includes('application field'));
    await page.evaluate(() => {
      const live = document
        .querySelector('[data-fillwright-widget]')
        .shadowRoot.querySelector('[aria-live]');
      window.__announcements = [];
      new MutationObserver(() => window.__announcements.push(live.textContent)).observe(live, {
        childList: true,
        characterData: true,
        subtree: true,
      });
    });
    // Toggling the list and redrawing must not re-announce the same tally.
    for (let i = 0; i < 3; i++) {
      await clickWidgetButton(page, 'Review');
      await sleep(100);
      await clickWidgetButton(page, 'Hide list');
      await sleep(100);
    }
    const announcements = await page.evaluate(() => window.__announcements);
    const tallies = announcements.filter((text) => /application fields found/.test(text));
    assert(tallies.length === 0, `the tally was re-announced: ${JSON.stringify(announcements)}`);
    await page.close();
  });

  await test('a11y: reduced motion stops the panel spinner', async () => {
    const url = `${server.origin}/greenhouse.html?motion`;
    const page = await browser.newPage();
    await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
    await page.goto(url, { waitUntil: 'networkidle0' });
    await evalInWorker(
      worker,
      `(async () => {
        const [tab] = await chrome.tabs.query({ url: ${JSON.stringify(url)} });
        await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => { globalThis.__fillwrightActivation = Date.now(); } });
        await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
      })()`,
    );
    await waitForWidget(page, (s) => s.text.includes('application field'));
    const animation = await page.evaluate(() => {
      const root = document.querySelector('[data-fillwright-widget]').shadowRoot;
      const probe = document.createElement('span');
      probe.className = 'fw-spinner';
      root.querySelector('.fw-widget').appendChild(probe);
      const name = getComputedStyle(probe).animationName;
      probe.remove();
      return name;
    });
    assert(animation === 'none', `spinner still animates: ${animation}`);
    for (const path of ['popup.html', 'options.html#/profile']) {
      const ext = await browser.newPage();
      await ext.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
      await ext.goto(`chrome-extension://${extensionId}/${path}`, { waitUntil: 'networkidle0' });
      const name = await ext.evaluate(() => {
        const probe = document.createElement('span');
        probe.className = 'fw-spinner';
        document.body.appendChild(probe);
        return getComputedStyle(probe).animationName;
      });
      assert(name === 'none', `${path} spinner still animates: ${name}`);
      await ext.close();
    }
    await page.close();
  });

  await test('a11y: every keyboard stop in settings and the popup shows focus', async () => {
    for (const path of ['options.html#/settings', 'options.html#/learned', 'popup.html']) {
      const page = await extensionPage(path, 'light');
      const seen = new Set();
      const invisible = [];
      for (let i = 0; i < 45; i++) {
        await page.keyboard.press('Tab');
        const stop = await page.evaluate(() => {
          const el = document.activeElement;
          if (!el || el === document.body) return null;
          const style = getComputedStyle(el);
          const visible =
            (style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0) ||
            (style.boxShadow && style.boxShadow !== 'none');
          const name = `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''} "${(el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 30)}"`;
          return { name, visible };
        });
        if (!stop) continue;
        if (seen.has(stop.name)) continue;
        seen.add(stop.name);
        if (!stop.visible) invisible.push(stop.name);
      }
      const minimum = path === 'popup.html' ? 2 : 4;
      assert(seen.size >= minimum, `${path}: keyboard reached only ${seen.size} controls`);
      assert(invisible.length === 0, `${path}: no visible focus on ${invisible.join(', ')}`);
      await page.close();
    }
  });
}
