import { handle, ok } from '../router';
import { getSettings, setSettings } from '@/storage/settings';
import { listProfiles } from '@/storage/profiles';
import { hasSiteAccess, syncAutoDetect } from '../auto-detect';
import { AUTOFILL_MODES } from '@/types/settings';
import { pruneHistory } from '@/storage/history';
import { isRetentionChoice } from '@/storage/history-model';
import type { UiRequest } from '@/types/messages';

export function registerSettingsHandlers(): void {
  handle('ui:get-settings', async () => ok(await getSettings()));

  handle('ui:set-settings', async (request) => {
    const { patch } = request as Extract<UiRequest, { type: 'ui:set-settings' }>;
    const mode = patch.autofill?.mode;
    if (mode !== undefined && !AUTOFILL_MODES.includes(mode)) {
      delete patch.autofill!.mode;
    }
    const retention = patch.privacy?.historyRetentionMonths;
    if (retention !== undefined && !isRetentionChoice(retention)) {
      delete patch.privacy!.historyRetentionMonths;
    }
    const next = await setSettings(patch);
    if (retention !== undefined) await pruneHistory();
    if (mode !== undefined) await syncAutoDetect().catch(() => undefined);
    return ok(next);
  });

  /** Re-checks permission and registration; the settings page calls this after Chrome's prompt. */
  handle('ui:sync-auto-detect', async () => {
    const result = await syncAutoDetect();
    return ok({ ...result, siteAccess: await hasSiteAccess() });
  });

  /** One round-trip for everything the popup renders on open. */
  handle('ui:get-state', async () => {
    const [settings, profiles] = await Promise.all([getSettings(), listProfiles()]);
    return ok({ settings, profiles });
  });
}
