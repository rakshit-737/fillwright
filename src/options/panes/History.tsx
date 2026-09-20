import { useCallback, useEffect, useId, useMemo, useState } from 'react';
import { send } from '@/utils/messaging';
import { CheckField, SelectField } from '@/components/TrackedField';
import { APPLICATION_STATUSES, historyToCsv, statusOf } from '@/storage/history-model';
import type {
  ApplicationHistoryEntry,
  ApplicationStatus,
  HistoryTrackerPatch,
} from '@/types/messages';
import type { ProfileSummary } from '@/storage/profiles';
import type { Settings } from '@/types/settings';

/**
 * Application history and tracker.
 *
 * Off by default. Fills record company, role, site, date and a count — never
 * what was typed. Everything else (status, notes, follow-up date, the profile
 * used, and a posting link) is added by the user here. With the vault on the
 * whole record is encrypted, and while locked this pane says so rather than
 * showing an empty list.
 */
export function History({
  settings,
  onSettingsChange,
}: {
  settings: Settings | null;
  onSettingsChange: (settings: Settings) => void;
}) {
  const [entries, setEntries] = useState<ApplicationHistoryEntry[]>([]);
  const [profiles, setProfiles] = useState<ProfileSummary[]>([]);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<SortOrder>('newest');
  const [loading, setLoading] = useState(true);
  const [locked, setLocked] = useState(false);
  const [notice, setNotice] = useState('');

  const enabled = settings?.privacy.keepApplicationHistory ?? false;
  const retention = settings?.privacy.historyRetentionMonths ?? 0;

  const refresh = useCallback(async () => {
    const [result, people] = await Promise.all([
      send<ApplicationHistoryEntry[]>({ type: 'ui:list-history' }),
      send<ProfileSummary[]>({ type: 'ui:list-profiles' }),
    ]);
    if (people.ok) setProfiles(people.data);
    if (result.ok) {
      setEntries(result.data);
      setLocked(false);
    } else if (result.code === 'ELOCKED') {
      setEntries([]);
      setLocked(true);
    } else setNotice(`Your history couldn’t be loaded. ${result.error}`);
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const profileNames = useMemo(
    () => Object.fromEntries(profiles.map((p) => [p.id, p.name])) as Record<string, string>,
    [profiles],
  );

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const matching = needle
      ? entries.filter((entry) =>
          `${entry.company} ${entry.role} ${entry.origin} ${statusOf(entry)} ${entry.notes ?? ''}`
            .toLowerCase()
            .includes(needle),
        )
      : entries;
    return sortEntries(matching, sort);
  }, [entries, query, sort]);

  // Date headings only make sense when the list is in date order.
  const grouped = useMemo(
    () =>
      sort === 'company'
        ? [['A–Z by company', filtered] as [string, ApplicationHistoryEntry[]]]
        : groupByDay(filtered),
    [filtered, sort],
  );

  const patchSettings = async (privacy: Partial<Settings['privacy']>) => {
    const result = await send<Settings>({ type: 'ui:set-settings', patch: { privacy } });
    if (result.ok) onSettingsChange(result.data);
    else setNotice(`The setting wasn’t changed. ${result.error}`);
    return result.ok;
  };

  const changeRetention = async (value: string) => {
    const months = Number(value);
    if (
      months > 0 &&
      !window.confirm(
        `Delete entries older than ${months} months now, and keep deleting them as they age?`,
      )
    )
      return;
    if (await patchSettings({ historyRetentionMonths: months })) await refresh();
  };

  const update = async (id: string, patch: HistoryTrackerPatch) => {
    const result = await send<ApplicationHistoryEntry>({ type: 'ui:update-history', id, patch });
    if (result.ok) {
      setEntries((current) => current.map((entry) => (entry.id === id ? result.data : entry)));
      return true;
    }
    setNotice(
      result.code === 'ELOCKED'
        ? 'Fillwright is locked. Unlock it under Security to change your history.'
        : `That change wasn’t saved. ${result.error}`,
    );
    return false;
  };

  const remove = async (entry: ApplicationHistoryEntry) => {
    if (!window.confirm(`Remove ${entry.company || 'this entry'} from your history?`)) return;
    const result = await send({ type: 'ui:delete-history-entry', id: entry.id });
    if (result.ok) setEntries((current) => current.filter((item) => item.id !== entry.id));
    else setNotice(`The entry wasn’t removed. ${result.error}`);
  };

  const clear = async () => {
    if (!window.confirm('Clear your application history? This cannot be undone.')) return;
    const result = await send({ type: 'ui:clear-history' });
    await refresh();
    setNotice(result.ok ? 'History cleared.' : `History wasn’t cleared. ${result.error}`);
  };

  /** Built and saved in this page; nothing is uploaded. */
  const exportCsv = () => {
    const blob = new Blob([historyToCsv(filtered, profileNames)], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `fillwright-history-${new Date().toISOString().slice(0, 10)}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
    setNotice('CSV saved to this device. It is not encrypted — keep it somewhere private.');
  };

  return (
    <div className="fw-pane">
      <header className="fw-pane__header">
        <h1 className="fw-pane__title">Application history</h1>
        <p className="fw-pane__subtitle">
          A local tracker of where you have applied. Fills record company, role, site and date —
          never what you typed. Status, notes and links are yours to add. Nothing is uploaded.
        </p>
      </header>

      {notice && (
        <div className="fw-notice" role="status">
          {notice}
        </div>
      )}

      <section className="fw-section">
        <CheckField
          label="Keep a history of my applications"
          hint="Stored on this device. Encrypted with your profile when encryption is on."
          checked={enabled}
          onChange={(value) => void patchSettings({ keepApplicationHistory: value })}
        />
        <SelectField
          label="Keep entries for"
          value={String(retention)}
          options={[
            ['6', '6 months'],
            ['12', '12 months'],
            ['24', '24 months'],
            ['0', 'Until I clear them'],
          ]}
          onChange={(value) => void changeRetention(value)}
        />
      </section>

      {locked && (
        <div className="fw-notice" role="status">
          History is locked. Unlock Fillwright under <a href="#/security">Security</a> to see it.
        </div>
      )}

      {!locked && !enabled && entries.length === 0 && !loading && (
        <p className="fw-empty">
          History is off, so nothing is being recorded. Turn it on above if you would like
          Fillwright to keep track of where you have applied.
        </p>
      )}

      {entries.length > 0 && (
        <>
          <div className="fw-historybar">
            <input
              className="fw-input"
              type="search"
              value={query}
              placeholder="Search by company, role, site, status or notes"
              aria-label="Search application history"
              onChange={(event) => setQuery(event.target.value)}
            />
            <div className="fw-historytools">
              <select
                className="fw-select"
                value={sort}
                aria-label="Sort application history"
                onChange={(event) => setSort(event.target.value as SortOrder)}
              >
                <option value="newest">Newest first</option>
                <option value="oldest">Oldest first</option>
                <option value="company">Company A–Z</option>
              </select>
              <button className="fw-btn fw-btn--sm" onClick={exportCsv}>
                Export CSV
              </button>
              <button className="fw-btn fw-btn--danger fw-btn--sm" onClick={() => void clear()}>
                Clear history
              </button>
            </div>
          </div>

          {filtered.length === 0 ? (
            <p className="fw-empty">Nothing matches “{query}”.</p>
          ) : (
            grouped.map(([day, items]) => (
              <section className="fw-section" key={day}>
                <h2 className="fw-section__title">{day}</h2>
                <ul className="fw-historylist">
                  {items.map((entry) => (
                    <HistoryItem
                      key={entry.id}
                      entry={entry}
                      profiles={profiles}
                      onUpdate={(patch) => update(entry.id, patch)}
                      onRemove={() => void remove(entry)}
                    />
                  ))}
                </ul>
              </section>
            ))
          )}
        </>
      )}

      {loading && <p className="fw-muted">Loading…</p>}
    </div>
  );
}

const STATUS_LABELS: Record<ApplicationStatus, string> = {
  applied: 'Applied',
  assessment: 'Assessment',
  interview: 'Interview',
  offer: 'Offer',
  rejected: 'Rejected',
  withdrawn: 'Withdrawn',
};

function HistoryItem({
  entry,
  profiles,
  onUpdate,
  onRemove,
}: {
  entry: ApplicationHistoryEntry;
  profiles: ProfileSummary[];
  onUpdate: (patch: HistoryTrackerPatch) => Promise<boolean>;
  onRemove: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [notes, setNotes] = useState(entry.notes ?? '');
  const [keepLink, setKeepLink] = useState(Boolean(entry.postingUrl));
  const [link, setLink] = useState(entry.postingUrl ?? '');
  const [linkError, setLinkError] = useState('');
  const id = useId();

  const saveLink = async () => {
    if (!link.trim()) return;
    const saved = await onUpdate({ postingUrl: link });
    setLinkError(saved ? '' : 'Use a full web address, starting with https://');
  };

  const toggleLink = async (value: boolean) => {
    setKeepLink(value);
    if (!value && entry.postingUrl) {
      await onUpdate({ postingUrl: null });
      setLink('');
    }
  };

  const profileOptions: Array<[string, string]> = [
    ['', 'Not recorded'],
    ...profiles.map((p): [string, string] => [p.id, p.name]),
  ];
  if (entry.profileId && !profiles.some((p) => p.id === entry.profileId)) {
    profileOptions.push([entry.profileId, 'A deleted profile']);
  }

  return (
    <li className="fw-history">
      <div className="fw-history__main">
        <span className="fw-history__company">{entry.company || 'Unnamed company'}</span>
        <span className="fw-history__role">{entry.role || 'Role not recorded'}</span>
      </div>
      <div className="fw-history__meta">
        <span className="fw-history__status">{STATUS_LABELS[statusOf(entry)]}</span>
        <span className="fw-history__site">{hostOf(entry.origin)}</span>
        <span className="fw-history__count">
          {entry.fieldsFilled} field{entry.fieldsFilled === 1 ? '' : 's'} filled
        </span>
        {entry.followUpOn && <span>Follow up {entry.followUpOn}</span>}
      </div>
      <button
        className="fw-btn fw-btn--sm"
        aria-expanded={open}
        aria-controls={open ? `${id}-tracker` : undefined}
        onClick={() => setOpen((value) => !value)}
      >
        {open ? 'Done' : 'Track'}
      </button>
      {open && (
        <div className="fw-history__tracker" id={`${id}-tracker`}>
          <SelectField
            label="Status"
            value={statusOf(entry)}
            options={APPLICATION_STATUSES.map((status): [string, string] => [
              status,
              STATUS_LABELS[status],
            ])}
            onChange={(value) => void onUpdate({ status: value as ApplicationStatus })}
          />
          <div className="fw-tf">
            <label className="fw-tf__label" htmlFor={`${id}-follow`}>
              Follow up on
            </label>
            <input
              id={`${id}-follow`}
              className="fw-input fw-tf__input"
              type="date"
              value={entry.followUpOn ?? ''}
              onChange={(event) => void onUpdate({ followUpOn: event.target.value || null })}
            />
          </div>
          <SelectField
            label="Profile used"
            value={entry.profileId ?? ''}
            options={profileOptions}
            onChange={(value) => void onUpdate({ profileId: value || null })}
          />
          <div className="fw-tf">
            <label className="fw-tf__label" htmlFor={`${id}-notes`}>
              Notes
            </label>
            <textarea
              id={`${id}-notes`}
              className="fw-textarea fw-tf__input"
              rows={3}
              maxLength={2000}
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              onBlur={() => {
                if (notes !== (entry.notes ?? '')) void onUpdate({ notes });
              }}
            />
          </div>
          <CheckField
            label="Save a link to this posting"
            hint="Only the site and page are kept; anything after ? or # is removed."
            checked={keepLink}
            onChange={(value) => void toggleLink(value)}
          />
          {keepLink && (
            <div className="fw-tf">
              <label className="fw-tf__label" htmlFor={`${id}-link`}>
                Posting link
              </label>
              <input
                id={`${id}-link`}
                className="fw-input fw-tf__input"
                type="url"
                value={link}
                placeholder="https://"
                aria-invalid={linkError ? true : undefined}
                aria-describedby={linkError ? `${id}-link-error` : undefined}
                onChange={(event) => setLink(event.target.value)}
                onBlur={() => void saveLink()}
              />
              {linkError && (
                <span className="fw-field__hint" id={`${id}-link-error`}>
                  {linkError}
                </span>
              )}
            </div>
          )}
          <div className="fw-actions">
            <button className="fw-btn fw-btn--danger fw-btn--sm" onClick={onRemove}>
              Remove entry
            </button>
          </div>
        </div>
      )}
    </li>
  );
}

type SortOrder = 'newest' | 'oldest' | 'company';

function sortEntries(
  entries: ApplicationHistoryEntry[],
  order: SortOrder,
): ApplicationHistoryEntry[] {
  const copy = [...entries];
  switch (order) {
    case 'oldest':
      return copy.sort((a, b) => a.appliedAt.localeCompare(b.appliedAt));
    case 'company':
      return copy.sort(
        (a, b) =>
          a.company.localeCompare(b.company, undefined, { sensitivity: 'base' }) ||
          b.appliedAt.localeCompare(a.appliedAt),
      );
    default:
      return copy.sort((a, b) => b.appliedAt.localeCompare(a.appliedAt));
  }
}

function groupByDay(
  entries: ApplicationHistoryEntry[],
): Array<[string, ApplicationHistoryEntry[]]> {
  const buckets = new Map<string, ApplicationHistoryEntry[]>();
  for (const entry of entries) {
    const day = dayLabel(entry.appliedAt);
    buckets.set(day, [...(buckets.get(day) ?? []), entry]);
  }
  return Array.from(buckets.entries());
}

function dayLabel(iso: string): string {
  const when = new Date(iso);
  if (Number.isNaN(when.getTime())) return 'Earlier';

  const today = new Date();
  const days = Math.floor(
    (Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()) -
      Date.UTC(when.getFullYear(), when.getMonth(), when.getDate())) /
      86_400_000,
  );

  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return 'This week';
  return when.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

function hostOf(origin: string): string {
  try {
    return new URL(origin).hostname.replace(/^www\./, '');
  } catch {
    return origin || 'unknown site';
  }
}
