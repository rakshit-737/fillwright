import { useEffect, useState } from 'react';
import { send } from '@/utils/messaging';
import { computeCompleteness, type Completeness } from '@/profile/completeness';
import type { ProfileSummary } from '@/storage/profiles';
import type { Settings } from '@/types/settings';
import type { Profile } from '@/types/profile';

interface PopupState {
  settings: Settings;
  profiles: ProfileSummary[];
}

type Load =
  | { phase: 'loading' }
  | { phase: 'locked' }
  | { phase: 'error'; message: string }
  | { phase: 'ready'; state: PopupState; profile: Profile | null; completeness: Completeness | null };

export function App() {
  const [load, setLoad] = useState<Load>({ phase: 'loading' });
  const [scanState, setScanState] = useState<'idle' | 'scanning' | 'error'>('idle');
  const [scanError, setScanError] = useState('');

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const result = await send<PopupState>({ type: 'ui:get-state' });
      if (cancelled) return;
      if (!result.ok) {
        setLoad({ phase: 'error', message: result.error });
        return;
      }
      const { settings } = result.data;
      let profile: Profile | null = null;
      let locked = false;
      if (settings.activeProfileId) {
        const profileResult = await send<Profile>({
          type: 'ui:get-profile',
          profileId: settings.activeProfileId,
        });
        if (profileResult.ok) profile = profileResult.data;
        // A locked vault is expected, not an error: the popup says so and
        // offers the one action that fixes it.
        else if (profileResult.code === 'ELOCKED') locked = true;
      }
      if (cancelled) return;

      if (locked) {
        setLoad({ phase: 'locked' });
        return;
      }
      setLoad({
        phase: 'ready',
        state: result.data,
        profile,
        completeness: profile ? computeCompleteness(profile) : null,
      });
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const scanPage = async () => {
    setScanState('scanning');
    const result = await send({ type: 'ui:scan-active-tab' });
    if (result.ok) {
      // The panel takes over from here, on the page itself.
      window.close();
      return;
    }
    setScanState('error');
    setScanError(result.error);
  };

  const openOptions = (hash = '') => {
    chrome.tabs.create({ url: chrome.runtime.getURL(`options.html${hash}`) });
    window.close();
  };

  if (load.phase === 'loading') {
    return (
      <div className="fw-popup fw-popup--centered" role="status" aria-live="polite">
        <span className="fw-spinner" aria-hidden="true" />
        <p className="fw-muted">Loading your profile…</p>
      </div>
    );
  }

  if (load.phase === 'locked') {
    return (
      <div className="fw-popup fw-popup--centered">
        <span className="fw-lockmark" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="22" height="22">
            <path
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M7 11V8a5 5 0 0 1 10 0v3M5 11h14v9H5z"
            />
          </svg>
        </span>
        <h1 className="fw-popup__title">Fillwright is locked</h1>
        <p className="fw-muted">
          Your profile is encrypted on this device. Unlock it to fill applications.
        </p>
        <button className="fw-btn fw-btn--primary" onClick={() => openOptions('#/security')}>
          Unlock
        </button>
      </div>
    );
  }

  if (load.phase === 'error') {
    return (
      <div className="fw-popup fw-popup--centered" role="alert">
        <h1 className="fw-popup__title">Something went wrong</h1>
        <p className="fw-muted">{load.message}</p>
        <button className="fw-btn fw-btn--primary" onClick={() => location.reload()}>
          Try again
        </button>
      </div>
    );
  }

  const { state, profile, completeness } = load;
  const hasResume = state.profiles.find((p) => p.id === profile?.id)?.hasResume ?? false;
  const ready = (completeness?.percent ?? 0) >= 60;

  return (
    <div className="fw-popup">
      <header className="fw-popup__header">
        <div className="fw-brand">
          <span className="fw-brand__mark" aria-hidden="true" />
          <span className="fw-brand__name">Fillwright</span>
        </div>
        <button
          className="fw-icon-btn"
          onClick={() => openOptions('#/settings')}
          aria-label="Open settings"
          title="Settings"
        >
          <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true">
            <path
              fill="currentColor"
              d="M10 13a3 3 0 1 1 0-6 3 3 0 0 1 0 6Zm7.4-2.1.9-.7-1.3-2.3-1.1.4a5.9 5.9 0 0 0-1.4-.8L14.2 6h-2.6l-.3 1.5c-.5.2-1 .5-1.4.8l-1.1-.4L7.5 10l.9.7a5.6 5.6 0 0 0 0 1.6l-.9.7 1.3 2.3 1.1-.4c.4.3.9.6 1.4.8l.3 1.5h2.6l.3-1.5c.5-.2 1-.5 1.4-.8l1.1.4 1.3-2.3-.9-.7a5.6 5.6 0 0 0 0-1.6Z"
            />
          </svg>
        </button>
      </header>

      {profile ? (
        <main className="fw-popup__body">
          <section className="fw-card">
            <div className="fw-card__row">
              <h2 className="fw-card__label">{profile.name}</h2>
              <span className="fw-pct">{completeness?.percent ?? 0}%</span>
            </div>
            <div
              className="fw-meter"
              role="progressbar"
              aria-valuenow={completeness?.percent ?? 0}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label="Profile completion"
            >
              <div className="fw-meter__fill" style={{ width: `${completeness?.percent ?? 0}%` }} />
            </div>
            {completeness && completeness.topGaps.length > 0 && (
              <p className="fw-muted fw-card__hint">Still missing: {completeness.topGaps.slice(0, 3).join(', ')}</p>
            )}
          </section>

          <ul className="fw-status-list">
            <StatusRow
              label="Resume"
              value={hasResume ? 'Imported' : 'Not imported yet'}
              tone={hasResume ? 'ok' : 'caution'}
            />
            <StatusRow
              label="Autofill"
              value={ready ? 'Ready' : 'Add a few more details'}
              tone={ready ? 'ok' : 'caution'}
            />
            <StatusRow label="Privacy" value="Stored on this device" tone="ok" />
          </ul>

          <div className="fw-popup__actions">
            {scanState === 'error' && (
              <p className="fw-scan-error" role="alert">
                {scanError}
              </p>
            )}
            <button
              className="fw-btn fw-btn--primary"
              onClick={scanPage}
              disabled={scanState === 'scanning' || !ready}
              title={ready ? 'Scan this page for application fields' : 'Add more profile details first'}
            >
              {scanState === 'scanning' ? 'Scanning…' : 'Fill this page'}
            </button>
            <button className="fw-btn" onClick={() => openOptions('#/profile')}>
              Open profile
            </button>
            {!hasResume && (
              <button className="fw-btn" onClick={() => openOptions('#/import')}>
                Import resume
              </button>
            )}
          </div>
        </main>
      ) : (
        <main className="fw-popup__body fw-popup--centered">
          <h2 className="fw-popup__title">Let’s set you up</h2>
          <p className="fw-muted">Import a resume and Fillwright will build your profile locally.</p>
          <button className="fw-btn fw-btn--primary" onClick={() => openOptions('#/welcome')}>
            Get started
          </button>
        </main>
      )}

      <footer className="fw-popup__footer">
        <span className="fw-shield" aria-hidden="true">
          <svg viewBox="0 0 16 16" width="13" height="13">
            <path
              fill="currentColor"
              d="M8 1 2.5 3.2v4.3c0 3.4 2.3 6.5 5.5 7.5 3.2-1 5.5-4.1 5.5-7.5V3.2L8 1Zm2.6 5.2-3.1 3.6-2.1-2 .9-1 1.1 1.1 2.3-2.6.9.9Z"
            />
          </svg>
        </span>
        <span>Your resume never leaves this device.</span>
      </footer>
    </div>
  );
}

function StatusRow({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: 'ok' | 'caution' | 'danger';
}) {
  return (
    <li className="fw-status">
      <span className="fw-status__label">{label}</span>
      <span className={`fw-status__value fw-status__value--${tone}`}>{value}</span>
    </li>
  );
}
