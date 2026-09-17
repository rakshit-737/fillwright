import { idb } from './idb';
import { newId, now } from '@/profile/factory';
import type { SavedMapping } from '@/types/fields';

export function listMappings(origin?: string): Promise<SavedMapping[]> {
  return origin
    ? idb.getAllByIndex<SavedMapping>('mappings', 'by-origin', origin)
    : idb.getAll<SavedMapping>('mappings');
}

export async function saveMapping(
  input: Omit<SavedMapping, 'id' | 'createdAt' | 'useCount'>,
): Promise<SavedMapping> {
  const existing = (await listMappings(input.origin)).find(
    (m) => m.fingerprint === input.fingerprint,
  );
  const mapping: SavedMapping = existing
    ? { ...existing, ...input, useCount: existing.useCount }
    : { ...input, id: newId('map'), createdAt: now(), useCount: 0 };
  await idb.put('mappings', mapping);
  return mapping;
}

export async function recordMappingUse(id: string): Promise<void> {
  const mapping = await idb.get<SavedMapping>('mappings', id);
  if (mapping) await idb.put('mappings', { ...mapping, useCount: mapping.useCount + 1 });
}

export function deleteMapping(id: string): Promise<void> {
  return idb.delete('mappings', id).then(() => undefined);
}

export async function updateMapping(
  id: string,
  patch: Partial<Pick<SavedMapping, 'canonical' | 'disabled'>>,
): Promise<SavedMapping | null> {
  const mapping = await idb.get<SavedMapping>('mappings', id);
  if (!mapping) return null;
  const next: SavedMapping = { ...mapping, ...patch };
  await idb.put('mappings', next);
  return next;
}

/** Clears every mapping, or only one website's. */
export async function clearMappings(origin?: string): Promise<number> {
  if (!origin) {
    const count = (await listMappings()).length;
    await idb.clear('mappings');
    return count;
  }
  const mine = await listMappings(origin);
  for (const mapping of mine) await idb.delete('mappings', mapping.id);
  return mine.length;
}
