import type { CanonicalField, FillOutcome, ScanResult, SavedMapping } from './fields';
import type { Profile } from './profile';
import type { Settings } from './settings';

/**
 * Typed message protocol. Every message crossing a trust boundary carries a
 * literal `type` from this union; anything else is dropped by the router.
 *
 * Trust note: content scripts run in a hostile document. Messages arriving FROM
 * a content script are validated in src/security/validate.ts before use, and the
 * background never echoes profile data back to a tab that did not ask for a fill.
 */

export interface ApplicationHistoryEntry {
  id: string;
  company: string;
  role: string;
  origin: string;
  appliedAt: string;
  /** Fillwright never records what was typed — only that a fill happened. */
  fieldsFilled: number;
  /** Which of the user's profiles was used. */
  profileId?: string;
}

/* ---------- popup / options → background ---------- */

export type UiRequest =
  | { type: 'ui:get-state' }
  | { type: 'ui:get-settings' }
  | { type: 'ui:set-settings'; patch: DeepPartial<Settings> }
  | { type: 'ui:list-profiles' }
  | { type: 'ui:get-profile'; profileId: string }
  | { type: 'ui:save-profile'; profile: Profile }
  | { type: 'ui:create-profile'; name: string; cloneFromId?: string }
  | { type: 'ui:delete-profile'; profileId: string }
  | { type: 'ui:set-active-profile'; profileId: string }
  | { type: 'ui:list-history' }
  | { type: 'ui:clear-history' }
  | { type: 'ui:list-saved-mappings'; origin?: string }
  | { type: 'ui:delete-saved-mapping'; id: string }
  | { type: 'ui:update-saved-mapping'; id: string; canonical?: CanonicalField; disabled?: boolean }
  | { type: 'ui:clear-saved-mappings'; origin?: string }
  | { type: 'ui:erase-all-data' }
  | { type: 'ui:export-data'; includeHistory?: boolean }
  | { type: 'ui:import-data'; payload: unknown }
  | { type: 'ui:sync-auto-detect' }
  | { type: 'ui:vault-status' }
  | { type: 'ui:vault-enable'; passphrase: string }
  | { type: 'ui:vault-unlock'; passphrase: string }
  | { type: 'ui:vault-lock' }
  | { type: 'ui:vault-change-passphrase'; current: string; next: string }
  | { type: 'ui:vault-disable'; passphrase: string }
  | { type: 'ui:scan-active-tab' }
  /** The onboarding practice page asks for a plan for its own fields. */
  | { type: 'ui:practice-plan'; fields: unknown };

/* ---------- content script → background ---------- */

export type ContentRequest =
  | { type: 'content:ready'; url: string }
  | { type: 'ui:open-security' }
  | {
      type: 'content:request-mappings';
      scan: ScanResult;
      /**
       * Corrections the user made for this fill only, without asking Fillwright
       * to remember them. Applied like saved mappings, never persisted.
       */
      overrides?: Array<{ fingerprint: string; canonical: CanonicalField }>;
    }
  | { type: 'content:fill-complete'; outcomes: FillOutcome[] }
  | { type: 'content:save-mapping'; mapping: Omit<SavedMapping, 'id' | 'createdAt' | 'useCount'> }
  | {
      type: 'content:log-application';
      company: string;
      role: string;
      origin: string;
      fieldsFilled: number;
    }
  /** Passive (Assist/Smart) boot: what should an uninvited script do here? */
  | { type: 'content:get-mode' }
  /** Passive check: is this page an application? Signals only, no values. */
  | { type: 'content:assess-page'; fields: unknown; page: unknown }
  /** Multi-step progress for this tab, kept in the worker's session storage. */
  | { type: 'content:step-progress'; filled: number; stepKey: string }
  | { type: 'content:get-progress' }
  /** Whether the vault is locked right now. No key material, no data. */
  | { type: 'content:vault-state' }
  | { type: 'content:job-match'; text: string }
  | { type: 'content:list-profiles' }
  /** Opens one of a fixed set of Fillwright pages (import, privacy, …). */
  | { type: 'content:open-page'; route: string; field?: string }
  | { type: 'content:switch-profile'; profileId: string }
  | { type: 'content:draft-facts' }
  | { type: 'content:draft'; question: string; factIds: string[]; maxCharacters?: number };

export type AnyRequest = UiRequest | ContentRequest;

export interface Ok<T> {
  ok: true;
  data: T;
}
export interface Err {
  ok: false;
  error: string;
  code?: string;
}
export type Result<T> = Ok<T> | Err;

export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K];
};

export const ok = <T>(data: T): Ok<T> => ({ ok: true, data });
export const err = (error: string, code?: string): Err => ({ ok: false, error, code });
