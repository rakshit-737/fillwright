/**
 * Trust boundary guards.
 *
 * Content scripts execute inside pages we do not control. A compromised or
 * merely hostile page can post arbitrary objects at the extension, so every
 * inbound message is shape-checked here before any handler sees it.
 */

const MAX_STRING = 20_000;
const MAX_ARRAY = 2_000;

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Messages must be a plain object with a string `type` from a known namespace. */
export function isEnvelope(value: unknown): value is { type: string } {
  if (!isPlainObject(value)) return false;
  const type = value.type;
  return (
    typeof type === 'string' &&
    type.length < 64 &&
    (type.startsWith('ui:') || type.startsWith('content:') || type.startsWith('bg:'))
  );
}

export function sanitizeString(value: unknown, max = MAX_STRING): string {
  if (typeof value !== 'string') return '';
  // Strip control characters; they have no place in form values and can be used
  // to smuggle terminal escapes or break log parsing downstream. Tab, newline
  // and carriage return are kept — textareas legitimately contain them.
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').slice(0, max);
}

export function sanitizeStringArray(value: unknown, max = MAX_ARRAY): string[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, max).map((item) => sanitizeString(item));
}

export function sanitizeNumber(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

export function sanitizeBoolean(value: unknown, fallback = false): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

/**
 * Only http(s) URLs are ever accepted. Blocks `javascript:`, `data:` and
 * friends from reaching anything that might resolve them.
 */
export function sanitizeUrl(value: unknown): string {
  const raw = sanitizeString(value, 2048);
  if (!raw) return '';
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : '';
  } catch {
    return '';
  }
}

/**
 * Strips query strings and fragments. A job application URL frequently contains
 * a candidate token; we keep only origin + path so nothing identifying is stored
 * or passed between components.
 */
export function pageKeyFromUrl(value: unknown): string {
  const raw = sanitizeUrl(value);
  if (!raw) return '';
  const url = new URL(raw);
  return `${url.origin}${url.pathname}`;
}

export function originFromUrl(value: unknown): string {
  const raw = sanitizeUrl(value);
  if (!raw) return '';
  return new URL(raw).origin;
}
