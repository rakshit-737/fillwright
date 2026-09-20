import { getSettings } from '@/storage/settings';
import { grantedSiteOrigins } from '@/utils/site-access';

/**
 * Assist / Smart mode plumbing.
 *
 * Trust boundary: service worker. Decides, from settings and granted
 * permissions only, whether the content script is registered on pages the
 * user has not clicked on.
 *
 * In Manual mode Fillwright is injected only when the user invokes it, through
 * `activeTab`, and needs no site access at all. The other modes need to run on
 * pages the user has not clicked on yet, which is only possible with the
 * optional host permissions — requested from the settings page (job sites by
 * default, every https site only as a second step) or from the popup (this one
 * site), where the user sees Chrome's own prompt and can refuse.
 *
 * With the permission granted and a proactive mode chosen, the content script
 * is registered dynamically. Removing either one unregisters it, so the
 * permission and the behaviour can never drift apart.
 */

export const AUTO_SCRIPT_ID = 'fillwright-auto-detect';

/**
 * The script is registered for exactly what Chrome reports as granted — the
 * job-site tier, single sites turned on from the popup, localhost, or every
 * https site if the user took that explicit step. Nothing more.
 */
export async function grantedOrigins(): Promise<string[]> {
  return grantedSiteOrigins();
}

export async function hasSiteAccess(): Promise<boolean> {
  return (await grantedOrigins()).length > 0;
}

export async function syncAutoDetect(): Promise<{ registered: boolean; reason: string }> {
  const settings = await getSettings();
  const wanted = settings.autofill.mode !== 'manual';
  const origins = wanted ? await grantedOrigins() : [];

  let existing: chrome.scripting.RegisteredContentScript[] = [];
  try {
    existing = await chrome.scripting.getRegisteredContentScripts({ ids: [AUTO_SCRIPT_ID] });
  } catch {
    existing = [];
  }
  const current = existing[0];

  if (origins.length === 0) {
    if (current) {
      await chrome.scripting
        .unregisterContentScripts({ ids: [AUTO_SCRIPT_ID] })
        .catch(() => undefined);
    }
    return {
      registered: false,
      reason: wanted ? 'site access has not been granted' : 'manual mode',
    };
  }

  const same =
    current !== undefined &&
    [...(current.matches ?? [])].sort().join(' ') === [...origins].sort().join(' ');
  if (same) return { registered: true, reason: 'active' };

  if (current) {
    await chrome.scripting
      .unregisterContentScripts({ ids: [AUTO_SCRIPT_ID] })
      .catch(() => undefined);
  }
  await chrome.scripting.registerContentScripts([
    {
      id: AUTO_SCRIPT_ID,
      matches: origins,
      js: ['content.js'],
      runAt: 'document_idle',
      // Top frame only. Application iframes (iCIMS) are reached by an explicit
      // activation, which injects into every frame of that one tab.
      allFrames: false,
      persistAcrossSessions: true,
    },
  ]);
  return { registered: true, reason: 'active' };
}
