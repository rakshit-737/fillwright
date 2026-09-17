/**
 * Store screenshots, 1280×800, from the real extension.
 *
 * Trust boundary: a developer tool. Launches Chrome for Testing with the test
 * build, seeds an obviously fictional profile through the normal message
 * channel, and captures local fixture pages and Fillwright's own pages. No
 * real person's data and no real website appear in the images.
 *
 *   npm run screenshots   → store/screenshots/*.png
 */
import { mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  launch,
  evalInWorker,
  waitForWidget,
  clickWidgetButton,
  sleep,
} from '../tests/e2e/harness.mjs';
import { startServer } from '../tests/e2e/server.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = resolve(root, 'store/screenshots');
mkdirSync(out, { recursive: true });

const VIEWPORT = { width: 1280, height: 800, deviceScaleFactor: 1 };
const server = await startServer(resolve(root, 'test-pages'));
const { browser, worker, extensionId } = await launch({ headless: true });
const options = (route) => `chrome-extension://${extensionId}/options.html#/${route}`;

async function seed() {
  const page = await browser.newPage();
  await page.goto(options('privacy'), { waitUntil: 'domcontentloaded' });
  await page.evaluate(async () => {
    const send = (m) => chrome.runtime.sendMessage(m);
    const prov = { source: 'user', confidence: 1, updatedAt: new Date().toISOString() };
    const tv = (value) => ({ value, provenance: prov });
    const created = await send({ type: 'ui:create-profile', name: 'Software Engineering' });
    const p = created.data;
    p.personal.firstName = tv('Alex');
    p.personal.lastName = tv('Example');
    p.personal.fullName = tv('Alex Example');
    p.personal.email = tv('alex@example.com');
    p.personal.phone = tv('+1 555 010 0100');
    p.address.city = tv('Springfield');
    p.address.country = tv('United States');
    p.links.linkedin = tv('https://linkedin.com/in/alex-example');
    p.links.github = tv('https://github.com/alex-example');
    p.summary = tv('Backend engineer who likes reliable payment systems.');
    p.education = [
      {
        id: 'e1',
        institution: 'Example State University',
        degree: 'B.Tech',
        major: 'Computer Science',
        minor: '',
        location: '',
        startDate: '2021-08',
        endDate: '2025-05',
        graduationDate: '2025-05',
        gpa: '8.9',
        gpaScale: '10',
        honors: '',
        coursework: [],
        current: false,
        provenance: prov,
      },
    ];
    p.experience = [
      {
        id: 'x1',
        company: 'Example Payments',
        title: 'Software Engineering Intern',
        employmentType: 'internship',
        location: '',
        locationType: '',
        startDate: '2024-06',
        endDate: '2024-08',
        current: false,
        description: 'Built billing dashboards.',
        highlights: [],
        technologies: [],
        provenance: prov,
      },
    ];
    p.skills = ['Python', 'Go', 'React', 'PostgreSQL'].map((name, i) => ({
      id: `s${i}`,
      name,
      category: '',
      proficiency: '',
      yearsOfExperience: '',
      provenance: prov,
    }));
    await send({ type: 'ui:save-profile', profile: p });
    await send({ type: 'ui:set-active-profile', profileId: p.id });
    await send({ type: 'ui:set-settings', patch: { onboardingCompleted: true } });
  });
  await page.close();
}

async function shot(name, open) {
  const page = await browser.newPage();
  await page.setViewport(VIEWPORT);
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);
  await open(page);
  await sleep(400);
  const path = resolve(out, `${name}.png`);
  await page.screenshot({
    path,
    clip: { x: 0, y: 0, width: VIEWPORT.width, height: VIEWPORT.height },
  });
  console.log(`  wrote ${path}`);
  await page.close();
}

async function panelOn(page, url) {
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
}

try {
  await seed();
  await shot('1-panel-on-form', (page) => panelOn(page, `${server.origin}/store-demo.html?shot=1`));
  await shot('2-review-list', async (page) => {
    await panelOn(page, `${server.origin}/store-demo.html?shot=2`);
    await clickWidgetButton(page, 'Review');
    await waitForWidget(page, (s) => s.items.length > 0);
  });
  await shot('3-profile-editor', (page) =>
    page.goto(options('profile'), { waitUntil: 'networkidle0' }),
  );
  await shot('4-privacy-center', (page) =>
    page.goto(options('privacy'), { waitUntil: 'networkidle0' }),
  );
  await shot('5-vault', (page) => page.goto(options('security'), { waitUntil: 'networkidle0' }));
} finally {
  await browser.close();
  await server.close();
}
