/**
 * Gentle checks for what the user types into their profile.
 *
 * Trust boundary: pure functions over the user's own input. Nothing is
 * rejected — a profile field always keeps what was typed — but the editor can
 * point out a likely typo, and tidy a URL when the field loses focus.
 */

export interface InputCheck {
  /** A short, friendly note to show under the field; empty when fine. */
  message: string;
  /** A tidied value to apply on blur, when different from the input. */
  normalized?: string;
}

const OK: InputCheck = { message: '' };

export function checkEmail(value: string): InputCheck {
  const text = value.trim();
  if (!text) return OK;
  if (/\s/.test(text)) return { message: 'Email addresses can’t contain spaces.' };
  if (!/^[^@]+@[^@]+\.[^@.]{2,}$/.test(text)) {
    return { message: 'This doesn’t look like a complete email address (name@example.com).' };
  }
  return text === value ? OK : { message: '', normalized: text };
}

/**
 * Adds `https://` when a scheme is missing, and refuses anything that is not
 * an http(s) link — a profile URL is pasted into forms, so `javascript:` and
 * friends never belong in it.
 */
export function checkUrl(value: string): InputCheck {
  const text = value.trim();
  if (!text) return OK;
  const hasScheme = /^[a-z][a-z0-9+.-]*:/i.test(text);
  if (hasScheme && !/^https?:\/\//i.test(text)) {
    return { message: 'Only web links (https://…) can be used here.' };
  }
  const candidate = hasScheme ? text : `https://${text.replace(/^\/+/, '')}`;
  try {
    const url = new URL(candidate);
    if (!url.hostname.includes('.')) {
      return { message: 'This doesn’t look like a web address.' };
    }
  } catch {
    return { message: 'This doesn’t look like a web address.' };
  }
  return candidate === value ? OK : { message: '', normalized: candidate };
}

/** Phone numbers are kept exactly as typed; only an implausible length is flagged. */
export function checkPhone(value: string): InputCheck {
  const text = value.trim();
  if (!text) return OK;
  const digits = text.replace(/\D/g, '');
  if (/[a-z]{2,}/i.test(text.replace(/\b(?:ext|x)\b/gi, ''))) {
    return { message: 'Phone numbers usually contain only digits and + ( ) - symbols.' };
  }
  if (digits.length < 7) return { message: 'This looks too short for a phone number.' };
  if (digits.length > 15) return { message: 'This looks too long for a phone number.' };
  return OK;
}

/** Splits a pasted list ("Python, Go; SQL\nReact") into distinct entries. */
export function splitList(text: string, existing: string[] = []): string[] {
  const seen = new Set(existing.map((item) => item.trim().toLowerCase()));
  const out: string[] = [];
  for (const raw of text.split(/[,;\n•|]+/)) {
    const item = raw.replace(/\s+/g, ' ').trim();
    if (!item || item.length > 60) continue;
    const key = item.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out.slice(0, 200);
}
