import { handle, ok, err } from '../router';
import {
  createProfile,
  deleteProfile,
  getProfile,
  listProfiles,
  saveProfile,
} from '@/storage/profiles';
import { getSettings, setSettings } from '@/storage/settings';
import { sanitizeString } from '@/security/validate';
import type { UiRequest } from '@/types/messages';

export function registerProfileHandlers(): void {
  handle('ui:list-profiles', async () => ok(await listProfiles()));

  handle('ui:get-profile', async (request) => {
    const { profileId } = request as Extract<UiRequest, { type: 'ui:get-profile' }>;
    const profile = await getProfile(sanitizeString(profileId, 64));
    return profile ? ok(profile) : err('Profile not found', 'ENOTFOUND');
  });

  handle('ui:save-profile', async (request) => {
    const { profile } = request as Extract<UiRequest, { type: 'ui:save-profile' }>;
    if (!profile?.id) return err('Profile is missing an id', 'EBADPROFILE');
    return ok(await saveProfile(profile));
  });

  handle('ui:create-profile', async (request) => {
    const { name, cloneFromId } = request as Extract<UiRequest, { type: 'ui:create-profile' }>;
    const profile = await createProfile(
      sanitizeString(name, 80) || 'Untitled Profile',
      cloneFromId,
    );
    const settings = await getSettings();
    if (!settings.activeProfileId) await setSettings({ activeProfileId: profile.id });
    return ok(profile);
  });

  handle('ui:delete-profile', async (request) => {
    const { profileId } = request as Extract<UiRequest, { type: 'ui:delete-profile' }>;
    await deleteProfile(sanitizeString(profileId, 64));
    const settings = await getSettings();
    if (settings.activeProfileId === profileId) {
      const remaining = await listProfiles();
      await setSettings({ activeProfileId: remaining[0]?.id ?? null });
    }
    return ok({ deleted: profileId });
  });

  handle('ui:set-active-profile', async (request) => {
    const { profileId } = request as Extract<UiRequest, { type: 'ui:set-active-profile' }>;
    const profile = await getProfile(sanitizeString(profileId, 64));
    if (!profile) return err('Profile not found', 'ENOTFOUND');
    return ok(await setSettings({ activeProfileId: profile.id }));
  });
}
