import { sanitizeString } from '@/security/validate';
import type {
  ApplicationHistoryEntry,
  ApplicationStatus,
  HistoryTrackerPatch,
} from '@/types/messages';

/**
 * Pure rules for application history: merging repeat fills, retention, the
 * tracker fields the user edits, and CSV export. No storage here, so every
 * rule is unit-testable without IndexedDB.
 */

export const APPLICATION_STATUSES: readonly ApplicationStatus[] = [
  'applied',
  'assessment',
  'interview',
  'offer',
  'rejected',
  'withdrawn',
];

/** Allowed retention choices, in months. 0 means keep forever. */
export const HISTORY_RETENTION_CHOICES = [6, 12, 24, 0] as const;
export type HistoryRetentionMonths = (typeof HISTORY_RETENTION_CHOICES)[number];

/** A hard ceiling so history can never grow without bound, whatever the setting. */
export const MAX_HISTORY_ENTRIES = 2_000;
export const MAX_NOTES = 2_000;

/** Further fills of the same posting within this window add to one entry. */
export const SAME_APPLICATION_MS = 6 * 60 * 60 * 1000;

export type NewFill = Omit<ApplicationHistoryEntry, 'id' | 'appliedAt'>;

/**
 * Finds the entry a new fill belongs to, if any, and returns it merged.
 * Returns null when the fill is a new application. The user's own tracker
 * fields (status, notes, follow-up, link) are never overwritten by a fill.
 */
export function mergeFill(
  entries: readonly ApplicationHistoryEntry[],
  fill: NewFill,
  nowMs: number,
): ApplicationHistoryEntry | null {
  const recent = entries.find(
    (item) =>
      item.origin === fill.origin &&
      item.role === fill.role &&
      item.company === fill.company &&
      nowMs - Date.parse(item.appliedAt) < SAME_APPLICATION_MS,
  );
  if (!recent) return null;
  return {
    ...recent,
    fieldsFilled: Math.min(500, recent.fieldsFilled + fill.fieldsFilled),
    ...(fill.profileId ? { profileId: fill.profileId } : {}),
  };
}

/**
 * Ids to delete under the retention setting and the hard cap. Entries with an
 * unreadable date are kept: deleting on a parse error would destroy data.
 */
export function expiredIds(
  entries: ReadonlyArray<Pick<ApplicationHistoryEntry, 'id' | 'appliedAt'>>,
  retentionMonths: number,
  now: Date,
  cap = MAX_HISTORY_ENTRIES,
): string[] {
  const out = new Set<string>();
  if (isRetentionChoice(retentionMonths) && retentionMonths > 0) {
    const cutoff = new Date(now.getTime());
    cutoff.setMonth(cutoff.getMonth() - retentionMonths);
    for (const entry of entries) {
      const when = Date.parse(entry.appliedAt);
      if (!Number.isNaN(when) && when < cutoff.getTime()) out.add(entry.id);
    }
  }
  const kept = entries
    .filter((entry) => !out.has(entry.id))
    .sort((a, b) => b.appliedAt.localeCompare(a.appliedAt));
  for (const entry of kept.slice(cap)) out.add(entry.id);
  return [...out];
}

export function isRetentionChoice(value: unknown): value is HistoryRetentionMonths {
  return (HISTORY_RETENTION_CHOICES as readonly unknown[]).includes(value);
}

/**
 * Reduces a posting link to origin + path. The query string and fragment go:
 * they routinely carry tracking ids, referral codes and session tokens.
 * Only http(s) links are kept.
 */
export function normalizePostingUrl(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  if (url.username || url.password) return null;
  const out = `${url.origin}${url.pathname}`;
  return out.length > 2048 ? null : out;
}

/** yyyy-mm-dd, a real calendar date. */
export function normalizeFollowUp(input: unknown): string | null {
  if (typeof input !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(input)) return null;
  const date = new Date(`${input}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === input ? input : null;
}

/**
 * Rebuilds an untrusted tracker patch field by field. Unknown keys are dropped;
 * `null` clears an optional field. Returns null if nothing valid remains.
 */
export function sanitizeTrackerPatch(input: unknown): HistoryTrackerPatch | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const raw = input as Record<string, unknown>;
  const patch: HistoryTrackerPatch = {};

  if (raw.status !== undefined) {
    if (!APPLICATION_STATUSES.includes(raw.status as ApplicationStatus)) return null;
    patch.status = raw.status as ApplicationStatus;
  }
  if (raw.notes !== undefined) {
    if (typeof raw.notes !== 'string') return null;
    patch.notes = sanitizeString(raw.notes, MAX_NOTES);
  }
  if (raw.followUpOn !== undefined) {
    if (raw.followUpOn === null || raw.followUpOn === '') patch.followUpOn = null;
    else {
      const date = normalizeFollowUp(raw.followUpOn);
      if (!date) return null;
      patch.followUpOn = date;
    }
  }
  if (raw.profileId !== undefined) {
    if (raw.profileId === null) patch.profileId = null;
    else if (typeof raw.profileId === 'string') patch.profileId = sanitizeString(raw.profileId, 64);
    else return null;
  }
  if (raw.postingUrl !== undefined) {
    if (raw.postingUrl === null || raw.postingUrl === '') patch.postingUrl = null;
    else {
      const url = normalizePostingUrl(raw.postingUrl);
      if (!url) return null;
      patch.postingUrl = url;
    }
  }
  return Object.keys(patch).length ? patch : null;
}

/** Applies a sanitized patch; `null` removes the field. */
export function applyTrackerPatch(
  entry: ApplicationHistoryEntry,
  patch: HistoryTrackerPatch,
): ApplicationHistoryEntry {
  const next: ApplicationHistoryEntry = { ...entry };
  if (patch.status !== undefined) next.status = patch.status;
  if (patch.notes !== undefined) {
    if (patch.notes) next.notes = patch.notes;
    else delete next.notes;
  }
  for (const key of ['followUpOn', 'profileId', 'postingUrl'] as const) {
    const value = patch[key];
    if (value === undefined) continue;
    if (value === null) delete next[key];
    else next[key] = value;
  }
  return next;
}

/** Status of an entry, defaulting old records to "applied". */
export function statusOf(entry: ApplicationHistoryEntry): ApplicationStatus {
  return entry.status ?? 'applied';
}

const CSV_COLUMNS = [
  'Applied on',
  'Company',
  'Role',
  'Site',
  'Status',
  'Follow up on',
  'Profile',
  'Posting link',
  'Fields filled',
  'Notes',
] as const;

/**
 * CSV for a spreadsheet. Company and role come from job pages, so every cell
 * is neutralised against formula injection: a leading = + - @ tab or CR is
 * prefixed with an apostrophe, and every cell is quoted.
 */
export function historyToCsv(
  entries: readonly ApplicationHistoryEntry[],
  profileNames: Readonly<Record<string, string>> = {},
): string {
  const rows = [
    [...CSV_COLUMNS],
    ...entries.map((entry) => [
      entry.appliedAt.slice(0, 10),
      entry.company,
      entry.role,
      entry.origin,
      statusOf(entry),
      entry.followUpOn ?? '',
      entry.profileId ? (profileNames[entry.profileId] ?? '') : '',
      entry.postingUrl ?? '',
      String(entry.fieldsFilled),
      entry.notes ?? '',
    ]),
  ];
  return rows.map((row) => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

function csvCell(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return `"${safe.replace(/"/g, '""')}"`;
}
