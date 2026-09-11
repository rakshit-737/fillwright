import { handle, ok } from '../router';
import { destroyDb, idb } from '@/storage/idb';
import { clearHistory, listHistory } from '@/storage/history';
import { deleteMapping, listMappings } from '@/storage/mappings';
import { clearSettings } from '@/storage/settings';
import { listProfiles, getProfile } from '@/storage/profiles';
import { sanitizeString } from '@/security/validate';
import type { UiRequest } from '@/types/messages';
import type { Profile } from '@/types/profile';

export function registerPrivacyHandlers(): void {
  handle('ui:list-history', async () => ok(await listHistory()));
  handle('ui:clear-history', async () => {
    await clearHistory();
    return ok({ cleared: true });
  });

  handle('ui:list-saved-mappings', async (request) => {
    const { origin } = request as Extract<UiRequest, { type: 'ui:list-saved-mappings' }>;
    return ok(await listMappings(origin ? sanitizeString(origin, 2048) : undefined));
  });

  handle('ui:delete-saved-mapping', async (request) => {
    const { id } = request as Extract<UiRequest, { type: 'ui:delete-saved-mapping' }>;
    await deleteMapping(sanitizeString(id, 64));
    return ok({ deleted: id });
  });

  /** Irreversible: drops the database and every stored setting. */
  handle('ui:erase-all-data', async () => {
    await destroyDb();
    await clearSettings();
    await chrome.storage.local.clear();
    return ok({ erased: true });
  });

  /**
   * Produces a JSON snapshot the user can save locally. Resume bytes are
   * omitted — they are large, and the user already has the original file.
   */
  handle('ui:export-data', async () => {
    const summaries = await listProfiles();
    const profiles: Profile[] = [];
    for (const summary of summaries) {
      const profile = await getProfile(summary.id);
      if (profile) profiles.push(profile);
    }
    return ok({
      exportedAt: new Date().toISOString(),
      profiles,
      mappings: await listMappings(),
      history: await listHistory(),
      resumeCount: await idb.count('resumes'),
    });
  });
}
