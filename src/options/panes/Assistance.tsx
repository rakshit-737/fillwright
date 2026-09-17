import { useCallback, useEffect, useState } from 'react';
import { send } from '@/utils/messaging';
import { CheckField } from '@/components/TrackedField';
import { getProvider, type Availability } from '@/ai/provider';
import type { Settings } from '@/types/settings';

/**
 * Optional AI assistance.
 *
 * Off by default, and the page is written so that staying off is an obviously
 * reasonable choice. Availability is checked live, so nobody enables a feature
 * that this browser cannot actually run.
 */
export function Assistance({
  settings,
  onSettingsChange,
}: {
  settings: Settings | null;
  onSettingsChange: (settings: Settings) => void;
}) {
  const [availability, setAvailability] = useState<Availability | null>(null);
  const [checking, setChecking] = useState(true);

  const provider = getProvider(settings?.ai.provider ?? 'none');
  const builtin = getProvider('chrome-builtin');

  const check = useCallback(async () => {
    setChecking(true);
    setAvailability(await builtin.availability());
    setChecking(false);
  }, [builtin]);

  useEffect(() => {
    void check();
  }, [check]);

  const patch = async (next: Partial<Settings['ai']>) => {
    const result = await send<Settings>({ type: 'ui:set-settings', patch: { ai: next } });
    if (result.ok) onSettingsChange(result.data);
  };

  const enabled = settings?.ai.enabled ?? false;
  const ready = availability?.state === 'ready';

  return (
    <div className="fw-pane">
      <header className="fw-pane__header">
        <h1 className="fw-pane__title">Writing assistance</h1>
        <p className="fw-pane__subtitle">
          Optional help with the open-ended questions on applications — the ones a resume cannot
          answer. Off by default, and never required.
        </p>
      </header>

      <section className="fw-section">
        <h2 className="fw-section__title">What this can and cannot do</h2>
        <ul className="fw-checklist">
          <li className="fw-check">
            <span className="fw-check__mark fw-check__mark--ok" aria-hidden="true">
              ✓
            </span>
            <span>Draft an answer to a written question, which you then edit and approve</span>
          </li>
          <li className="fw-check">
            <span className="fw-check__mark fw-check__mark--no" aria-hidden="true">
              ✗
            </span>
            <span>
              Decide what any field means — field matching stays entirely deterministic, with or
              without this switched on
            </span>
          </li>
          <li className="fw-check">
            <span className="fw-check__mark fw-check__mark--no" aria-hidden="true">
              ✗
            </span>
            <span>Put anything into a form on its own, or submit anything</span>
          </li>
          <li className="fw-check">
            <span className="fw-check__mark fw-check__mark--no" aria-hidden="true">
              ✗
            </span>
            <span>Send your resume, your profile or the application anywhere</span>
          </li>
        </ul>
      </section>

      <section className="fw-section">
        <h2 className="fw-section__title">On-device model</h2>

        <div className={`fw-availability fw-availability--${availability?.state ?? 'checking'}`}>
          <span className="fw-availability__state">
            {checking && 'Checking this browser…'}
            {!checking && availability?.state === 'ready' && 'Available on this computer'}
            {!checking && availability?.state === 'downloadable' && 'Needs a one-off download'}
            {!checking && availability?.state === 'unavailable' && 'Not available in this browser'}
          </span>
          {!checking && availability && availability.state !== 'ready' && (
            <p className="fw-availability__reason">{availability.reason}</p>
          )}
          {!checking && (
            <button className="fw-btn fw-btn--sm" onClick={() => void check()}>
              Check again
            </button>
          )}
        </div>

        <p className="fw-section__lead">{builtin.dataFlow}</p>

        <div className="fw-notice fw-notice--quiet">
          <strong>Why there is no cloud option.</strong> Fillwright&rsquo;s content security policy
          blocks all outbound network connections, which is what makes &ldquo;your data stays on
          this device&rdquo; something you can verify rather than something we assert. Offering a
          hosted model would mean removing that, so it is not offered at all.
        </div>
      </section>

      <section className="fw-section">
        <h2 className="fw-section__title">Settings</h2>
        <CheckField
          label="Allow writing assistance"
          hint={
            ready
              ? 'You will still review and approve every draft before it goes anywhere near a form.'
              : 'Available once this browser has an on-device model.'
          }
          checked={enabled && ready}
          onChange={(value) =>
            void patch({ enabled: value, provider: value ? 'chrome-builtin' : 'none' })
          }
        />
        {!ready && enabled && (
          <p className="fw-formerror" role="status">
            Assistance is switched on but this browser has no usable model, so nothing will be
            offered.
          </p>
        )}

        <CheckField
          label="Offer to draft answers to written questions"
          hint="Fillwright shows you exactly which facts it would use before drafting anything."
          checked={settings?.ai.assistAnswerDrafting ?? false}
          onChange={(value) => void patch({ assistAnswerDrafting: value })}
        />
      </section>

      <section className="fw-section">
        <h2 className="fw-section__title">Currently</h2>
        <p className="fw-section__lead">
          Provider: <strong>{provider.label}</strong>. {provider.dataFlow}
        </p>
      </section>
    </div>
  );
}
