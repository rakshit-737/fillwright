import { getSettings } from '@/storage/settings';

/**
 * Assist / Smart mode plumbing.
 *
 * In Manual mode Fillwright is injected only when the user invokes it, through
 * `activeTab`, and needs no site access at all. The other modes need to run on
 * pages the user has not clicked on yet, which is only possible with the
 * optional `https://*\/*` host permission — requested from the settings page,
 * where the user sees Chrome's own prompt and can refuse.
 *
 * With the permission granted and a proactive mode chosen, the content script
 * is registered dynamically. Removing either one unregisters it, so the
 * permission and the behaviour can never drift apart.
 */

export const AUTO_SCRIPT_ID = 'fillwright-auto-detect';
export const AUTO_ORIGINS = ['https://*/*'];

export async function hasSiteAccess(): Promise<boolean> {
  try {
    return await chrome.permissions.contains({ origins: AUTO_ORIGINS });
  } catch {
    return false;
  }
}

export async function syncAutoDetect(): Promise<{ registered: boolean; reason: string }> {
  const settings = await getSettings();
  const wanted = settings.autofill.mode !== 'manual';
  const access = wanted && (await hasSiteAccess());

  let existing: chrome.scripting.RegisteredContentScript[] = [];
  try {
    existing = await chrome.scripting.getRegisteredContentScripts({ ids: [AUTO_SCRIPT_ID] });
  } catch {
    existing = [];
  }

  if (!access) {
    if (existing.length > 0) {
      await chrome.scripting
        .unregisterContentScripts({ ids: [AUTO_SCRIPT_ID] })
        .catch(() => undefined);
    }
    return {
      registered: false,
      reason: wanted ? 'site access has not been granted' : 'manual mode',
    };
  }

  if (existing.length === 0) {
    await chrome.scripting.registerContentScripts([
      {
        id: AUTO_SCRIPT_ID,
        matches: AUTO_ORIGINS,
        js: ['content.js'],
        runAt: 'document_idle',
        // Top frame only. Application iframes (iCIMS) are reached by an explicit
        // activation, which injects into every frame of that one tab.
        allFrames: false,
        persistAcrossSessions: true,
      },
    ]);
  }
  return { registered: true, reason: 'active' };
}
