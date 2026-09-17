/**
 * User-facing error language.
 *
 * Trust boundary: none — pure strings. Background handlers return a short
 * `code`; every surface (panel, popup, options) turns it into the same
 * sentence here, so a failure reads the same wherever it appears and a raw
 * technical string ("Could not establish connection", a stack frame) never
 * reaches the user.
 *
 * Each message says what happened and, where true, that nothing on the form
 * changed. `action` is the single next step the surface should offer.
 */

export type ErrorAction =
  'retry' | 'reload-page' | 'unlock' | 'open-import' | 'open-privacy' | 'open-settings' | 'none';

export interface UserError {
  message: string;
  /** True when the failure happened before anything was written to a form. */
  formUnchanged?: boolean;
  action: ErrorAction;
  /** Label for the action button. */
  actionLabel: string;
}

export const USER_ERRORS: Record<string, UserError> = {
  ELOCKED: {
    message: 'Fillwright is locked. Your profile is encrypted until you unlock it.',
    action: 'unlock',
    actionLabel: 'Unlock Fillwright',
  },
  ENOPROFILE: {
    message: `Fillwright has no profile yet. Import your resume first.`,
    action: 'open-import',
    actionLabel: 'Import a resume',
    formUnchanged: true,
  },
  EWORKER: {
    message: `Fillwright’s background service did not answer.`,
    action: 'retry',
    actionLabel: 'Try again',
    formUnchanged: true,
  },
  EINVALIDATED: {
    message: `Fillwright was updated or restarted since this page loaded.`,
    action: 'reload-page',
    actionLabel: 'Reload the page',
    formUnchanged: true,
  },
  EBADSCAN: {
    message: `This page’s form could not be read safely, so Fillwright left it alone.`,
    action: 'none',
    actionLabel: '',
    formUnchanged: true,
  },
  EFRAME: {
    message: `The form is inside a frame from another website, which Fillwright can’t reach. Open the form in its own tab and try there.`,
    action: 'none',
    actionLabel: '',
    formUnchanged: true,
  },
  EQUOTA: {
    message:
      'Your browser has no more storage space for Fillwright, so this was not saved. Export a copy of your data, then remove profiles or resumes you no longer need.',
    action: 'open-privacy',
    actionLabel: 'Open Privacy Center',
  },
  ECHROMEPAGE: {
    message:
      'Browser pages like this one can’t be filled — Chrome keeps them off-limits to extensions.',
    action: 'none',
    actionLabel: '',
  },
  EFILE: {
    message:
      'Fillwright doesn’t read files opened from your computer. Open the application form on its website.',
    action: 'none',
    actionLabel: '',
  },
  ESTORE: {
    message: 'Chrome doesn’t let extensions change the Chrome Web Store.',
    action: 'none',
    actionLabel: '',
  },
  EPDF: {
    message:
      'This is a PDF, not a web form. If it’s an application you need to fill in, download it and use a PDF editor.',
    action: 'none',
    actionLabel: '',
  },
  EINJECT: {
    message: `Chrome didn’t allow Fillwright to read this page.`,
    action: 'retry',
    actionLabel: 'Try again',
    formUnchanged: true,
  },
  ERESTRICTED: {
    message:
      'Chrome doesn’t let extensions read this page. Browser pages, the Chrome Web Store and files on your computer are off-limits.',
    action: 'none',
    actionLabel: '',
  },
  ENOACCESS: {
    message:
      'Chrome hasn’t given Fillwright access to this tab. Click the Fillwright button while the application is open.',
    action: 'none',
    actionLabel: '',
    formUnchanged: true,
  },
  ENOTAB: {
    message: 'There’s no page open in this window to fill.',
    action: 'none',
    actionLabel: '',
  },
  EAIOFF: {
    message: 'Answer drafting is switched off.',
    action: 'open-settings',
    actionLabel: 'Open writing settings',
  },
  EHANDLER: {
    message: `Something went wrong inside Fillwright.`,
    action: 'retry',
    actionLabel: 'Try again',
    formUnchanged: true,
  },
};

/**
 * Picks the message for a failed result. A handler may supply its own,
 * already-friendly text for codes this table does not know; anything that
 * looks technical is replaced.
 */
export function describeError(
  code: string | undefined,
  fallback?: string,
  onPage = false,
): UserError {
  const known = code ? USER_ERRORS[code] : undefined;
  const base: UserError = known
    ? known
    : fallback && !looksTechnical(fallback)
      ? { message: fallback, action: 'none', actionLabel: '' }
      : USER_ERRORS.EHANDLER!;
  // On a web page, say so when the form was left exactly as it was.
  return onPage && base.formUnchanged
    ? { ...base, message: `${base.message} Nothing on the form was changed.` }
    : base;
}

/** Codes produced by the messaging layer itself, all meaning "no answer". */
const TRANSPORT_CODES = new Set(['ETIMEOUT', 'ESEND', 'ENORESP', 'EWORKER']);

export function userMessage(code: string | undefined, fallback?: string): string {
  return describeError(code && TRANSPORT_CODES.has(code) ? 'EWORKER' : code, fallback).message;
}

const TECHNICAL = [
  /could not establish connection/i,
  /receiving end does not exist/i,
  /message port closed/i,
  /extension context invalidated/i,
  /\b(?:TypeError|ReferenceError|SyntaxError|DOMException|QuotaExceededError)\b/,
  /\bat [\w.]+ \(/,
  /chrome-extension:\/\//,
  /Unsupported message/,
  /\b(?:undefined|null|NaN)\b/,
  /Failed to fetch/i,
];

export function looksTechnical(text: string): boolean {
  return TECHNICAL.some((pattern) => pattern.test(text));
}

/** Maps a runtime.sendMessage rejection to a code. */
export function codeForTransportError(cause: unknown): 'EINVALIDATED' | 'EWORKER' {
  const text = cause instanceof Error ? cause.message : String(cause);
  return /context invalidated/i.test(text) ? 'EINVALIDATED' : 'EWORKER';
}

/** Classifies a tab URL Fillwright cannot work on. Null when it can. */
export function unsupportedPageCode(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return 'ECHROMEPAGE';
  }
  if (parsed.protocol === 'file:') return 'EFILE';
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return 'ECHROMEPAGE';
  const host = parsed.hostname;
  if (
    host === 'chromewebstore.google.com' ||
    (host === 'chrome.google.com' && parsed.pathname.startsWith('/webstore'))
  ) {
    return 'ESTORE';
  }
  if (/\.pdf$/i.test(parsed.pathname)) return 'EPDF';
  return null;
}
