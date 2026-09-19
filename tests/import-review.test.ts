import { describe, expect, it } from 'vitest';
import {
  EXPORT_FORMAT,
  EXPORT_VERSION,
  decryptExport,
  encryptExport,
  isEncryptedExport,
  parseImport,
  applyImportSelection,
  previewImport,
  type ExportFile,
} from '@/profile/portable';
import { buildMappings, buildFillPlan, fingerprintOf } from '@/autofill/plan';
import { mergeMapping } from '@/storage/mappings';
import { harvestFields } from '@/field-detection/harvest';
import { createEmptyProfile, tv } from '@/profile/factory';
import { DEFAULT_SETTINGS } from '@/types/settings';
import { fromBase64, toBase64 } from '@/security/crypto';

function exportFile(): ExportFile {
  const profile = createEmptyProfile('Main');
  profile.personal.firstName = tv('Aditi', 'user', 1);
  profile.sensitive.workAuthorization.authorizedIn = { IN: 'yes' };
  return {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    exportedAt: '2026-01-01T00:00:00.000Z',
    profiles: [profile],
    mappings: [
      {
        id: 'map-1',
        origin: 'https://jobs.example.com',
        fingerprint: 'cand id',
        label: 'Candidate ID',
        canonical: 'personal.email',
        createdAt: '',
        useCount: 3,
      },
    ],
    settings: {
      autofill: { ...DEFAULT_SETTINGS.autofill, allowOverwrite: true, mode: 'assist' },
      ui: DEFAULT_SETTINGS.ui,
      ai: DEFAULT_SETTINGS.ai,
      privacy: { keepApplicationHistory: false, autoLockMinutes: 30 },
    },
  };
}

// Fewer iterations keep the suite fast; the default is covered separately.
const FAST = { iterations: 1_000 };

describe('encrypted export envelope', () => {
  it('round-trips with the right passphrase and holds no plaintext', async () => {
    const envelope = await encryptExport(exportFile(), 'correct horse battery', FAST);
    expect(isEncryptedExport(envelope)).toBe(true);
    expect(JSON.stringify(envelope)).not.toContain('Aditi');
    const back = await decryptExport(envelope, 'correct horse battery');
    expect((back as ExportFile).profiles[0]!.personal.firstName.value).toBe('Aditi');
  });

  it('uses the vault key derivation by default', async () => {
    const envelope = await encryptExport(exportFile(), 'correct horse battery');
    expect(envelope.kdf.iterations).toBeGreaterThanOrEqual(600_000);
    expect(envelope.kdf.algorithm).toBe('PBKDF2-SHA256');
  });

  it('rejects a wrong passphrase with a plain message', async () => {
    const envelope = await encryptExport(exportFile(), 'correct horse battery', FAST);
    await expect(decryptExport(envelope, 'wrong horse')).rejects.toThrow(/passphrase/i);
  });

  it('rejects a tampered file', async () => {
    const envelope = await encryptExport(exportFile(), 'correct horse battery', FAST);
    const bytes = fromBase64(envelope.blob.ct);
    bytes[5] = bytes[5]! ^ 0x01;
    const tampered = { ...envelope, blob: { ...envelope.blob, ct: toBase64(bytes) } };
    await expect(decryptExport(tampered, 'correct horse battery')).rejects.toThrow();
    // Changing the header is caught as well: it is bound into the ciphertext.
    const relabelled = { ...envelope, exportedAt: '1999-01-01T00:00:00.000Z' };
    await expect(decryptExport(relabelled, 'correct horse battery')).rejects.toThrow();
  });

  it('refuses a crafted key-derivation cost', async () => {
    const envelope = await encryptExport(exportFile(), 'pass phrase here', FAST);
    const costly = { ...envelope, kdf: { ...envelope.kdf, iterations: 1e12 } };
    await expect(decryptExport(costly, 'pass phrase here')).rejects.toThrow(/not a Fillwright/);
  });

  it('parseImport points at the passphrase instead of failing on an envelope', async () => {
    const envelope = await encryptExport(exportFile(), 'correct horse battery', FAST);
    expect(() => parseImport(envelope)).toThrow(/passphrase/i);
  });
});

describe('import review', () => {
  it('marks imported mappings and lists settings changes as old → new', () => {
    const preview = previewImport(parseImport(exportFile()), DEFAULT_SETTINGS);
    expect(preview.mappings[0]!.imported).toBe(true);
    const overwrite = preview.settingsChanges.find((c) => c.path === 'autofill.allowOverwrite');
    expect(overwrite).toMatchObject({ from: false, to: true });
    expect(preview.settingsChanges.find((c) => c.path === 'autofill.mode')).toMatchObject({
      from: DEFAULT_SETTINGS.autofill.mode,
      to: 'assist',
    });
    // Unchanged settings are not listed.
    expect(preview.settingsChanges.some((c) => c.path === 'ui.theme')).toBe(false);
  });

  it('applies only what was ticked; nothing is ticked for settings or mappings by default', () => {
    const plan = parseImport(exportFile());
    const none = applyImportSelection(plan, { profiles: [0], mappings: [], settings: [] });
    expect(none.profiles).toHaveLength(1);
    expect(none.mappings).toHaveLength(0);
    expect(none.settings).toBeNull();

    const some = applyImportSelection(plan, {
      profiles: [],
      mappings: [0],
      settings: ['autofill.mode'],
    });
    expect(some.profiles).toHaveLength(0);
    expect(some.mappings[0]!.imported).toBe(true);
    expect(some.settings).toEqual({ autofill: { mode: 'assist' } });
  });

  it('ignores selections that name nothing real', () => {
    const plan = parseImport(exportFile());
    const out = applyImportSelection(plan, {
      profiles: [7, -1],
      mappings: [99],
      settings: ['privacy.encryptionEnabled', '__proto__.x', 'autofill'],
    });
    expect(out.profiles).toHaveLength(0);
    expect(out.mappings).toHaveLength(0);
    expect(out.settings).toBeNull();
  });
});

describe('imported mappings in the fill plan', () => {
  const setup = () => {
    document.body.innerHTML = '<label for="a">Candidate Reference</label><input id="a" name="ref">';
    const { fields } = harvestFields(document);
    const profile = createEmptyProfile('T');
    profile.personal.email = tv('a@example.com', 'user', 1);
    const mapping = {
      id: 'map-1',
      origin: 'https://x.example',
      fingerprint: fingerprintOf(fields[0]!),
      label: '',
      canonical: 'personal.email' as const,
      createdAt: '',
      useCount: 0,
    };
    return { fields, profile, mapping };
  };

  it('a taught mapping starts ticked', () => {
    const { fields, profile, mapping } = setup();
    const mappings = buildMappings(fields, profile, DEFAULT_SETTINGS, [mapping]);
    expect(mappings[0]!.status).toBe('ready');
  });

  it('an imported mapping is capped at review and starts unticked', () => {
    const { fields, profile, mapping } = setup();
    const mappings = buildMappings(fields, profile, DEFAULT_SETTINGS, [
      { ...mapping, imported: true },
    ]);
    expect(mappings[0]!.canonical).toBe('personal.email');
    expect(mappings[0]!.status).toBe('review');
    expect(mappings[0]!.confidence).toBeLessThan(DEFAULT_SETTINGS.autofill.confidenceThreshold);
    const plan = buildFillPlan(
      { url: '', pageKey: '', adapterId: null, scannedAt: '', fields, mappings },
      '1',
    );
    expect(plan.entries[0]!.selected).toBe(false);
    expect(plan.entries[0]!.imported).toBe(true);
  });

  it('confirming on a real form clears the imported mark', () => {
    const existing = {
      id: 'map-1',
      origin: 'https://x.example',
      fingerprint: 'f',
      label: 'x',
      canonical: 'personal.email' as const,
      createdAt: 'c',
      useCount: 2,
      imported: true as const,
    };
    const confirmed = mergeMapping(existing, {
      origin: 'https://x.example',
      fingerprint: 'f',
      label: 'x',
      canonical: 'personal.email',
    });
    expect(confirmed.imported).toBeUndefined();
    expect(confirmed.useCount).toBe(2);
    const reimported = mergeMapping(existing, { ...existing, imported: true });
    expect(reimported.imported).toBe(true);
  });
});
