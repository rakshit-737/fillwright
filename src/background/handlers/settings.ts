import { handle, ok, err } from '../router';
import { getSettings, setSettings } from '@/storage/settings';
import { listProfiles } from '@/storage/profiles';
import { hasSiteAccess, syncAutoDetect } from '../auto-detect';
import { validateSettingsPatch } from '@/security/boundary';
import type { UiRequest } from '@/types/messages';

export function registerSettingsHandlers(): void {
  handle('ui:get-settings', async () => ok(await getSettings()));

  handle('ui:set-settings', async (request) => {
    const { patch } = request as Extract<UiRequest, { type: 'ui:set-settings' }>;
    const checked = validateSettingsPatch(patch);
    if (!checked.ok) return err(checked.error, checked.code);
    const mode = checked.value.autofill?.mode;
    const next = await setSettings(checked.value);
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
