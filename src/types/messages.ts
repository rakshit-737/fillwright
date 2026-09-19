import type { ImportSelection } from '@/profile/portable';
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
  /* Tracker fields — only ever set by the user in the History pane. */
  /** Missing on older records, which read as 'applied'. */
  status?: ApplicationStatus;
  notes?: string;
  /** A calendar date, yyyy-mm-dd. */
  followUpOn?: string;
  /** Stored only when the user ticks it for this entry: origin + path, no query. */
  postingUrl?: string;
}

export type ApplicationStatus =
  'applied' | 'assessment' | 'interview' | 'offer' | 'rejected' | 'withdrawn';

/** What the History pane may change on an entry. `null` clears a field. */
export interface HistoryTrackerPatch {
  status?: ApplicationStatus;
  notes?: string;
  followUpOn?: string | null;
  profileId?: string | null;
  postingUrl?: string | null;
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
  | { type: 'ui:update-history'; id: string; patch: HistoryTrackerPatch }
  | { type: 'ui:delete-history-entry'; id: string }
  | { type: 'ui:list-saved-mappings'; origin?: string }
  | { type: 'ui:delete-saved-mapping'; id: string }
  | { type: 'ui:update-saved-mapping'; id: string; canonical?: CanonicalField; disabled?: boolean }
  | { type: 'ui:clear-saved-mappings'; origin?: string }
  | { type: 'ui:erase-all-data' }
  | { type: 'ui:export-data'; includeHistory?: boolean }
  | { type: 'ui:preview-import'; payload: unknown }
  | { type: 'ui:import-data'; payload: unknown; selection: ImportSelection }
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
      overrides?: Array<{ fingerprint: string; canonical: CanonicalField; customKey?: string }>;
      /**
       * Counts and statuses only (Smart mode, before the user opened the
       * panel). The worker blanks every proposed value.
       */
      withholdValues?: boolean;
    }
  | {
      type: 'content:fill-complete';
      outcomes: FillOutcome[];
      /** Ids of remembered mappings that were written. Ids only, never values. */
      mappingIds?: string[];
    }
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
  | {
      type: 'content:draft';
      question: string;
      factIds: string[];
      maxCharacters?: number;
      /** Posting excerpt; used only when `factIds` includes 'posting'. */
      posting?: string;
    }
  /**
   * Titles of the user's custom fields and saved answers, for the picker and
   * the "Use a saved answer" list. Never values or answer text.
   */
  | { type: 'content:answer-choices'; question?: string }
  /** The text of ONE saved answer, after the user picked it by title. */
  | { type: 'content:saved-answer'; id: string };

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
