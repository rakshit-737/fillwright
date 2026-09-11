import { handle, ok, err } from '../router';
import { getProfile } from '@/storage/profiles';
import { getSettings } from '@/storage/settings';
import { listMappings, saveMapping } from '@/storage/mappings';
import { logApplication } from '@/storage/history';
import { buildMappings, buildFillPlan } from '@/autofill/plan';
import { originFromUrl, pageKeyFromUrl, sanitizeString } from '@/security/validate';
import { validateScan } from '@/security/scan-guard';
import type { ScanResult } from '@/types/fields';
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
export function registerAutofillHandlers(): void {
  /** The user asked for a scan from the popup or the keyboard shortcut. */
  handle('ui:scan-active-tab', async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || !tab.url) return err('No active tab', 'ENOTAB');
    if (!/^https?:/.test(tab.url)) {
      return err('Fillwright only works on web pages.', 'EBADSCHEME');
    }

    try {
      // activeTab grants access only because the user just invoked us. The
      // script is a bundled file — never remote, never generated from a string.
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

    const response = await chrome.tabs.sendMessage(tab.id, { type: 'bg:scan' }).catch(() => null);
    return ok({ started: true, responded: Boolean(response) });
  });

  /**
   * A content script has harvested fields and wants them mapped to values.
   * This is the only path by which profile data reaches a page.
   */
  handle('content:request-mappings', async (request, sender) => {
    const { scan } = request as Extract<ContentRequest, { type: 'content:request-mappings' }>;

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

    const saved = await listMappings(origin);
    const mappings = buildMappings(safeScan.fields, profile, settings, saved);

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
