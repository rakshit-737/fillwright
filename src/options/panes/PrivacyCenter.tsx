import { useCallback, useEffect, useState } from 'react';
import { send } from '@/utils/messaging';
import type { ApplicationHistoryEntry } from '@/types/messages';
import type { SavedMapping } from '@/types/fields';
import type { ProfileSummary } from '@/storage/profiles';

/**
 * A plain-language, verifiable account of what is stored and what leaves the
 * device. Every claim here corresponds to something a reviewer can check in the
 * manifest or the source — there are no "100% secure" style claims.
 */
export function PrivacyCenter() {
  const [profiles, setProfiles] = useState<ProfileSummary[]>([]);
  const [history, setHistory] = useState<ApplicationHistoryEntry[]>([]);
  const [mappings, setMappings] = useState<SavedMapping[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');

  const refresh = useCallback(async () => {
    const [p, h, m] = await Promise.all([
      send<ProfileSummary[]>({ type: 'ui:list-profiles' }),
      send<ApplicationHistoryEntry[]>({ type: 'ui:list-history' }),
      send<SavedMapping[]>({ type: 'ui:list-saved-mappings' }),
    ]);
    if (p.ok) setProfiles(p.data);
    if (h.ok) setHistory(h.data);
    if (m.ok) setMappings(m.data);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const resumeCount = profiles.filter((p) => p.hasResume).length;

  const eraseEverything = async () => {
    const confirmed = window.confirm(
      'Erase every profile, resume, saved mapping and setting stored by Fillwright?\n\n' +
        'This cannot be undone, and Fillwright keeps no copy anywhere else.',
    );
    if (!confirmed) return;
    setBusy(true);
    const result = await send({ type: 'ui:erase-all-data' });
    setBusy(false);
    setNotice(result.ok ? 'All Fillwright data has been erased from this device.' : result.error);
    await refresh();
  };

  const exportData = async () => {
    const result = await send<unknown>({ type: 'ui:export-data' });
    if (!result.ok) {
      setNotice(result.error);
      return;
    }
    // The export is built and downloaded entirely in-page; no upload occurs.
    const blob = new Blob([JSON.stringify(result.data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `fillwright-export-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    setNotice('Export downloaded to this device.');
  };

  return (
    <div className="fw-pane">
      <header className="fw-pane__header">
        <h1 className="fw-pane__title">Privacy Center</h1>
        <p className="fw-pane__subtitle">
          What Fillwright stores, where it stores it, and what you can remove.
        </p>
      </header>

      {notice && (
        <div className="fw-notice" role="status">
          {notice}
        </div>
      )}

      <section className="fw-section">
        <h2 className="fw-section__title">Stored on this device</h2>
        <ul className="fw-datalist">
          <DataRow label="Profiles" value={`${profiles.length}`} detail="IndexedDB (fillwright)" />
          <DataRow label="Resume files" value={`${resumeCount}`} detail="IndexedDB (fillwright)" />
          <DataRow
            label="Site field mappings you taught"
            value={`${mappings.length}`}
            detail="IndexedDB (fillwright)"
          />
          <DataRow
            label="Application history"
            value={history.length === 0 ? 'Off' : `${history.length} entries`}
            detail="Company, role, site and date only — never field values"
          />
          <DataRow label="Settings" value="1 record" detail="chrome.storage.local" />
        </ul>
      </section>

      <section className="fw-section">
        <h2 className="fw-section__title">Where your data goes</h2>
        <p className="fw-section__lead">
          The whole path, end to end. Every step happens inside this browser.
        </p>

        <ol className="fw-flow" aria-label="How your data moves through Fillwright">
          <FlowStep step="1" title="Your resume" detail="A file you choose, read by this page" />
          <FlowStep step="2" title="Local parser" detail="Text extraction and matching, in this browser" />
          <FlowStep step="3" title="Your profile" detail="Stored in this browser’s local database" />
          <FlowStep step="4" title="Field matcher" detail="Compares the form’s labels to a built-in vocabulary" />
          <FlowStep step="5" title="Fill plan" detail="What Fillwright proposes to write" />
          <FlowStep step="6" title="You approve" detail="Nothing is written until you say so" highlight />
          <FlowStep step="7" title="The form" detail="Values are typed into the page you are on" />
          <FlowStep step="8" title="You submit" detail="Always your click — Fillwright never submits" highlight />
        </ol>

        <p className="fw-flow__note">
          There is no step where data leaves this device. No server is involved at any point, not
          even an optional one.
        </p>
      </section>

      <section className="fw-section">
        <h2 className="fw-section__title">Sent off this device</h2>
        <p className="fw-section__lead">
          Nothing. Fillwright ships no analytics, no crash reporting and no remote code, and its
          content security policy restricts network connections to the extension&rsquo;s own files.
          You can verify this in <code>public/manifest.json</code> under{' '}
          <code>content_security_policy</code>.
        </p>
        <ul className="fw-checklist">
          <Check ok>No resume upload</Check>
          <Check ok>No analytics or telemetry</Check>
          <Check ok>No browsing history collection</Check>
          <Check ok>No record of which companies you apply to leaves this device</Check>
          <Check ok>No remotely hosted scripts</Check>
        </ul>
      </section>

      <section className="fw-section">
        <h2 className="fw-section__title">Submitting applications</h2>
        <p className="fw-section__lead">
          Fillwright never clicks Submit or Apply. It fills fields only after you confirm, and the
          final action on any application is always yours.
        </p>
      </section>

      <section className="fw-section">
        <h2 className="fw-section__title">Your data, your call</h2>
        <div className="fw-actions">
          <button className="fw-btn" onClick={exportData} disabled={busy}>
            Export a local copy
          </button>
          <button
            className="fw-btn"
            onClick={async () => {
              await send({ type: 'ui:clear-history' });
              await refresh();
              setNotice('Application history cleared.');
            }}
            disabled={busy || history.length === 0}
          >
            Clear application history
          </button>
          <button className="fw-btn fw-btn--danger" onClick={eraseEverything} disabled={busy}>
            Erase all Fillwright data
          </button>
        </div>
      </section>
    </div>
  );
}

function DataRow({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <li className="fw-datarow">
      <div>
        <span className="fw-datarow__label">{label}</span>
        <span className="fw-datarow__detail">{detail}</span>
      </div>
      <span className="fw-datarow__value">{value}</span>
    </li>
  );
}

function FlowStep({
  step,
  title,
  detail,
  highlight = false,
}: {
  step: string;
  title: string;
  detail: string;
  highlight?: boolean;
}) {
  return (
    <li className={`fw-flow__step${highlight ? ' fw-flow__step--you' : ''}`}>
      <span className="fw-flow__num" aria-hidden="true">
        {step}
      </span>
      <span className="fw-flow__text">
        <span className="fw-flow__title">{title}</span>
        <span className="fw-flow__detail">{detail}</span>
      </span>
    </li>
  );
}

function Check({ children, ok }: { children: React.ReactNode; ok: boolean }) {
  return (
    <li className="fw-check">
      <span className={`fw-check__mark${ok ? ' fw-check__mark--ok' : ''}`} aria-hidden="true">
        ✓
      </span>
      <span>{children}</span>
    </li>
  );
}
