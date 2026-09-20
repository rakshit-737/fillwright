import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetStorage } from './setup';

/**
 * Every control on the Settings page must change something a user can see.
 * One test (or more) per control; a setting nothing reads is removed instead.
 */

const mappingStore = vi.hoisted(() => ({
  rows: [] as Array<{ id: string; origin: string; disabled?: boolean; useCount: number }>,
  used: [] as string[],
}));

vi.mock('@/storage/profiles', async () => {
  const { createEmptyProfile } = await import('@/profile/factory');
  return { getProfile: vi.fn(async () => createEmptyProfile('Test')) };
});

vi.mock('@/storage/mappings', () => ({
  listMappings: vi.fn(async (origin?: string) =>
    mappingStore.rows.filter((row) => !origin || row.origin === origin),
  ),
  saveMapping: vi.fn(),
  recordMappingUse: vi.fn(async (id: string) => void mappingStore.used.push(id)),
}));

import { DEFAULT_SETTINGS, SETTINGS_VERSION, type Settings } from '@/types/settings';
import { getSettings, setSettings } from '@/storage/settings';
import { buildMappings, fingerprintOf } from '@/autofill/plan';
import { harvestFields } from '@/field-detection/harvest';
import { createEmptyProfile, tv } from '@/profile/factory';
import { FillwrightWidget, type WidgetCallbacks } from '@/content/widget';
import { themedCss } from '@/content/theme';
import { logApplication } from '@/storage/history';
import { handle } from '@/background/router';

const handlers = new Map<string, (request: unknown, sender: unknown) => Promise<unknown>>();
vi.mock('@/background/router', async (original) => {
  const actual = await original<typeof import('@/background/router')>();
  return {
    ...actual,
    handle: (type: string, fn: (request: unknown, sender: unknown) => Promise<unknown>) =>
      void handlers.set(type, fn),
  };
});

const { registerAutofillHandlers } = await import('@/background/handlers/autofill');
registerAutofillHandlers();
void handle;

function settingsWith(patch: (s: Settings) => void): Settings {
  const copy = structuredClone(DEFAULT_SETTINGS);
  patch(copy);
  return copy;
}

function scan(html: string) {
  document.body.innerHTML = html;
  return harvestFields(document).fields;
}

const profile = (() => {
  const p = createEmptyProfile('Test');
  p.personal.firstName = tv('Aditi', 'user', 1);
  p.personal.email = tv('aditi@example.com', 'user', 1);
  return p;
})();

const noop = new Proxy({} as WidgetCallbacks, { get: () => () => undefined });

beforeEach(() => {
  resetStorage();
  mappingStore.rows = [];
  mappingStore.used = [];
});

describe('dead settings are gone', () => {
  it('drops keys nothing reads', () => {
    expect(DEFAULT_SETTINGS.autofill).not.toHaveProperty('fillEmptyFieldsOnly');
    expect(DEFAULT_SETTINGS.autofill).not.toHaveProperty('previewBeforeFill');
    expect(DEFAULT_SETTINGS.ai).not.toHaveProperty('assistFieldMapping');
  });

  it('migrates a stored v2 record to v3 and removes the dead keys', async () => {
    await chrome.storage.local.set({
      settings: {
        version: 2,
        autofill: { fillEmptyFieldsOnly: false, previewBeforeFill: false, allowOverwrite: true },
        ai: { assistFieldMapping: true },
        privacy: { encryptionEnabled: true },
      },
    });
    const settings = await getSettings();
    expect(SETTINGS_VERSION).toBe(3);
    expect(settings.autofill).not.toHaveProperty('fillEmptyFieldsOnly');
    expect(settings.autofill).not.toHaveProperty('previewBeforeFill');
    expect(settings.ai).not.toHaveProperty('assistFieldMapping');
    expect(settings.privacy).not.toHaveProperty('encryptionEnabled');
    expect(settings.autofill.allowOverwrite).toBe(true);
    const stored = (await chrome.storage.local.get('settings')).settings as {
      version: number;
      autofill: Record<string, unknown>;
    };
    expect(stored.version).toBe(3);
    expect(stored.autofill).not.toHaveProperty('previewBeforeFill');
  });
});

describe('Autofill section', () => {
  it('allowOverwrite: a field with a value is skipped unless overwriting is on', () => {
    const fields = scan('<label>First name <input name="first" value="Old"></label>');
    const off = buildMappings(fields, profile, DEFAULT_SETTINGS)[0]!;
    const on = buildMappings(
      fields,
      profile,
      settingsWith((s) => (s.autofill.allowOverwrite = true)),
    )[0]!;
    expect(off.status).toBe('skipped-existing');
    expect(on.status).toBe('ready');
  });

  it('confidenceThreshold: a match below the bar is shown for review', () => {
    const fields = scan('<label>First name <input name="first"></label>');
    const low = buildMappings(fields, profile, DEFAULT_SETTINGS)[0]!;
    const strict = buildMappings(
      fields,
      profile,
      settingsWith((s) => (s.autofill.confidenceThreshold = 1)),
    )[0]!;
    expect(low.status).toBe('ready');
    expect(strict.status).toBe('review');
  });

  it('highlightFilledFields, diagnostics, theme and motion reach the panel with the plan', async () => {
    const fields = scan('<label>First name <input name="first"></label>');
    const ask = async () =>
      (
        (await handlers.get('content:request-mappings')!(
          {
            type: 'content:request-mappings',
            scan: { url: '', pageKey: '', adapterId: null, scannedAt: '', fields, mappings: [] },
          },
          { url: 'https://jobs.example/apply' },
        )) as { ok: true; data: { settings: Record<string, unknown> } }
      ).data.settings;
    await setSettings({ activeProfileId: 'p1' });
    expect(await ask()).toEqual({
      highlightFilledFields: true,
      diagnostics: false,
      theme: 'system',
      reducedMotion: false,
    });
    await setSettings({
      autofill: { highlightFilledFields: false },
      advanced: { diagnostics: true },
      ui: { theme: 'dark', reducedMotion: true },
    });
    expect(await ask()).toEqual({
      highlightFilledFields: false,
      diagnostics: true,
      theme: 'dark',
      reducedMotion: true,
    });
  });
});

describe('Privacy section', () => {
  it('keepApplicationHistory: nothing is logged while it is off', async () => {
    const entry = await logApplication({
      company: 'Acme',
      role: 'Engineer',
      origin: 'https://jobs.example',
      fieldsFilled: 3,
    });
    expect(entry).toBeNull();
  });
});

describe('Appearance section', () => {
  const css = [
    '.fw-card { background: #fff; }',
    '@media (prefers-color-scheme: dark) { .fw-card { background: #111; } .fw-x { color: red; } }',
    '.fw-tail { color: blue; }',
    '@media (prefers-color-scheme:dark){.fw-y{color:#222}}',
  ].join('\n');

  it('theme: light drops the dark rules, dark applies them unconditionally', () => {
    expect(themedCss(css, 'system')).toBe(css);
    const light = themedCss(css, 'light');
    expect(light).not.toContain('#111');
    expect(light).not.toContain('#222');
    expect(light).toContain('.fw-tail');
    const dark = themedCss(css, 'dark');
    expect(dark).not.toContain('prefers-color-scheme');
    expect(dark).toContain('.fw-card { background: #111; }');
    expect(dark).toContain('.fw-y{color:#222}');
    expect(dark.indexOf('#111')).toBeGreaterThan(dark.indexOf('#fff'));
  });

  it('theme and reducedMotion: the panel applies them when the plan arrives', () => {
    const widget = new FillwrightWidget(noop, false);
    const container = widget.shadow.querySelector('.fw-widget')!;
    expect(container.getAttribute('data-reduced-motion')).toBeNull();
    widget.setAppearance({ theme: 'dark', reducedMotion: true });
    expect(container.getAttribute('data-reduced-motion')).toBe('true');
    expect(container.getAttribute('data-theme')).toBe('dark');
    const style = widget.shadow.querySelector('style')!.textContent ?? '';
    expect(style).not.toContain('prefers-color-scheme');
    widget.setAppearance({ theme: 'light', reducedMotion: false });
    expect(container.getAttribute('data-reduced-motion')).toBeNull();
    expect(widget.shadow.querySelector('style')!.textContent).not.toContain('prefers-color-scheme');
    widget.destroy();
  });

  it('showFloatingWidget: an uninvited script stays quiet when it is off', async () => {
    const sender = { url: 'https://jobs.example/apply' };
    await setSettings({ activeProfileId: 'p1' });
    const on = (await handlers.get('content:get-mode')!({ type: 'content:get-mode' }, sender)) as {
      data: { enabled: boolean };
    };
    await setSettings({ ui: { showFloatingWidget: false } });
    const off = (await handlers.get('content:get-mode')!({ type: 'content:get-mode' }, sender)) as {
      data: { enabled: boolean };
    };
    expect(on.data.enabled).toBe(true);
    expect(off.data.enabled).toBe(false);
  });
});

describe('remembered mappings', () => {
  it('carry their id into the plan so a fill can count it', () => {
    const fields = scan('<label>Given name here <input name="gn"></label>');
    const mapping = buildMappings(fields, profile, DEFAULT_SETTINGS, [
      {
        id: 'map-1',
        origin: 'https://jobs.example',
        fingerprint: fingerprintOf(fields[0]!),
        label: 'Given name here',
        canonical: 'personal.firstName',
        createdAt: '',
        useCount: 0,
      },
    ])[0]!;
    expect(mapping.savedMappingId).toBe('map-1');
  });

  it('the worker counts only ids that belong to the sender site', async () => {
    mappingStore.rows = [
      { id: 'map-1', origin: 'https://jobs.example', useCount: 0 },
      { id: 'map-2', origin: 'https://other.example', useCount: 0 },
      { id: 'map-3', origin: 'https://jobs.example', useCount: 0, disabled: true },
    ];
    await handlers.get('content:fill-complete')!(
      {
        type: 'content:fill-complete',
        outcomes: [{ fieldId: 'a', ok: true }],
        mappingIds: ['map-1', 'map-2', 'map-3', 'map-1', 42],
      },
      { url: 'https://jobs.example/apply' },
    );
    expect(mappingStore.used).toEqual(['map-1']);
  });
});

describe('consent checkboxes', () => {
  it('are never ticked, even with a matching saved rule', () => {
    const fields = scan(
      '<label><input type="checkbox" name="c"> I certify that the information above is true</label>',
    );
    const [mapping] = buildMappings(fields, profile, DEFAULT_SETTINGS);
    expect(mapping!.status).toBe('needs-consent');
    expect(mapping!.proposedValue).toBe('');
  });
});

describe('check-settings script', () => {
  it('lists a default that no source reads', async () => {
    // @ts-expect-error - plain .mjs build script without types
    const { leafKeys, unusedKeys } = await import('../scripts/check-settings.mjs');
    const keys = leafKeys(
      "export const DEFAULT_SETTINGS: X = {\n  a: 1,\n  ui: {\n    theme: 'system',\n    ghost: true,\n  },\n  version: 3,\n};",
    );
    expect(keys).toEqual(['a', 'ui.theme', 'ui.ghost']);
    expect(unusedKeys(keys, ['x.a + s.ui.theme'])).toEqual(['ui.ghost']);
  });
});
