import { beforeEach, describe, expect, it } from 'vitest';
import {
  decryptBytes,
  decryptJson,
  deriveKey,
  encryptBytes,
  encryptJson,
  exportKey,
  importKey,
  isEncryptedBlob,
  newKdfParams,
  passphraseStrength,
  PBKDF2_ITERATIONS,
} from '@/security/crypto';

/**
 * Encryption tests.
 *
 * Iteration count is reduced in these tests — 600k iterations is the right
 * production figure but would make the suite take minutes. The parameters are
 * passed explicitly everywhere, so the production value is asserted separately
 * rather than exercised repeatedly.
 */
const fastKdf = () => ({ ...newKdfParams(), iterations: 1_000 }) as ReturnType<typeof newKdfParams>;

describe('key derivation', () => {
  it('uses a cost that is actually slow to guess', () => {
    // OWASP's 2023 floor for PBKDF2-SHA256. A lower number here is a real
    // weakening, so it is asserted rather than left to review.
    expect(PBKDF2_ITERATIONS).toBeGreaterThanOrEqual(600_000);
  });

  it('gives every vault its own salt', () => {
    const salts = new Set(Array.from({ length: 50 }, () => newKdfParams().salt));
    expect(salts.size).toBe(50);
  });

  it('derives the same key from the same passphrase and salt', async () => {
    const params = fastKdf();
    const a = await exportKey(await deriveKey('correct horse battery', params));
    const b = await exportKey(await deriveKey('correct horse battery', params));
    expect(a.k).toBe(b.k);
  });

  it('derives a different key from a different passphrase', async () => {
    const params = fastKdf();
    const a = await exportKey(await deriveKey('correct horse battery', params));
    const b = await exportKey(await deriveKey('correct horse battery ', params));
    expect(a.k).not.toBe(b.k);
  });

  it('derives a different key when the salt differs', async () => {
    const a = await exportKey(await deriveKey('same passphrase', fastKdf()));
    const b = await exportKey(await deriveKey('same passphrase', fastKdf()));
    expect(a.k).not.toBe(b.k);
  });
});

describe('encrypting a profile', () => {
  const profile = {
    name: 'Aditi Ramachandran',
    email: 'aditi@example.com',
    education: [{ institution: 'Vellore Institute of Technology', gpa: '8.94' }],
  };

  it('round-trips', async () => {
    const key = await deriveKey('passphrase', fastKdf());
    const blob = await encryptJson(key, profile);
    expect(await decryptJson(key, blob)).toEqual(profile);
  });

  it('produces ciphertext that does not contain the plaintext', async () => {
    const key = await deriveKey('passphrase', fastKdf());
    const blob = await encryptJson(key, profile);
    const serialised = JSON.stringify(blob);

    // The obvious failure mode for a botched implementation.
    expect(serialised).not.toContain('Aditi');
    expect(serialised).not.toContain('aditi@example.com');
    expect(serialised).not.toContain('Vellore');
    expect(isEncryptedBlob(blob)).toBe(true);
  });

  it('never reuses an initialisation vector', async () => {
    const key = await deriveKey('passphrase', fastKdf());
    const ivs = new Set<string>();
    for (let index = 0; index < 50; index++) {
      ivs.add((await encryptJson(key, profile)).iv);
    }
    // IV reuse under AES-GCM is catastrophic, not merely untidy.
    expect(ivs.size).toBe(50);
  });

  it('produces different ciphertext for identical input', async () => {
    const key = await deriveKey('passphrase', fastKdf());
    const a = await encryptJson(key, profile);
    const b = await encryptJson(key, profile);
    expect(a.ct).not.toBe(b.ct);
  });

  it('refuses the wrong key', async () => {
    const params = fastKdf();
    const right = await deriveKey('right passphrase', params);
    const wrong = await deriveKey('wrong passphrase', params);
    const blob = await encryptJson(right, profile);

    await expect(decryptJson(wrong, blob)).rejects.toThrow();
  });

  it('detects tampering', async () => {
    const key = await deriveKey('passphrase', fastKdf());
    const blob = await encryptJson(key, profile);

    // Flip a byte in the ciphertext. GCM authenticates, so this must throw
    // rather than silently returning corrupted data.
    const bytes = atob(blob.ct).split('');
    bytes[5] = String.fromCharCode(bytes[5]!.charCodeAt(0) ^ 0xff);
    const tampered = { ...blob, ct: btoa(bytes.join('')) };

    await expect(decryptJson(key, tampered)).rejects.toThrow();
  });
});

describe('encrypting a resume file', () => {
  it('round-trips binary content exactly', async () => {
    const key = await deriveKey('passphrase', fastKdf());
    const original = new Uint8Array(4096);
    crypto.getRandomValues(original);

    const blob = await encryptBytes(key, original.buffer);
    const restored = new Uint8Array(await decryptBytes(key, blob));

    expect(restored.length).toBe(original.length);
    expect(Array.from(restored)).toEqual(Array.from(original));
  });

  it('handles a file large enough to break naive base64', async () => {
    const key = await deriveKey('passphrase', fastKdf());
    // Over the 0x8000 chunk boundary in the base64 encoder: an unchunked
    // String.fromCharCode(...bytes) throws on input this size.
    const original = new Uint8Array(200_000).fill(7);

    const blob = await encryptBytes(key, original.buffer);
    const restored = new Uint8Array(await decryptBytes(key, blob));
    expect(restored.length).toBe(original.length);
    expect(restored[199_999]).toBe(7);
  });
});

describe('key transport', () => {
  it('survives export and import', async () => {
    const key = await deriveKey('passphrase', fastKdf());
    const blob = await encryptJson(key, { secret: 'value' });

    const restored = await importKey(await exportKey(key));
    expect(await decryptJson(restored, blob)).toEqual({ secret: 'value' });
  });
});

describe('passphrase strength guidance', () => {
  it('rates length above symbol soup', () => {
    const short = passphraseStrength('P@ss1!');
    const long = passphraseStrength('correct horse battery staple');
    expect(long.score).toBeGreaterThan(short.score);
  });

  it('rejects anything under eight characters', () => {
    expect(passphraseStrength('abc').score).toBe(0);
    expect(passphraseStrength('abcdefg').score).toBe(0);
  });

  it('always offers a next step', () => {
    for (const candidate of ['', 'short', 'medium length', 'correct horse battery staple']) {
      expect(passphraseStrength(candidate).hint.length).toBeGreaterThan(0);
    }
  });
});

/**
 * The storage layer's behaviour under encryption is exercised in the browser
 * suite, where a real IndexedDB and a real `chrome.storage.session` exist.
 * These tests cover the cryptography itself, which is where a mistake would be
 * both most likely and least visible.
 */
describe('stored shape', () => {
  beforeEach(() => {
    /* no shared state */
  });

  it('recognises an encrypted record', () => {
    expect(isEncryptedBlob({ v: 1, iv: 'aa', ct: 'bb' })).toBe(true);
    expect(isEncryptedBlob({ v: 2, iv: 'aa', ct: 'bb' })).toBe(false);
    expect(isEncryptedBlob({ iv: 'aa' })).toBe(false);
    expect(isEncryptedBlob(null)).toBe(false);
    expect(isEncryptedBlob('nope')).toBe(false);
  });
});
