import { useCallback, useEffect, useRef, useState } from 'react';
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
  const [includeHistory, setIncludeHistory] = useState(false);
  const [historyLocked, setHistoryLocked] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    const [p, h, m] = await Promise.all([
      send<ProfileSummary[]>({ type: 'ui:list-profiles' }),
      send<ApplicationHistoryEntry[]>({ type: 'ui:list-history' }),
      send<SavedMapping[]>({ type: 'ui:list-saved-mappings' }),
    ]);
    if (p.ok) setProfiles(p.data);
    if (h.ok) setHistory(h.data);
    if (m.ok) setMappings(m.data);
    // Locked history is expected, not a failure: it is encrypted and says so below.
    setHistoryLocked(!h.ok && h.code === 'ELOCKED');
    const failed = [p, h, m].find((result) => !result.ok && result.code !== 'ELOCKED');
    if (failed && !failed.ok) {
      setNotice(
        `Some of these numbers couldn’t be loaded, so they may be out of date. ${failed.error}`,
      );
    }
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
    setNotice(
      result.ok
        ? 'All Fillwright data has been erased from this device.'
        : `Nothing was erased. ${result.error}`,
    );
    await refresh();
  };

  const exportData = async () => {
    const confirmed = window.confirm(
      'This file contains sensitive personal information — your profile, including any ' +
        'work-authorization and demographic answers you saved.\n\n' +
        'It is not encrypted. Store it somewhere only you can reach, and delete it when you no ' +
        'longer need it.\n\nSave the export?',
    );
    if (!confirmed) return;
    const result = await send<unknown>({ type: 'ui:export-data', includeHistory });
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
    setNotice('Export saved to this device. It is not encrypted — keep it somewhere private.');
  };

  /**
   * Import reads the file in this page and hands the parsed JSON to the
   * worker, which rebuilds every record against the schema before storing it.
   * Existing profiles are never replaced; imported ones are added alongside.
   */
  const importData = async (file: File) => {
    if (file.size > 20 * 1024 * 1024) {
      setNotice('That file is too large to be a Fillwright export.');
      return;
    }
    let payload: unknown;
    try {
      payload = JSON.parse(await file.text());
    } catch {
      setNotice('That file is not valid JSON, so nothing was imported.');
      return;
    }
    setBusy(true);
    const result = await send<{
      profiles: number;
      mappings: number;
      settings: boolean;
      history: number;
      warnings: string[];
    }>({ type: 'ui:import-data', payload }, { timeoutMs: 60_000 });
    setBusy(false);
    if (!result.ok) {
      setNotice(
        result.code === 'ELOCKED'
          ? 'Fillwright is locked. Unlock it under Security, then import again.'
          : result.code === 'EQUOTA'
            ? result.error
            : `Nothing was imported. ${result.error}`,
      );
      return;
    }
    const { profiles: added, mappings: learned, settings, history: logged, warnings } = result.data;
    const parts = [
      `${added} profile${added === 1 ? '' : 's'}`,
      `${learned} learned field${learned === 1 ? '' : 's'}`,
      settings ? 'your settings' : '',
      logged ? `${logged} history entries` : '',
    ].filter(Boolean);
    setNotice(`Imported ${parts.join(', ')}. ${warnings.join(' ')}`.trim());
    await refresh();
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
            value={
              historyLocked ? 'Locked' : history.length === 0 ? 'Off' : `${history.length} entries`
            }
            detail={
              'Company, role, site, date and a fill count, plus what you add yourself: status, ' +
              'notes, a follow-up date, the profile used and — only if you tick it — the ' +
              'posting link without its query string. Never field values. Encrypted when ' +
              'encryption is on.'
            }
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
          <FlowStep
            step="2"
            title="Local parser"
            detail="Text extraction and matching, in this browser"
          />
          <FlowStep
            step="3"
            title="Your profile"
            detail="Stored in this browser’s local database"
          />
          <FlowStep
            step="4"
            title="Field matcher"
            detail="Compares the form’s labels to a built-in vocabulary"
          />
          <FlowStep step="5" title="Fill plan" detail="What Fillwright proposes to write" />
          <FlowStep
            step="6"
            title="You approve"
            detail="Nothing is written until you say so"
            highlight
          />
          <FlowStep step="7" title="The form" detail="Values are typed into the page you are on" />
          <FlowStep
            step="8"
            title="You submit"
            detail="Always your click — Fillwright never submits"
            highlight
          />
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
        <p className="fw-section__lead">
          An export is a JSON file saved to your computer. It holds your profiles, what Fillwright
          has learned and your settings — resume files are left out. It is not encrypted, so treat
          it like the resume itself.
        </p>
        <label className="fw-field fw-field--toggle">
          <input
            type="checkbox"
            checked={includeHistory}
            onChange={(event) => setIncludeHistory(event.target.checked)}
          />
          <span>
            <span className="fw-field__label">Include application history</span>
            <span className="fw-field__hint">
              Off by default. Includes your status, notes, follow-up dates and saved links.
            </span>
          </span>
        </label>
        <div className="fw-actions">
          <button className="fw-btn" onClick={exportData} disabled={busy}>
            Export a local copy
          </button>
          <button className="fw-btn" onClick={() => fileInput.current?.click()} disabled={busy}>
            Import from a file
          </button>
          <input
            ref={fileInput}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = '';
              if (file) void importData(file);
            }}
          />
          <button
            className="fw-btn"
            onClick={async () => {
              if (!window.confirm('Clear your application history? This cannot be undone.')) return;
              const result = await send({ type: 'ui:clear-history' });
              await refresh();
              setNotice(
                result.ok
                  ? 'Application history cleared.'
                  : `History wasn’t cleared. ${result.error}`,
              );
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
