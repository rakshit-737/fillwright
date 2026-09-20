import { handle, ok, err } from '../router';
import { getProfile } from '@/storage/profiles';
import { getSettings } from '@/storage/settings';
import { listMappings, recordMappingUse, saveMapping } from '@/storage/mappings';
import { logApplication } from '@/storage/history';
import { buildMappings, buildFillPlan, withoutValues } from '@/autofill/plan';
import { originFromUrl, pageKeyFromUrl, sanitizeString } from '@/security/validate';
import { validateScan } from '@/security/scan-guard';
import { classifyField } from '@/field-detection/classify';
import { scoreApplicationContext } from '@/field-detection/context';
import { describeError, unsupportedPageCode } from '@/utils/errors';
import { FIELD_CATALOG } from '@/field-detection/catalog';
import { isValidCustomKey } from '@/autofill/saved-answers';
import type { CanonicalField, SavedMapping, ScanResult } from '@/types/fields';
import type { ContentRequest, UiRequest } from '@/types/messages';

/**
 * Autofill message handlers.
 *
 * The trust boundary runs right through here. A content script lives in a page
 * we do not control, so:
 *
 *  - every scan arriving from a tab is shape-checked and size-capped before the
 *    profile is even loaded (`validateScan`);
 *  - a plan is only ever returned to the tab that asked for it, and only for
 *    the origin it actually reported;
 *  - the profile itself is never sent to a page. Only the specific values the
 *    plan proposes cross back, which is the minimum needed to fill a form.
 */
export async function scanActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return fail('ENOTAB');
  // Chrome withholds the URL when it has not granted access to this tab.
  if (!tab.url) return fail('ENOACCESS');
  const unsupported = unsupportedPageCode(tab.url);
  if (unsupported) return fail(unsupported);

  // Marks this injection as an explicit activation, so the content script
  // scans immediately instead of applying the passive-mode checks. A
  // serialised function, not a string — nothing here is evaluated as code.
  const mark = () => {
    (globalThis as unknown as { __fillwrightActivation?: number }).__fillwrightActivation =
      Date.now();
  };

  // activeTab grants access only because the user just invoked us. The script
  // is a bundled file — never remote, never generated from a string. Re-running
  // it on an already-injected page triggers a fresh scan.
  //
  // Every frame is tried first, so same-origin application iframes work. A
  // cross-origin frame the tab grant does not cover makes that call fail as a
  // whole; the top frame alone is then tried, and it reports the frame to the
  // user itself.
  for (const allFrames of [true, false]) {
    try {
      await chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames }, func: mark });
      await chrome.scripting.executeScript({
        target: { tabId: tab.id, allFrames },
        files: ['content.js'],
      });
      return ok({ started: true, allFrames });
    } catch (cause) {
      if (!allFrames) {
        const text = cause instanceof Error ? cause.message : '';
        return fail(/gallery|webstore/i.test(text) ? 'ESTORE' : 'EINJECT');
      }
    }
  }
  return fail('EINJECT');
}

function fail(code: string) {
  return err(describeError(code).message, code);
}

export interface StepProgress {
  origin: string;
  /** Fields filled per step, keyed by a page-derived step identity. */
  steps: Record<string, number>;
  filled: number;
  updatedAt: number;
}

const PROGRESS_TTL_MS = 2 * 60 * 60 * 1000;

function progressKey(tabId: number): string {
  return `progress:${tabId}`;
}

function emptyProgress(origin: string): StepProgress {
  return { origin, steps: {}, filled: 0, updatedAt: Date.now() };
}

/**
 * Progress lives in `storage.session`: memory-only, cleared when the browser
 * closes, and not readable by content scripts. It is dropped when the tab moves
 * to another site or has been idle for two hours.
 */
async function readProgress(tabId: number, origin: string): Promise<StepProgress | null> {
  const key = progressKey(tabId);
  const stored = (await chrome.storage.session.get(key))[key] as StepProgress | undefined;
  if (!stored || stored.origin !== origin || Date.now() - stored.updatedAt > PROGRESS_TTL_MS)
    return null;
  return stored;
}

const ASSIGNABLE = new Set<string>(FIELD_CATALOG.map((entry) => entry.field));

/**
 * A correction arriving from a page: one of the picker's fields, or `custom`
 * with a key naming one of the user's custom fields or saved answers. Anything
 * else (a demographic, `unknown`, a malformed key) is refused.
 */
export function sanitizeCorrection(
  canonicalRaw: unknown,
  customKeyRaw: unknown,
): { canonical: CanonicalField; customKey?: string } | null {
  const canonical = sanitizeString(canonicalRaw, 64);
  if (canonical === 'custom') {
    const customKey = sanitizeString(customKeyRaw, 80);
    return isValidCustomKey(customKey) ? { canonical: 'custom', customKey } : null;
  }
  return ASSIGNABLE.has(canonical) ? { canonical: canonical as CanonicalField } : null;
}

function sanitizeOverrides(raw: unknown, origin: string): SavedMapping[] {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, 100).flatMap((item, index) => {
    const fingerprint = sanitizeString((item as { fingerprint?: unknown })?.fingerprint, 240);
    const correction = sanitizeCorrection(
      (item as { canonical?: unknown })?.canonical,
      (item as { customKey?: unknown })?.customKey,
    );
    if (!fingerprint || !correction) return [];
    return [
      {
        id: `override-${index}`,
        origin,
        fingerprint,
        label: '',
        ...correction,
        createdAt: '',
        useCount: 0,
      },
    ];
  });
}

export function registerAutofillHandlers(): void {
  /** The user asked for a scan from the popup or the keyboard shortcut. */
  handle('ui:scan-active-tab', () => scanActiveTab());

  /**
   * A content script has harvested fields and wants them mapped to values.
   * This is the only path by which profile data reaches a page.
   */
  handle('content:request-mappings', async (request, sender) => {
    const { scan, overrides, withholdValues } = request as Extract<
      ContentRequest,
      { type: 'content:request-mappings' }
    >;

    const guard = validateScan(scan);
    if (!guard.ok) return err(guard.error, 'EBADSCAN');
    const safeScan = guard.scan;

    // The page may claim any URL it likes, so the sender's real URL wins.
    const senderUrl = sender.tab?.url ?? sender.url ?? '';
    if (!senderUrl) return err('Unknown sender', 'ENOSENDER');
    const origin = originFromUrl(senderUrl);
    if (!origin) return err('Unsupported page', 'EBADORIGIN');

    const settings = await getSettings();
    if (!settings.activeProfileId) {
      return fail('ENOPROFILE');
    }
    const profile = await getProfile(settings.activeProfileId);
    if (!profile) return fail('ENOPROFILE');

    // Paused rules are kept for the user to re-enable, but never applied.
    const saved = (await listMappings(origin)).filter((mapping) => !mapping.disabled);
    const mappings = buildMappings(safeScan.fields, profile, settings, [
      ...sanitizeOverrides(overrides, origin),
      ...saved,
    ]);

    const resolved: ScanResult = {
      ...safeScan,
      url: senderUrl,
      pageKey: pageKeyFromUrl(senderUrl),
      mappings,
    };

    const plan = buildFillPlan(resolved, `${Date.now()}`, {
      education: profile.education.length,
      experience: profile.experience.length,
    });
    return ok({
      // Smart mode prepares a plan before the user has engaged. Until they
      // open the panel, only counts and statuses cross into the page.
      plan: withholdValues === true ? withoutValues(plan) : plan,
      // The name only, so the panel can say which profile it is using.
      profileName: profile.name,
      settings: {
        highlightFilledFields: settings.autofill.highlightFilledFields,
        diagnostics: settings.advanced.diagnostics,
        theme: settings.ui.theme,
        reducedMotion: settings.ui.reducedMotion,
      },
    });
  });

  /** The user taught Fillwright what a field on this site means. */
  handle('content:save-mapping', async (request, sender) => {
    const { mapping } = request as Extract<ContentRequest, { type: 'content:save-mapping' }>;
    const origin = originFromUrl(sender.tab?.url ?? sender.url ?? '');
    if (!origin) return err('Unknown sender', 'ENOSENDER');
    const correction = sanitizeCorrection(mapping?.canonical, mapping?.customKey);
    const fingerprint = sanitizeString(mapping?.fingerprint, 240);
    if (!correction || !fingerprint) return err('Not a field Fillwright can assign', 'EBADMAPPING');

    const saved = await saveMapping({
      origin,
      fingerprint,
      label: sanitizeString(mapping.label, 120),
      ...correction,
    });
    return ok(saved);
  });

  /**
   * The practice form in onboarding is an extension page, so it cannot use
   * the content-script path. Same guard, same planner; no site rules apply.
   * Only Fillwright's own pages can send `ui:*` messages (see router).
   */
  handle('ui:practice-plan', async (request) => {
    const { fields } = request as Extract<UiRequest, { type: 'ui:practice-plan' }>;
    const guard = validateScan({ fields });
    if (!guard.ok) return err(guard.error, 'EBADSCAN');
    const settings = await getSettings();
    if (!settings.activeProfileId) return fail('ENOPROFILE');
    const profile = await getProfile(settings.activeProfileId);
    if (!profile) return fail('ENOPROFILE');
    const scan: ScanResult = {
      url: '',
      pageKey: 'practice',
      adapterId: null,
      scannedAt: new Date().toISOString(),
      fields: guard.scan.fields,
      mappings: buildMappings(guard.scan.fields, profile, settings, []),
    };
    return ok({
      plan: buildFillPlan(scan, `${Date.now()}`, {
        education: profile.education.length,
        experience: profile.experience.length,
      }),
      profileName: profile.name,
    });
  });

  /** Optional, off by default, and metadata only. */
  handle('content:log-application', async (request, sender) => {
    const payload = request as Extract<ContentRequest, { type: 'content:log-application' }>;
    const origin = originFromUrl(sender.tab?.url ?? sender.url ?? '');
    if (!origin) return err('Unknown sender', 'ENOSENDER');
    const { activeProfileId } = await getSettings();
    const entry = await logApplication({
      ...(activeProfileId ? { profileId: activeProfileId } : {}),
      company: sanitizeString(payload.company, 120),
      role: sanitizeString(payload.role, 120),
      origin,
      fieldsFilled: Math.max(0, Math.min(500, Math.trunc(payload.fieldsFilled) || 0)),
    });
    return ok({ logged: entry !== null });
  });

  handle('content:ready', async () => ok({ acknowledged: true }));

  /**
   * A script that arrived by itself (Assist/Smart registration) asks whether to
   * do anything. It gets the mode and nothing else — no profile data.
   */
  handle('content:get-mode', async (_request, sender) => {
    const settings = await getSettings();
    const origin = originFromUrl(sender.tab?.url ?? sender.url ?? '');
    return ok({
      mode: settings.autofill.mode,
      enabled:
        settings.ui.showFloatingWidget && Boolean(origin) && Boolean(settings.activeProfileId),
      progress: sender.tab?.id !== undefined ? await readProgress(sender.tab.id, origin) : null,
    });
  });

  /**
   * Scores a page for Assist/Smart. The fields go through the same guard as a
   * scan; the page signals are capped here. Nothing is stored, and the reply
   * is only a level.
   */
  handle('content:assess-page', async (request, sender) => {
    const { fields, page } = request as Extract<ContentRequest, { type: 'content:assess-page' }>;
    const settings = await getSettings();
    if (settings.autofill.mode === 'manual') return err('Not in a proactive mode', 'EMANUAL');
    const guard = validateScan({ fields });
    if (!guard.ok) return err(guard.error, 'EBADSCAN');
    const raw = (page ?? {}) as Record<string, unknown>;
    const texts = (value: unknown, max: number) =>
      Array.isArray(value) ? value.slice(0, max).map((item) => sanitizeString(item, 160)) : [];
    let url = '';
    try {
      const parsed = new URL(sender.tab?.url ?? sender.url ?? '');
      url = `${parsed.hostname}${parsed.pathname}`;
    } catch {
      url = '';
    }
    const verdict = scoreApplicationContext({
      headings: texts(raw.headings, 12),
      buttonLabels: texts(raw.buttonLabels, 60),
      hasFileInput: raw.hasFileInput === true,
      passwordFields: Math.max(0, Math.min(50, Math.trunc(Number(raw.passwordFields)) || 0)),
      url,
      fieldKinds: guard.scan.fields.map((field) => classifyField(field.signals).field),
    });
    return ok({ level: verdict.level });
  });

  handle('content:get-progress', async (_request, sender) => {
    const origin = originFromUrl(sender.tab?.url ?? sender.url ?? '');
    if (sender.tab?.id === undefined || !origin) return ok(null);
    return ok(await readProgress(sender.tab.id, origin));
  });

  /** Counts per step of a multi-step application. Values are never recorded. */
  handle('content:step-progress', async (request, sender) => {
    const { filled, stepKey } = request as Extract<
      ContentRequest,
      { type: 'content:step-progress' }
    >;
    const origin = originFromUrl(sender.tab?.url ?? sender.url ?? '');
    if (sender.tab?.id === undefined || !origin) return err('Unknown sender', 'ENOSENDER');
    const key = sanitizeString(stepKey, 200);
    const count = Math.max(0, Math.min(500, Math.trunc(Number(filled)) || 0));

    const current = (await readProgress(sender.tab.id, origin)) ?? emptyProgress(origin);
    const steps = { ...current.steps, [key]: (current.steps[key] ?? 0) + count };
    // Bounded: a long SPA session cannot grow this without limit.
    const trimmed = Object.fromEntries(Object.entries(steps).slice(-20));
    const next: StepProgress = {
      origin,
      steps: trimmed,
      filled: Object.values(trimmed).reduce((sum, value) => sum + value, 0),
      updatedAt: Date.now(),
    };
    await chrome.storage.session.set({ [progressKey(sender.tab.id)]: next });
    return ok(next);
  });

  handle('content:fill-complete', async (request, sender) => {
    const { outcomes, mappingIds } = request as Extract<
      ContentRequest,
      { type: 'content:fill-complete' }
    >;
    // Counts only. Field values are never recorded, here or anywhere else.
    const filled = Array.isArray(outcomes) ? outcomes.filter((outcome) => outcome?.ok).length : 0;

    // Remembered mappings that were actually written, by id. Only ids of
    // active rules saved for the sender's own site are counted, once each.
    const origin = originFromUrl(sender.tab?.url ?? sender.url ?? '');
    if (origin && Array.isArray(mappingIds) && mappingIds.length > 0) {
      const wanted = new Set(
        mappingIds.slice(0, 400).filter((id): id is string => typeof id === 'string'),
      );
      const owned = (await listMappings(origin)).filter(
        (mapping) => !mapping.disabled && wanted.has(mapping.id),
      );
      for (const mapping of owned) await recordMappingUse(mapping.id);
    }
    return ok({ filled });
  });
}
