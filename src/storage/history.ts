import { idb } from './idb';
import { newId, now } from '@/profile/factory';
import { getSettings } from './settings';
import type { ApplicationHistoryEntry } from '@/types/messages';

/**
 * History is metadata only — company, role, origin, date, and how many fields
 * were filled. Field values are never recorded, and nothing is written unless
 * the user turned history on.
 */
export async function logApplication(
  entry: Omit<ApplicationHistoryEntry, 'id' | 'appliedAt'>,
): Promise<ApplicationHistoryEntry | null> {
  const settings = await getSettings();
  if (!settings.privacy.keepApplicationHistory) return null;
  const record: ApplicationHistoryEntry = { ...entry, id: newId('app'), appliedAt: now() };
  await idb.put('history', record);
  return record;
}

export async function listHistory(): Promise<ApplicationHistoryEntry[]> {
  const entries = await idb.getAll<ApplicationHistoryEntry>('history');
  return entries.sort((a, b) => b.appliedAt.localeCompare(a.appliedAt));
}

export function clearHistory(): Promise<void> {
  return idb.clear('history').then(() => undefined);
}
