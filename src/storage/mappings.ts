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

export function clearMappings(): Promise<void> {
  return idb.clear('mappings').then(() => undefined);
}
