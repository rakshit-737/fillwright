import { handle, ok } from '../router';
import { getSettings, setSettings } from '@/storage/settings';
import { listProfiles } from '@/storage/profiles';
import type { UiRequest } from '@/types/messages';

export function registerSettingsHandlers(): void {
  handle('ui:get-settings', async () => ok(await getSettings()));

  handle('ui:set-settings', async (request) => {
    const { patch } = request as Extract<UiRequest, { type: 'ui:set-settings' }>;
    return ok(await setSettings(patch));
  });

  /** One round-trip for everything the popup renders on open. */
  handle('ui:get-state', async () => {
    const [settings, profiles] = await Promise.all([getSettings(), listProfiles()]);
    return ok({ settings, profiles });
  });
}
