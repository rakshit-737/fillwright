import { beforeEach, describe, expect, it } from 'vitest';
import { senderMayCall } from '@/background/router';
import { parseImport, conformProfile } from '@/profile/portable';
import { draftFacts } from '@/background/handlers/assist';
import { buildMappings, buildFillPlan, fingerprintOf } from '@/autofill/plan';
import { harvestFields } from '@/field-detection/harvest';
import { createEmptyProfile, tv } from '@/profile/factory';
import { emptyExperience } from '@/profile/entries';
import { DEFAULT_SETTINGS } from '@/types/settings';
import { FillwrightWidget, countsFor, type WidgetCallbacks } from '@/content/widget';
import type { FillPlan } from '@/types/fields';

const EXT = 'chrome-extension://fillwright-test/';

describe('message sender gate', () => {
  it('lets extension pages send ui messages', () => {
    expect(
      senderMayCall('ui:export-data', { id: 'fillwright-test', url: `${EXT}options.html` }),
    ).toBe(true);
  });

  it('refuses profile-reading ui messages from content scripts', () => {
    const tab = {
      id: 'fillwright-test',
      url: 'https://evil.example/apply',
      tab: { id: 3 },
    } as chrome.runtime.MessageSender;
    expect(senderMayCall('ui:export-data', tab)).toBe(false);
    expect(senderMayCall('ui:get-profile', tab)).toBe(false);
    expect(senderMayCall('ui:set-settings', tab)).toBe(false);
  });

  it('still allows the narrow content surface and the unlock shortcut', () => {
    const tab = { id: 'fillwright-test', url: 'https://jobs.example/apply' };
    expect(senderMayCall('content:request-mappings', tab)).toBe(true);
    expect(senderMayCall('ui:open-security', tab)).toBe(true);
  });

  it('refuses other extensions', () => {
    expect(senderMayCall('ui:export-data', { id: 'someone-else', url: `${EXT}options.html` })).toBe(
      false,
    );
  });
});

describe('import hardening', () => {
  const profile = () => {
    const p = createEmptyProfile('Security');
    p.personal.firstName = tv('Aditi', 'user', 1);
    p.experience = [{ ...emptyExperience(), company: 'Acme', title: 'Analyst' }];
    p.sensitive.workAuthorization.authorizedIn = { US: 'yes' };
    return p;
  };

  it('round-trips a profile with fresh ids', () => {
    const source = profile();
    const plan = parseImport({
      format: 'fillwright-export',
      version: 2,
      profiles: [source],
      mappings: [],
    });
    const imported = plan.profiles[0]!;
    expect(imported.id).not.toBe(source.id);
    expect(imported.experience[0]!.id).not.toBe(source.experience[0]!.id);
    expect(imported.personal.firstName.value).toBe('Aditi');
    expect(imported.experience[0]!.company).toBe('Acme');
    expect(imported.sensitive.workAuthorization.authorizedIn).toEqual({ US: 'yes' });
    expect(imported.resumeIds).toEqual([]);
  });

  it('drops unknown keys, wrong types and invalid enums', () => {
    const shaped = conformProfile({
      name: 'X',
      evil: '<script>',
      personal: { firstName: { value: 42, provenance: { source: 'hacker' } } },
      experience: ['not an object', { company: 'Ok', __proto__: { polluted: true } }],
      sensitive: {
        background: { criminalHistory: 'maybe' },
        workAuthorization: { authorizedIn: { US: 'definitely', UK: 'no' } },
      },
    });
    expect('evil' in shaped).toBe(false);
    expect(shaped.personal.firstName.value).toBe('');
    expect(shaped.personal.firstName.provenance.source).toBe('default');
    expect(shaped.experience).toHaveLength(1);
    expect(shaped.experience[0]!.highlights).toEqual([]);
    expect(shaped.sensitive.background.criminalHistory).toBe('unset');
    expect(shaped.sensitive.workAuthorization.authorizedIn).toEqual({ UK: 'no' });
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('renames on name collision instead of replacing', () => {
    const plan = parseImport({ profiles: [profile()] }, ['Security']);
    expect(plan.profiles[0]!.name).toBe('Security (imported)');
  });

  it('rejects other files and newer formats', () => {
    expect(() => parseImport({ format: 'something-else', profiles: [] })).toThrow();
    expect(() =>
      parseImport({ format: 'fillwright-export', version: 99, profiles: [profile()] }),
    ).toThrow(/newer/);
    expect(() => parseImport([])).toThrow();
    expect(() => parseImport({ profiles: ['x'] })).toThrow(/No usable/);
  });

  it('keeps only valid mappings and never imports vault state', () => {
    const plan = parseImport({
      profiles: [profile()],
      mappings: [
        {
          origin: 'https://jobs.example.com/x',
          fingerprint: 'cand id',
          canonical: 'personal.email',
          label: 'ID',
        },
        { origin: 'javascript:alert(1)', fingerprint: 'a', canonical: 'personal.email' },
        { origin: 'https://ok.example', fingerprint: 'b', canonical: 'not.a.field' },
      ],
      settings: {
        privacy: { encryptionEnabled: true, autoLockMinutes: 7 },
        autofill: { mode: 'autopilot', confidenceThreshold: 0.01 },
      },
    });
    expect(plan.mappings).toHaveLength(1);
    expect(plan.mappings[0]!.origin).toBe('https://jobs.example.com');
    const settings = plan.settings as Record<string, Record<string, unknown>>;
    expect(settings.privacy).not.toHaveProperty('encryptionEnabled');
    expect(settings.privacy!.autoLockMinutes).toBe(30);
    expect(settings.autofill!.mode).toBe('manual');
    expect(settings.autofill!.confidenceThreshold).toBe(0.5);
  });
});

describe('one-off corrections', () => {
  it('applies a correction for this form without marking it remembered', () => {
    document.body.innerHTML = '<label for="a">Candidate Reference</label><input id="a" name="ref">';
    const { fields } = harvestFields(document);
    const profile = createEmptyProfile('T');
    profile.personal.email = tv('a@example.com', 'user', 1);

    const mappings = buildMappings(fields, profile, DEFAULT_SETTINGS, [
      {
        id: 'override-0',
        origin: 'https://x.example',
        fingerprint: fingerprintOf(fields[0]!),
        label: '',
        canonical: 'personal.email',
        createdAt: '',
        useCount: 0,
      },
    ]);
    expect(mappings[0]!.canonical).toBe('personal.email');
    expect(mappings[0]!.fromSavedRule).toBe(false);
    expect(mappings[0]!.corrected).toBe(true);

    const plan = buildFillPlan(
      { url: '', pageKey: '', adapterId: null, scannedAt: '', fields, mappings },
      '1',
    );
    expect(plan.entries[0]!.remembered).toBe(false);
    expect(plan.entries[0]!.corrected).toBe(true);
  });
});

describe('draft facts', () => {
  it('offers career facts only — never contact or sensitive answers', () => {
    const profile = createEmptyProfile('T');
    profile.personal.email = tv('secret@example.com', 'user', 1);
    profile.personal.phone = tv('+1 555 0100', 'user', 1);
    profile.sensitive.demographics.gender = 'female';
    profile.summary = tv('Security analyst.', 'user', 1);
    profile.experience = [{ ...emptyExperience(), company: 'Acme', title: 'Analyst' }];

    const facts = draftFacts(profile);
    const text = JSON.stringify(facts);
    expect(facts.map((fact) => fact.id)).toEqual(['summary', 'exp-0']);
    expect(text).not.toContain('secret@example.com');
    expect(text).not.toContain('555');
    expect(text).not.toContain('female');
  });
});

describe('on-page panel', () => {
  const plan: FillPlan = {
    scanId: '1',
    readyCount: 1,
    reviewCount: 1,
    skippedCount: 0,
    blocks: { education: 0, experience: 0 },
    available: { education: 0, experience: 0 },
    entries: [
      {
        fieldId: 'f1',
        label: 'First name',
        canonical: 'personal.firstName',
        currentValue: '',
        newValue: 'Aditi',
        status: 'ready',
        confidence: 0.97,
        rationale: 'Matched "first name".',
        selected: true,
        fingerprint: 'first name',
        remembered: false,
      },
      {
        fieldId: 'f2',
        label: 'Why us?',
        canonical: 'unknown',
        currentValue: '',
        newValue: '',
        status: 'manual-required',
        confidence: 0,
        rationale: 'A written question.',
        selected: false,
        fingerprint: 'why us',
        remembered: false,
      },
    ],
  };

  const noop: WidgetCallbacks = {
    onFill: () => undefined,
    onUndo: () => undefined,
    onClose: () => undefined,
    onRescan: () => undefined,
    onOpen: () => undefined,
    onTeach: () => undefined,
    onListProfiles: async () => [],
    onSwitchProfile: () => undefined,
    onAddEntries: () => undefined,
    onOpenPage: () => undefined,
    onReload: () => undefined,
    onUnlock: () => undefined,
    canDraft: () => false,
    onDraftStart: () => undefined,
    onDraftGenerate: () => undefined,
    onDraftUse: () => undefined,
  };

  beforeEach(() => {
    document.documentElement
      .querySelectorAll('[data-fillwright-widget]')
      .forEach((node) => node.remove());
  });

  it('hides its contents from page scripts', () => {
    const widget = new FillwrightWidget(noop, true, { trust: () => true });
    widget.renderPlan(plan);
    const host = document.querySelector('[data-fillwright-widget]') as HTMLElement;
    expect(host.shadowRoot).toBeNull();
    expect(widget.shadow.textContent).toContain('2 application fields found');
    widget.destroy();
  });

  it('moves through states and minimises on Escape', () => {
    const widget = new FillwrightWidget(noop, true, { trust: () => true });
    widget.renderAnalyzing();
    expect(widget.state).toBe('analyzing');
    widget.renderPlan(plan);
    expect(widget.state).toBe('ready');
    widget.shadow
      .querySelector('.fw-widget')!
      .dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(widget.shadow.querySelector('.fw-pill')?.textContent).toContain('1 ready');
    widget.markFilled({ filled: 1, failures: [], remaining: 1, manual: 1 });
    expect(widget.state).toBe('partial');
    expect(widget.shadow.textContent).toContain('1 need your input');
    widget.markUndone(1);
    expect(widget.state).toBe('undo');
    widget.destroy();
  });

  it('offers Change on confident rows, not only doubtful ones', () => {
    const widget = new FillwrightWidget(noop, true, { trust: () => true });
    widget.renderPlan(plan);
    const review = [...widget.shadow.querySelectorAll('button')].find(
      (b) => b.textContent === 'Review',
    )!;
    review.click();
    const labels = [...widget.shadow.querySelectorAll('button')].map((b) => b.textContent);
    expect(labels).toContain('Change');
    expect(labels).toContain('Set what this is');
    widget.destroy();
  });

  it('counts fields the way the headline reads', () => {
    expect(countsFor(plan)).toEqual({ ready: 1, review: 0, needsYou: 1, filled: 0 });
  });
});
