import { useCallback, useEffect, useRef, useState } from 'react';
import { send } from '@/utils/messaging';
import { passphraseStrength } from '@/security/crypto';
import {
  decryptExport,
  encryptExport,
  isEncryptedExport,
  type ImportPreview,
  type ImportSelection,
} from '@/profile/portable';
import { ImportReview } from './ImportReview';
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
  const [protect, setProtect] = useState(false);
  const [exportPass, setExportPass] = useState('');
  const [exportConfirm, setExportConfirm] = useState('');
  /** An import in progress: the parsed file, and what the worker made of it. */
  const [pending, setPending] = useState<{
    payload: unknown;
    locked: boolean;
    preview: ImportPreview | null;
  } | null>(null);
  const [importPass, setImportPass] = useState('');
  const [importError, setImportError] = useState('');
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

  const strength = passphraseStrength(exportPass);
  const exportData = async () => {
    if (protect) {
      if (strength.score < 2) {
        setNotice(`Choose a longer passphrase. ${strength.hint}`);
        return;
      }
      if (exportPass !== exportConfirm) {
        setNotice('The two passphrases do not match.');
        return;
      }
    } else {
      const confirmed = window.confirm(
        'This file contains sensitive personal information — your profile, including any ' +
          'work-authorization and demographic answers you saved.\n\n' +
          'It is not encrypted. Store it somewhere only you can reach, and delete it when you no ' +
          'longer need it.\n\nSave the export?',
      );
      if (!confirmed) return;
    }
    const result = await send<unknown>({ type: 'ui:export-data', includeHistory });
    if (!result.ok) {
      setNotice(result.error);
      return;
    }
    let body: unknown = result.data;
    if (protect) {
      setBusy(true);
      try {
        // Sealed in this page with the vault's scheme; the passphrase is not stored.
        body = await encryptExport(result.data, exportPass);
      } finally {
        setBusy(false);
      }
      setExportPass('');
      setExportConfirm('');
    }
    // The export is built and downloaded entirely in-page; no upload occurs.
    const blob = new Blob([JSON.stringify(body, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `fillwright-export-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    setNotice(
      protect
        ? 'Export saved to this device, protected with your passphrase. Without it the file cannot be opened.'
        : 'Export saved to this device. It is not encrypted — keep it somewhere private.',
    );
  };

  /**
   * Import is two steps. The file is read in this page (and opened here if it
   * is passphrase-protected); the worker rebuilds every record and returns a
   * preview; the user ticks what to keep; only then is anything stored.
   */
  const readImport = async (file: File) => {
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
    setNotice('');
    setImportError('');
    setImportPass('');
    if (isEncryptedExport(payload)) {
      setPending({ payload, locked: true, preview: null });
      return;
    }
    await previewFile(payload);
  };

  const previewFile = async (payload: unknown) => {
    setBusy(true);
    const result = await send<ImportPreview>(
      { type: 'ui:preview-import', payload },
      { timeoutMs: 60_000 },
    );
    setBusy(false);
    if (!result.ok) {
      setPending(null);
      setNotice(`Nothing was imported. ${result.error}`);
      return;
    }
    setPending({ payload, locked: false, preview: result.data });
  };

  const unlockImport = async () => {
    if (!pending) return;
    setBusy(true);
    setImportError('');
    let opened: unknown;
    try {
      opened = await decryptExport(pending.payload, importPass);
    } catch (cause) {
      setBusy(false);
      setImportError(cause instanceof Error ? cause.message : 'This file could not be opened.');
      return;
    }
    setBusy(false);
    setImportPass('');
    await previewFile(opened);
  };

  const importData = async (selection: ImportSelection) => {
    if (!pending) return;
    setBusy(true);
    const result = await send<{
      profiles: number;
      mappings: number;
      settings: boolean;
      history: number;
      warnings: string[];
    }>({ type: 'ui:import-data', payload: pending.payload, selection }, { timeoutMs: 60_000 });
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
    setPending(null);
    const { profiles: added, mappings: learned, settings, history: logged, warnings } = result.data;
    const parts = [
      `${added} profile${added === 1 ? '' : 's'}`,
      `${learned} learned field${learned === 1 ? '' : 's'}`,
      settings ? 'the settings you chose' : '',
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
          has learned and your settings — resume files are left out. Protect it with a passphrase,
          or treat it like the resume itself. An import is shown to you for review before anything
          is saved.
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
        <label className="fw-field fw-field--toggle">
          <input
            type="checkbox"
            checked={protect}
            onChange={(event) => setProtect(event.target.checked)}
          />
          <span>
            <span className="fw-field__label">Protect the export with a passphrase</span>
            <span className="fw-field__hint">
              Encrypted with AES-GCM using a key derived from your passphrase (PBKDF2, 600,000
              rounds). Forget it and the file cannot be opened.
            </span>
          </span>
        </label>
        {protect && (
          <div className="fw-export-pass">
            <label className="fw-tf">
              <span className="fw-tf__label">Export passphrase</span>
              <input
                className="fw-input"
                type="password"
                autoComplete="new-password"
                spellCheck={false}
                value={exportPass}
                onChange={(event) => setExportPass(event.target.value)}
              />
            </label>
            {exportPass && (
              <p className="fw-field__hint" aria-live="polite">
                {strength.label} — {strength.hint}
              </p>
            )}
            <label className="fw-tf">
              <span className="fw-tf__label">Confirm export passphrase</span>
              <input
                className="fw-input"
                type="password"
                autoComplete="new-password"
                spellCheck={false}
                value={exportConfirm}
                onChange={(event) => setExportConfirm(event.target.value)}
              />
            </label>
          </div>
        )}
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
              if (file) void readImport(file);
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

      {pending?.locked && (
        <section className="fw-section" aria-labelledby="fw-import-unlock-title">
          <h2 className="fw-section__title" id="fw-import-unlock-title">
            This export is protected
          </h2>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void unlockImport();
            }}
          >
            <label className="fw-tf">
              <span className="fw-tf__label">Passphrase for this file</span>
              <input
                className="fw-input"
                type="password"
                autoComplete="off"
                spellCheck={false}
                autoFocus
                value={importPass}
                onChange={(event) => setImportPass(event.target.value)}
              />
            </label>
            {importError && (
              <p className="fw-formerror" role="alert">
                {importError}
              </p>
            )}
            <div className="fw-actions">
              <button
                className="fw-btn fw-btn--primary"
                type="submit"
                disabled={busy || !importPass}
              >
                Open file
              </button>
              <button className="fw-btn" type="button" onClick={() => setPending(null)}>
                Cancel
              </button>
            </div>
          </form>
        </section>
      )}

      {pending?.preview && (
        <ImportReview
          preview={pending.preview}
          busy={busy}
          onImport={(selection) => void importData(selection)}
          onCancel={() => {
            setPending(null);
            setNotice('Import cancelled. Nothing was saved.');
          }}
        />
      )}
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
