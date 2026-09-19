import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { resetStorage } from './setup';
import { createEmptyProfile } from '@/profile/factory';
import { migrateProfile } from '@/profile/migrate';
import {
  validateMappingInput,
  validateProfilePayload,
  validateSettingsPatch,
} from '@/security/boundary';
import { DB_NAME, DB_VERSION, openDb, idb, __resetDbForTests } from '@/storage/idb';
import { getProfile } from '@/storage/profiles';
import { PROFILE_SCHEMA_VERSION } from '@/types/profile';
import v1Fixture from './fixtures/profile-v1.json';

/**
 * Prompt 17: records written by an older release must load, and nothing
 * malformed crosses a handler boundary into storage.
 */

describe('migrateProfile', () => {
  it('hydrates a v1 record that lacks newer keys, keeping ids and provenance', () => {
    const migrated = migrateProfile(structuredClone(v1Fixture) as Record<string, unknown>);
    expect(migrated.id).toBe(v1Fixture.id);
    expect(migrated.schemaVersion).toBe(PROFILE_SCHEMA_VERSION);
    expect(migrated.personal.firstName.value).toBe('Aditi');
    expect(migrated.personal.firstName.provenance.source).toBe('resume');
    expect(migrated.personal.firstName.provenance.confidence).toBe(0.95);
    // Keys missing from the fixture are filled from the template, not undefined.
    expect(migrated.personal.pronouns.value).toBe('');
    expect(migrated.links.other.value).toEqual([]);
    expect(migrated.sensitive.relocation.willingToRelocate).toBe('unset');
    expect(migrated.preferences.savedAnswers).toEqual([]);
    // List entries keep their ids so the editor's keys and references survive.
    expect(migrated.experience[0]!.id).toBe(v1Fixture.experience[0]!.id);
    expect(migrated.resumeIds).toEqual(v1Fixture.resumeIds);
    expect(migrated.createdAt).toBe(v1Fixture.createdAt);
  });

  it('keeps a long bullet intact rather than truncating stored data', () => {
    const profile = createEmptyProfile('Long');
    const long = 'x'.repeat(3000);
    (profile.links.other.value as string[]).push(long);
    expect(migrateProfile(structuredClone(profile) as never).links.other.value[0]).toBe(long);
  });

  it('is what getProfile returns for a stored v1 record', async () => {
    await idb.put('profiles', structuredClone(v1Fixture));
    const loaded = await getProfile(v1Fixture.id);
    expect(loaded?.personal.pronouns.value).toBe('');
    expect(loaded?.schemaVersion).toBe(PROFILE_SCHEMA_VERSION);
  });
});

describe('validateProfilePayload', () => {
  it('accepts a real profile without regenerating ids', () => {
    const profile = createEmptyProfile('Me');
    const result = validateProfilePayload(structuredClone(profile));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.id).toBe(profile.id);
  });

  it.each([
    ['null', null],
    ['an array', []],
    ['a string', 'profile'],
    ['no id', { name: 'x' }],
    ['a non-string id', { id: 42 }],
    ['an id with odd characters', { id: '../../etc' }],
    [
      'an oversized payload',
      { id: 'prof_1', name: 'x', summary: { value: 'y'.repeat(2_100_000) } },
    ],
  ])('rejects %s with EBADPROFILE', (_label, payload) => {
    const result = validateProfilePayload(payload);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('EBADPROFILE');
  });

  it('drops unknown keys and fixes wrong types', () => {
    const raw = { ...createEmptyProfile('Me'), evil: '<script>', personal: 'nope' };
    const result = validateProfilePayload(raw);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect('evil' in result.value).toBe(false);
      expect(result.value.personal.firstName.value).toBe('');
    }
  });
});

describe('validateSettingsPatch', () => {
  it('clamps the confidence threshold', () => {
    const high = validateSettingsPatch({ autofill: { confidenceThreshold: 5 } });
    const low = validateSettingsPatch({ autofill: { confidenceThreshold: -1 } });
    expect(high.ok && high.value.autofill?.confidenceThreshold).toBe(0.99);
    expect(low.ok && low.value.autofill?.confidenceThreshold).toBe(0.5);
  });

  it('passes a valid partial patch through unchanged', () => {
    const result = validateSettingsPatch({ privacy: { keepApplicationHistory: true } });
    expect(result).toEqual({ ok: true, value: { privacy: { keepApplicationHistory: true } } });
  });

  it.each([
    ['not an object', 'x'],
    ['a bad mode', { autofill: { mode: 'yolo' } }],
    ['a bad lock time', { privacy: { autoLockMinutes: 7 } }],
    ['a non-number threshold', { autofill: { confidenceThreshold: 'high' } }],
    ['a NaN threshold', { autofill: { confidenceThreshold: Number.NaN } }],
    ['a bad theme', { ui: { theme: 'neon' } }],
    ['a bad provider', { ai: { provider: 'openai' } }],
    ['a non-boolean flag', { autofill: { allowOverwrite: 'yes' } }],
    ['a section that is not an object', { autofill: 3 }],
  ])('rejects %s with EBADSETTINGS', (_label, patch) => {
    const result = validateSettingsPatch(patch);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('EBADSETTINGS');
  });

  it('never lets a page flip encryption state or the stored version', () => {
    const result = validateSettingsPatch({
      privacy: { encryptionEnabled: false },
      version: 99,
      nonsense: 1,
    });
    expect(result).toEqual({ ok: true, value: { privacy: {} } });
  });
});

describe('validateMappingInput', () => {
  const base = { fingerprint: 'fp', label: 'First name', canonical: 'personal.firstName' };

  it('accepts a catalog field', () => {
    const result = validateMappingInput(base);
    expect(result.ok).toBe(true);
  });

  it.each([
    ['an unknown canonical', { ...base, canonical: 'sensitive.demographics.gender' }],
    ['a non-string canonical', { ...base, canonical: { x: 1 } }],
    ['a missing fingerprint', { ...base, fingerprint: '' }],
    ['not an object', null],
  ])('rejects %s with EBADFIELD', (_label, mapping) => {
    const result = validateMappingInput(mapping);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('EBADFIELD');
  });
});

describe('IndexedDB upgrade', () => {
  beforeEach(async () => {
    resetStorage();
    await __resetDbForTests();
  });

  it('opens a v1 database, keeps its data and upgrades it to the current version', async () => {
    // Build exactly what release 0.5 created: version 1, the five stores, no more.
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        db.createObjectStore('profiles', { keyPath: 'id' });
        db.createObjectStore('resumes', { keyPath: 'id' });
        db.createObjectStore('mappings', { keyPath: 'id' }); // index missing on purpose
        db.createObjectStore('history', { keyPath: 'id' });
        db.createObjectStore('meta', { keyPath: 'key' });
        request.transaction!.objectStore('profiles').put(structuredClone(v1Fixture));
      };
      request.onsuccess = () => {
        request.result.close();
        resolve();
      };
      request.onerror = () => reject(request.error);
    });

    const db = await openDb();
    expect(DB_VERSION).toBeGreaterThan(1);
    expect(db.version).toBe(DB_VERSION);
    const tx = db.transaction('mappings', 'readonly');
    expect(Array.from(tx.objectStore('mappings').indexNames)).toContain('by-origin');
    expect((await getProfile(v1Fixture.id))?.personal.firstName.value).toBe('Aditi');
  });
});
