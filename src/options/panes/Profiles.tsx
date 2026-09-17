import { useCallback, useEffect, useState } from 'react';
import { send } from '@/utils/messaging';
import { computeCompleteness } from '@/profile/completeness';
import type { ProfileSummary } from '@/storage/profiles';
import type { Profile } from '@/types/profile';
import type { Settings } from '@/types/settings';

interface ProfileCard extends ProfileSummary {
  completion: number;
  gaps: string[];
  counts: { education: number; experience: number; skills: number };
}

/**
 * Profile management.
 *
 * People apply for materially different jobs and need different emphases —
 * a security profile and an ML profile share a name and an email and little
 * else. Switching between them has to be a two-second operation, so this shows
 * enough of each profile to choose confidently without opening it.
 */
export function Profiles({
  settings,
  onSettingsChange,
}: {
  settings: Settings | null;
  onSettingsChange: (settings: Settings) => void;
}) {
  const [cards, setCards] = useState<ProfileCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState('');
  const [renaming, setRenaming] = useState<string | null>(null);
  const [draftName, setDraftName] = useState('');

  const activeId = settings?.activeProfileId ?? null;

  const refresh = useCallback(async () => {
    const result = await send<ProfileSummary[]>({ type: 'ui:list-profiles' });
    if (!result.ok) {
      setNotice(`Your profiles couldn’t be loaded. ${result.error}`);
      setLoading(false);
      return;
    }

    // Completion is computed from the full profile, so each one is loaded.
    // Profiles are small and few; this is cheaper than storing a derived value
    // that could drift out of date.
    const detailed: ProfileCard[] = [];
    for (const summary of result.data) {
      const full = await send<Profile>({ type: 'ui:get-profile', profileId: summary.id });
      if (!full.ok) {
        // Still list it — a profile that can't be opened right now (a locked
        // vault, say) should not look as if it had vanished.
        detailed.push({
          ...summary,
          completion: 0,
          gaps: [full.error],
          counts: { education: 0, experience: 0, skills: 0 },
        });
        continue;
      }
      const completeness = computeCompleteness(full.data);
      detailed.push({
        ...summary,
        completion: completeness.percent,
        gaps: completeness.topGaps,
        counts: {
          education: full.data.education.length,
          experience: full.data.experience.length,
          skills: full.data.skills.length,
        },
      });
    }

    setCards(detailed);
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const activate = async (profileId: string) => {
    setBusy(profileId);
    const result = await send<Settings>({ type: 'ui:set-active-profile', profileId });
    setBusy('');
    if (result.ok) {
      onSettingsChange(result.data);
      setNotice(
        `Now using “${cards.find((card) => card.id === profileId)?.name ?? 'this profile'}”.`,
      );
    } else {
      setNotice(`The active profile wasn’t changed. ${result.error}`);
    }
  };

  const create = async (cloneFromId?: string) => {
    const source = cards.find((card) => card.id === cloneFromId);
    const name = cloneFromId ? `${source?.name ?? 'Profile'} copy` : 'New profile';
    setBusy(cloneFromId ?? 'new');
    const result = await send<Profile>({
      type: 'ui:create-profile',
      name,
      ...(cloneFromId ? { cloneFromId } : {}),
    });
    setBusy('');
    if (!result.ok) {
      setNotice(`No profile was created. ${result.error}`);
    } else {
      await refresh();
      setRenaming(result.data.id);
      setDraftName(name);
      setNotice(
        cloneFromId
          ? 'Copied. The resume file is not duplicated — import one, or keep using the original profile for that.'
          : 'Profile created.',
      );
    }
  };

  const rename = async (profileId: string) => {
    const trimmed = draftName.trim();
    setRenaming(null);
    if (!trimmed) return;
    const current = await send<Profile>({ type: 'ui:get-profile', profileId });
    const saved = current.ok
      ? await send({ type: 'ui:save-profile', profile: { ...current.data, name: trimmed } })
      : current;
    await refresh();
    if (!saved.ok) setNotice(`The profile wasn’t renamed. ${saved.error}`);
  };

  const remove = async (card: ProfileCard) => {
    const confirmed = window.confirm(
      `Delete “${card.name}”?\n\n` +
        'Its profile data and any resume imported into it are removed from this device. ' +
        'This cannot be undone.',
    );
    if (!confirmed) return;
    setBusy(card.id);
    const deleted = await send({ type: 'ui:delete-profile', profileId: card.id });
    const state = await send<Settings>({ type: 'ui:get-settings' });
    if (state.ok) onSettingsChange(state.data);
    setBusy('');
    await refresh();
    setNotice(
      deleted.ok
        ? `“${card.name}” was deleted.`
        : `“${card.name}” wasn’t deleted. ${deleted.error}`,
    );
  };

  if (loading) {
    return (
      <div className="fw-pane" role="status">
        <span className="fw-spinner" aria-hidden="true" />{' '}
        <span className="fw-muted">Loading profiles…</span>
      </div>
    );
  }

  return (
    <div className="fw-pane">
      <header className="fw-pane__header">
        <h1 className="fw-pane__title">Profiles</h1>
        <p className="fw-pane__subtitle">
          Keep a separate profile for each kind of role you apply for. Fillwright fills from
          whichever one is active.
        </p>
      </header>

      {notice && (
        <div className="fw-notice" role="status">
          {notice}
        </div>
      )}

      <ul className="fw-profiles">
        {cards.map((card) => {
          const isActive = card.id === activeId;
          return (
            <li className={`fw-profile${isActive ? ' fw-profile--active' : ''}`} key={card.id}>
              <div className="fw-profile__head">
                {renaming === card.id ? (
                  <input
                    className="fw-input fw-profile__rename"
                    value={draftName}
                    autoFocus
                    aria-label="Profile name"
                    onChange={(event) => setDraftName(event.target.value)}
                    onBlur={() => void rename(card.id)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') void rename(card.id);
                      if (event.key === 'Escape') setRenaming(null);
                    }}
                  />
                ) : (
                  <h2 className="fw-profile__name">{card.name}</h2>
                )}
                {isActive && <span className="fw-tag">Active</span>}
              </div>

              <div className="fw-profile__meter">
                <div
                  className="fw-meter"
                  role="progressbar"
                  aria-valuenow={card.completion}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-label={`${card.name} completion`}
                >
                  <div className="fw-meter__fill" style={{ width: `${card.completion}%` }} />
                </div>
                <span className="fw-pct">{card.completion}%</span>
              </div>

              <p className="fw-profile__facts">
                {card.hasResume ? 'Resume imported' : 'No resume'} · {card.counts.education}{' '}
                education · {card.counts.experience} roles · {card.counts.skills} skills
              </p>
              <p className="fw-profile__facts fw-profile__facts--subtle">
                Updated {formatWhen(card.updatedAt)}
                {card.gaps.length > 0 && <> · missing {card.gaps.slice(0, 2).join(', ')}</>}
              </p>

              <div className="fw-profile__actions">
                {!isActive && (
                  <button
                    className="fw-btn fw-btn--primary fw-btn--sm"
                    disabled={busy === card.id}
                    onClick={() => void activate(card.id)}
                  >
                    Use this profile
                  </button>
                )}
                <button
                  className="fw-btn fw-btn--sm"
                  onClick={() => {
                    setRenaming(card.id);
                    setDraftName(card.name);
                  }}
                >
                  Rename
                </button>
                <button
                  className="fw-btn fw-btn--sm"
                  disabled={busy === card.id}
                  onClick={() => void create(card.id)}
                >
                  Duplicate
                </button>
                <button
                  className="fw-btn fw-btn--sm fw-btn--danger"
                  disabled={busy === card.id || cards.length === 1}
                  title={cards.length === 1 ? 'This is your only profile' : undefined}
                  onClick={() => void remove(card)}
                >
                  Delete
                </button>
              </div>
            </li>
          );
        })}
      </ul>

      <div className="fw-actions">
        <button className="fw-btn" disabled={busy === 'new'} onClick={() => void create()}>
          Create a profile
        </button>
      </div>
    </div>
  );
}

/** Dates read better as "today" than as a timestamp for recent edits. */
function formatWhen(iso: string): string {
  const when = new Date(iso);
  if (Number.isNaN(when.getTime())) return 'recently';

  const days = Math.floor((Date.now() - when.getTime()) / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  return when.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}
