/**
 * Encryption primitives.
 *
 * Deliberately small, and deliberately boring. Everything here is standard Web
 * Crypto: PBKDF2-SHA256 to turn a passphrase into a key, AES-GCM to encrypt
 * with authentication. No custom constructions, no hand-rolled anything.
 *
 * What this protects and what it does not is documented in SECURITY.md §3.5 and
 * surfaced in the UI — it raises the cost of reading the database file offline,
 * and does nothing against malware running as the user while the vault is open.
 */

/** OWASP's 2023 floor for PBKDF2-SHA256. Costs ~0.5s on a typical laptop. */
export const PBKDF2_ITERATIONS = 600_000;

const SALT_BYTES = 16;
const IV_BYTES = 12;

export interface EncryptedBlob {
  /** Format version, so the scheme can change without losing existing data. */
  v: 1;
  /** Base64 initialisation vector. Unique per encryption, never reused. */
  iv: string;
  /** Base64 ciphertext, with the GCM authentication tag appended. */
  ct: string;
}

export interface KdfParams {
  v: 1;
  algorithm: 'PBKDF2-SHA256';
  iterations: number;
  /** Base64 salt. Unique per vault. */
  salt: string;
}

export function newKdfParams(): KdfParams {
  return {
    v: 1,
    algorithm: 'PBKDF2-SHA256',
    iterations: PBKDF2_ITERATIONS,
    salt: toBase64(crypto.getRandomValues(new Uint8Array(SALT_BYTES))),
  };
}

/**
 * Derives the vault key from a passphrase.
 *
 * `extractable: true` is required so the key can be held in
 * `chrome.storage.session` across service-worker restarts — MV3 tears the
 * worker down every few seconds of idle, and re-deriving would mean prompting
 * for the passphrase constantly. Session storage is memory-only and cleared
 * when the browser closes; see `vault.ts` for why that trade is made.
 */
export async function deriveKey(passphrase: string, params: KdfParams): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(passphrase),
    'PBKDF2',
    false,
    ['deriveKey'],
  );

  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: fromBase64(params.salt),
      iterations: params.iterations,
      hash: 'SHA-256',
    },
    material,
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt'],
  );
}

/** Encrypts any JSON-serialisable value. */
export async function encryptJson(
  key: CryptoKey,
  value: unknown,
  additionalData?: string,
): Promise<EncryptedBlob> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const plaintext = new TextEncoder().encode(JSON.stringify(value));
  const ciphertext = await crypto.subtle.encrypt(gcmParams(iv, additionalData), key, plaintext);
  return { v: 1, iv: toBase64(iv), ct: toBase64(new Uint8Array(ciphertext)) };
}

/**
 * Decrypts a blob.
 *
 * AES-GCM authenticates as it decrypts, so a wrong key or tampered ciphertext
 * throws rather than returning garbage. That is what makes the passphrase check
 * in `vault.ts` trustworthy.
 */
export async function decryptJson<T>(
  key: CryptoKey,
  blob: EncryptedBlob,
  additionalData?: string,
): Promise<T> {
  const plaintext = await crypto.subtle.decrypt(
    gcmParams(fromBase64(blob.iv), additionalData),
    key,
    fromBase64(blob.ct),
  );
  return JSON.parse(new TextDecoder().decode(plaintext)) as T;
}

/**
 * AES-GCM parameters. `additionalData` is authenticated but not encrypted:
 * changing it after the fact makes decryption fail, which is how an export's
 * plaintext header is bound to its ciphertext.
 */
function gcmParams(iv: Uint8Array<ArrayBuffer>, additionalData?: string): AesGcmParams {
  return additionalData === undefined
    ? { name: 'AES-GCM', iv }
    : { name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(additionalData) };
}

/** Encrypts raw bytes — used for the stored resume file. */
export async function encryptBytes(key: CryptoKey, bytes: ArrayBuffer): Promise<EncryptedBlob> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, bytes);
  return { v: 1, iv: toBase64(iv), ct: toBase64(new Uint8Array(ciphertext)) };
}

export async function decryptBytes(key: CryptoKey, blob: EncryptedBlob): Promise<ArrayBuffer> {
  return crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromBase64(blob.iv) },
    key,
    fromBase64(blob.ct),
  );
}

export function isEncryptedBlob(value: unknown): value is EncryptedBlob {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as EncryptedBlob).v === 1 &&
    typeof (value as EncryptedBlob).iv === 'string' &&
    typeof (value as EncryptedBlob).ct === 'string'
  );
}

/* ------------------------------------------------------------ key transport */

/** Exports a key for `chrome.storage.session`. Never written to disk. */
export async function exportKey(key: CryptoKey): Promise<JsonWebKey> {
  return crypto.subtle.exportKey('jwk', key);
}

export async function importKey(jwk: JsonWebKey): Promise<CryptoKey> {
  return crypto.subtle.importKey('jwk', jwk, { name: 'AES-GCM', length: 256 }, true, [
    'encrypt',
    'decrypt',
  ]);
}

/* ------------------------------------------------------------------ base64 */

export function toBase64(bytes: Uint8Array): string {
  let binary = '';
  // Chunked so a large resume does not blow the argument limit on apply().
  const CHUNK = 0x8000;
  for (let index = 0; index < bytes.length; index += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(index, index + CHUNK));
  }
  return btoa(binary);
}

/**
 * Returns a view over a plain `ArrayBuffer`.
 *
 * The buffer is allocated explicitly rather than letting `new Uint8Array(n)`
 * infer it: Web Crypto's types reject `SharedArrayBuffer`-backed views, and the
 * inferred `ArrayBufferLike` includes that case.
 */
export function fromBase64(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

/**
 * Rough passphrase strength, for the UI meter.
 *
 * Length-dominant on purpose: a long passphrase beats a short one with symbol
 * substitutions, and telling people otherwise produces worse passwords.
 */
export function passphraseStrength(passphrase: string): {
  score: 0 | 1 | 2 | 3 | 4;
  label: string;
  hint: string;
} {
  const length = passphrase.length;
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^\w\s]/, /\s/].filter((re) =>
    re.test(passphrase),
  ).length;

  if (length < 8) {
    return { score: 0, label: 'Too short', hint: 'Use at least 12 characters.' };
  }
  if (length < 12) {
    return { score: 1, label: 'Weak', hint: 'Longer is better than more symbols.' };
  }
  if (length >= 20 || (length >= 16 && classes >= 3)) {
    return { score: 4, label: 'Strong', hint: 'Good. Store it somewhere safe.' };
  }
  if (length >= 16 || classes >= 3) {
    return { score: 3, label: 'Good', hint: 'A few more words would make it stronger.' };
  }
  return { score: 2, label: 'Fair', hint: 'Try a short phrase rather than one word.' };
}
