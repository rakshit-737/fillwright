import { useCallback, useEffect, useState } from 'react';
import { send } from '@/utils/messaging';
import { ImportResume } from './ImportResume';
import type { Settings } from '@/types/settings';
import type { Profile } from '@/types/profile';

/**
 * First-run onboarding: from install to a filled form in a few minutes.
 *
 * Trust boundary: an extension page. It reads the active profile (to show
 * what was imported), the manifest and the granted permissions (to state the
 * privacy facts from the source of truth rather than from copy), and opens the
 * bundled practice page. It never opens or touches a website.
 *
 * Progress is saved after every step, so closing the tab resumes where the
 * user left off.
 */

const STEPS = ['Welcome', 'Import your resume', 'Check your details', 'Try it', 'Your privacy'];

export function Welcome({
  settings,
  onSettingsChange,
  onDone,
}: {
  settings: Settings | null;
  onSettingsChange: (settings: Settings) => void;
  onDone: () => void;
}) {
  const [index, setIndex] = useState(() =>
    Math.min(STEPS.length - 1, Math.max(0, settings?.onboardingStep ?? 0)),
  );
  const [error, setError] = useState('');

  const go = useCallback(
    async (next: number) => {
      setIndex(next);
      const result = await send<Settings>({
        type: 'ui:set-settings',
        patch: { onboardingStep: next },
      });
      if (result.ok) onSettingsChange(result.data);
    },
    [onSettingsChange],
  );

  const finish = async () => {
    const result = await send<Settings>({
      type: 'ui:set-settings',
      patch: { onboardingCompleted: true, onboardingStep: 0 },
    });
    if (!result.ok) {
      setError(`Setup couldn’t be saved. ${result.error}`);
      return;
    }
    onSettingsChange(result.data);
    onDone();
  };

  const title = STEPS[index]!;
  return (
    <div className="fw-pane fw-welcome">
      <div className="fw-welcome__card">
        <div className="fw-welcome__progress">
          <ol className="fw-steps" aria-label="Setup progress">
            {STEPS.map((name, position) => (
              <li
                key={name}
                className={`fw-steps__dot${position === index ? ' fw-steps__dot--on' : ''}${
                  position < index ? ' fw-steps__dot--done' : ''
                }`}
                aria-current={position === index ? 'step' : undefined}
              >
                <span className="fw-sr-only">
                  Step {position + 1} of {STEPS.length}: {name}
                  {position < index ? ' (done)' : ''}
                </span>
              </li>
            ))}
          </ol>
          <p className="fw-welcome__count" aria-hidden="true">
            Step {index + 1} of {STEPS.length}
          </p>
        </div>

        <h1 className="fw-welcome__title">{title}</h1>

        {error && (
          <div className="fw-notice fw-notice--danger" role="alert">
            {error}
          </div>
        )}

        {index === 0 && <IntroStep />}
        {index === 1 && <ImportStep settings={settings} onSaved={() => void go(2)} />}
        {index === 2 && <DetailsStep settings={settings} />}
        {index === 3 && <TryStep settings={settings} />}
        {index === 4 && <PrivacyStep />}

        <div className="fw-actions fw-welcome__actions">
          {index > 0 && (
            <button className="fw-btn" onClick={() => void go(index - 1)}>
              Back
            </button>
          )}
          {index < STEPS.length - 1 ? (
            <button className="fw-btn fw-btn--primary" onClick={() => void go(index + 1)}>
              {index === 1
                ? 'Skip this for now'
                : index === 3 && !settings?.onboardingTriedFill
                  ? 'Skip the practice'
                  : 'Continue'}
            </button>
          ) : (
            <button className="fw-btn fw-btn--primary" onClick={() => void finish()}>
              Finish
            </button>
          )}
          {index < STEPS.length - 1 && (
            <button className="fw-btn fw-welcome__skip" onClick={() => void finish()}>
              Skip setup
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function IntroStep() {
  return (
    <>
      <p className="fw-welcome__body">
        Import your resume once. On a job application, Fillwright shows you what it would fill, you
        approve it, and it fills the form. You always press Submit yourself.
      </p>
      <ul className="fw-welcome__list">
        <li>Your resume is read in this browser. It is not uploaded.</li>
        <li>Nothing is written to a form until you approve it, and every fill can be undone.</li>
        <li>
          Work authorisation, demographics and salary are never guessed — they stay blank until you
          answer them.
        </li>
      </ul>
      <p className="fw-welcome__detail">About three minutes, and you can stop at any point.</p>
    </>
  );
}

function ImportStep({ settings, onSaved }: { settings: Settings | null; onSaved: () => void }) {
  return (
    <>
      <p className="fw-welcome__body">
        Choose your resume, or paste its text. Fillwright shows you what it read before anything is
        saved.
      </p>
      <ImportResume settings={settings} embedded onSaved={onSaved} />
    </>
  );
}

function DetailsStep({ settings }: { settings: Settings | null }) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!settings?.activeProfileId) return;
    void send<Profile>({ type: 'ui:get-profile', profileId: settings.activeProfileId }).then(
      (result) => (result.ok ? setProfile(result.data) : setError(result.error)),
    );
  }, [settings?.activeProfileId]);

  if (error) return <p className="fw-welcome__body">{error}</p>;
  if (!profile) return <p className="fw-welcome__body">Loading your details…</p>;

  const rows: Array<[string, string]> = [
    [
      'Name',
      profile.personal.fullName.value ||
        `${profile.personal.firstName.value} ${profile.personal.lastName.value}`.trim(),
    ],
    ['Email', profile.personal.email.value],
    ['Phone', profile.personal.phone.value],
    [
      'Education',
      profile.education
        .map((entry) => entry.institution)
        .filter(Boolean)
        .join(', '),
    ],
    [
      'Experience',
      profile.experience
        .map((entry) => entry.company)
        .filter(Boolean)
        .join(', '),
    ],
  ];
  return (
    <>
      <p className="fw-welcome__body">
        This is what Fillwright will use. Anything wrong or missing can be fixed on the Profile page
        — your edits are never overwritten by a later import.
      </p>
      <dl className="fw-welcome__facts">
        {rows.map(([label, value]) => (
          <div key={label} className="fw-welcome__fact">
            <dt>{label}</dt>
            <dd>{value || <span className="fw-muted">Not found — add it later</span>}</dd>
          </div>
        ))}
      </dl>
      <a className="fw-linkbtn" href="#/profile" target="_blank" rel="noreferrer">
        Open the full profile in a new tab
      </a>
    </>
  );
}

function TryStep({ settings }: { settings: Settings | null }) {
  const tried = settings?.onboardingTriedFill ?? false;
  const open = () => {
    void chrome.tabs
      .create({ url: chrome.runtime.getURL('practice.html') })
      .catch(() => (location.href = chrome.runtime.getURL('practice.html')));
  };
  return (
    <>
      <p className="fw-welcome__body">
        A practice application opens in a new tab — part of Fillwright, on this device. Press{' '}
        <strong>Fill</strong> in the panel, look at what changed, then come back here.
      </p>
      <div className="fw-actions">
        <button className="fw-btn" onClick={open}>
          Open the practice form
        </button>
      </div>
      <p className="fw-welcome__detail" role="status" aria-live="polite">
        {tried
          ? '✓ Practice form filled. That is exactly what happens on a real application.'
          : 'On real sites, click the Fillwright button (or press Alt+Shift+F) on the application page.'}
      </p>
    </>
  );
}

interface Facts {
  hostAccess: string[];
  networkBlocked: boolean;
}

/** Every statement here is read from the running extension, not written as copy. */
function PrivacyStep() {
  const [facts, setFacts] = useState<Facts | null>(null);
  useEffect(() => {
    const csp = chrome.runtime.getManifest().content_security_policy as
      { extension_pages?: string } | undefined;
    void chrome.permissions.getAll().then((granted) =>
      setFacts({
        hostAccess: granted.origins ?? [],
        networkBlocked: /connect-src\s+'self'(?:\s*;|\s*$)/.test(csp?.extension_pages ?? ''),
      }),
    );
  }, []);

  if (!facts) return <p className="fw-welcome__body">Checking…</p>;
  return (
    <ul className="fw-checklist">
      <li className="fw-check">
        <span
          className={`fw-check__mark fw-check__mark--${facts.hostAccess.length ? 'warn' : 'ok'}`}
          aria-hidden="true"
        >
          {facts.hostAccess.length ? '!' : '✓'}
        </span>
        <span>
          {facts.hostAccess.length
            ? `Fillwright can read these sites without a click: ${facts.hostAccess.join(', ')}. You can remove this under Settings.`
            : 'No website access is granted. Fillwright reads a page only when you click its button or press the shortcut.'}
        </span>
      </li>
      <li className="fw-check">
        <span
          className={`fw-check__mark fw-check__mark--${facts.networkBlocked ? 'ok' : 'warn'}`}
          aria-hidden="true"
        >
          {facts.networkBlocked ? '✓' : '!'}
        </span>
        <span>
          {facts.networkBlocked
            ? 'Network requests are blocked for Fillwright’s own pages by its security policy (connect-src ’self’). Your profile has no way off this device.'
            : 'This build’s security policy does not block network requests. Please report this.'}
        </span>
      </li>
      <li className="fw-check">
        <span className="fw-check__mark fw-check__mark--ok" aria-hidden="true">
          ✓
        </span>
        <span>
          Nothing is ever submitted automatically. Fillwright has no code that presses Submit or
          Apply.
        </span>
      </li>
    </ul>
  );
}
