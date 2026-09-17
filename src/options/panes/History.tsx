import { useCallback, useEffect, useMemo, useState } from 'react';
import { send } from '@/utils/messaging';
import { CheckField } from '@/components/TrackedField';
import type { ApplicationHistoryEntry } from '@/types/messages';
import type { Settings } from '@/types/settings';

/**
 * Application history.
 *
 * Off by default, and metadata only — company, role, site, date, and how many
 * fields were filled. What you actually typed is never recorded, so this can
 * never become a copy of your applications.
 */
export function History({
  settings,
  onSettingsChange,
}: {
  settings: Settings | null;
  onSettingsChange: (settings: Settings) => void;
}) {
  const [entries, setEntries] = useState<ApplicationHistoryEntry[]>([]);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<SortOrder>('newest');
  const [loading, setLoading] = useState(true);

  const enabled = settings?.privacy.keepApplicationHistory ?? false;

  const refresh = useCallback(async () => {
    const result = await send<ApplicationHistoryEntry[]>({ type: 'ui:list-history' });
    if (result.ok) setEntries(result.data);
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const matching = needle
      ? entries.filter((entry) =>
          `${entry.company} ${entry.role} ${entry.origin}`.toLowerCase().includes(needle),
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

  const toggle = async (value: boolean) => {
    const result = await send<Settings>({
      type: 'ui:set-settings',
      patch: { privacy: { keepApplicationHistory: value } },
    });
    if (result.ok) onSettingsChange(result.data);
  };

  const clear = async () => {
    if (!window.confirm('Clear your application history? This cannot be undone.')) return;
    await send({ type: 'ui:clear-history' });
    await refresh();
  };

  return (
    <div className="fw-pane">
      <header className="fw-pane__header">
        <h1 className="fw-pane__title">Application history</h1>
        <p className="fw-pane__subtitle">
          A local record of where you have applied. Company, role, site and date only — never what
          you typed, and never uploaded.
        </p>
      </header>

      <section className="fw-section">
        <CheckField
          label="Keep a history of my applications"
          hint="Stored on this device, in the same local database as your profile."
          checked={enabled}
          onChange={(value) => void toggle(value)}
        />
      </section>

      {!enabled && entries.length === 0 && (
        <p className="fw-empty">
          History is off, so nothing is being recorded. Turn it on above if you would like Fillwright
          to keep track of where you have applied.
        </p>
      )}

      {entries.length > 0 && (
        <>
          <div className="fw-historybar">
            <input
              className="fw-input"
              type="search"
              value={query}
              placeholder="Search by company, role or site"
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
                    <li className="fw-history" key={entry.id}>
                      <div className="fw-history__main">
                        <span className="fw-history__company">{entry.company || 'Unnamed company'}</span>
                        <span className="fw-history__role">{entry.role || 'Role not recorded'}</span>
                      </div>
                      <div className="fw-history__meta">
                        <span className="fw-history__site">{hostOf(entry.origin)}</span>
                        <span className="fw-history__count">
                          {entry.fieldsFilled} field{entry.fieldsFilled === 1 ? '' : 's'} filled
                        </span>
                      </div>
                    </li>
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

type SortOrder = 'newest' | 'oldest' | 'company';

function sortEntries(entries: ApplicationHistoryEntry[], order: SortOrder): ApplicationHistoryEntry[] {
  const copy = [...entries];
  switch (order) {
    case 'oldest':
      return copy.sort((a, b) => a.appliedAt.localeCompare(b.appliedAt));
    case 'company':
      return copy.sort(
        (a, b) => a.company.localeCompare(b.company, undefined, { sensitivity: 'base' }) ||
          b.appliedAt.localeCompare(a.appliedAt),
      );
    default:
      return copy.sort((a, b) => b.appliedAt.localeCompare(a.appliedAt));
  }
}

function groupByDay(entries: ApplicationHistoryEntry[]): Array<[string, ApplicationHistoryEntry[]]> {
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
