import { handle, ok, err } from '../router';
import { getProfile } from '@/storage/profiles';
import { getSettings } from '@/storage/settings';
import { listMappings, saveMapping } from '@/storage/mappings';
import { logApplication } from '@/storage/history';
import { buildMappings, buildFillPlan } from '@/autofill/plan';
import { originFromUrl, pageKeyFromUrl, sanitizeString } from '@/security/validate';
import { validateScan } from '@/security/scan-guard';
import { FIELD_CATALOG } from '@/field-detection/catalog';
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
  if (!tab?.id || !tab.url) return err('No active tab', 'ENOTAB');
  if (!/^https?:/.test(tab.url)) {
    return err('Fillwright only works on web pages.', 'EBADSCHEME');
  }

  try {
    // Marks this injection as an explicit activation, so the content script
    // scans immediately instead of applying the passive-mode checks. A
    // serialised function, not a string — nothing here is evaluated as code.
    await chrome.scripting.executeScript({
      target: { tabId: tab.id, allFrames: true },
      func: () => {
        (globalThis as unknown as { __fillwrightActivation?: number }).__fillwrightActivation =
          Date.now();
      },
    });
    // activeTab grants access only because the user just invoked us. The
    // script is a bundled file — never remote, never generated from a string.
    // Re-running it on an already-injected page triggers a fresh scan.
    await chrome.scripting.executeScript({
      target: { tabId: tab.id, allFrames: true },
      files: ['content.js'],
    });
  } catch (cause) {
    return err(
      cause instanceof Error ? cause.message : 'Fillwright could not read this page.',
      'EINJECT',
    );
  }

  return ok({ started: true });
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

function sanitizeOverrides(raw: unknown, origin: string): SavedMapping[] {
  if (!Array.isArray(raw)) return [];
  const known = new Set<string>(FIELD_CATALOG.map((entry) => entry.field));
  return raw.slice(0, 100).flatMap((item, index) => {
    const fingerprint = sanitizeString((item as { fingerprint?: unknown })?.fingerprint, 240);
    const canonical = sanitizeString((item as { canonical?: unknown })?.canonical, 64);
    if (!fingerprint || !known.has(canonical)) return [];
    return [
      {
        id: `override-${index}`,
        origin,
        fingerprint,
        label: '',
        canonical: canonical as CanonicalField,
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
    const { scan, overrides } = request as Extract<
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
      return err('No profile is set up yet. Import a resume first.', 'ENOPROFILE');
    }
    const profile = await getProfile(settings.activeProfileId);
    if (!profile) return err('The active profile could not be loaded.', 'ENOPROFILE');

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

    return ok({
      plan: buildFillPlan(resolved, `${Date.now()}`, {
        education: profile.education.length,
        experience: profile.experience.length,
      }),
      // The name only, so the panel can say which profile it is using.
      profileName: profile.name,
      settings: {
        previewBeforeFill: settings.autofill.previewBeforeFill,
        highlightFilledFields: settings.autofill.highlightFilledFields,
        reducedMotion: settings.ui.reducedMotion,
        theme: settings.ui.theme,
        diagnostics: settings.advanced.diagnostics,
      },
    });
  });

  /** The user taught Fillwright what a field on this site means. */
  handle('content:save-mapping', async (request, sender) => {
    const { mapping } = request as Extract<ContentRequest, { type: 'content:save-mapping' }>;
    const origin = originFromUrl(sender.tab?.url ?? sender.url ?? '');
    if (!origin) return err('Unknown sender', 'ENOSENDER');

    const saved = await saveMapping({
      origin,
      fingerprint: sanitizeString(mapping.fingerprint, 240),
      label: sanitizeString(mapping.label, 120),
      canonical: mapping.canonical,
      ...(mapping.customKey ? { customKey: sanitizeString(mapping.customKey, 80) } : {}),
    });
    return ok(saved);
  });

  /** Optional, off by default, and metadata only. */
  handle('content:log-application', async (request, sender) => {
    const payload = request as Extract<ContentRequest, { type: 'content:log-application' }>;
    const origin = originFromUrl(sender.tab?.url ?? sender.url ?? '');
    const entry = await logApplication({
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

  handle('content:fill-complete', async (request) => {
    const { outcomes } = request as Extract<ContentRequest, { type: 'content:fill-complete' }>;
    // Counts only. Field values are never recorded, here or anywhere else.
    const filled = Array.isArray(outcomes) ? outcomes.filter((outcome) => outcome?.ok).length : 0;
    return ok({ filled });
  });

  /** Relays a fill request from the popup to the tab the user is looking at. */
  handle('ui:request-fill', async (request) => {
    const { entries } = request as Extract<UiRequest, { type: 'ui:request-fill' }>;
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return err('No active tab', 'ENOTAB');
    const response = await chrome.tabs
      .sendMessage(tab.id, { type: 'bg:fill', entries })
      .catch(() => null);
    return response ? ok(response) : err('The page did not respond.', 'ENORESP');
  });

  handle('ui:undo-fill', async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return err('No active tab', 'ENOTAB');
    const response = await chrome.tabs.sendMessage(tab.id, { type: 'bg:undo' }).catch(() => null);
    return response ? ok(response) : err('The page did not respond.', 'ENORESP');
  });
}
