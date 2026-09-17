import { useCallback, useEffect, useRef, useState } from 'react';
import { send } from '@/utils/messaging';
import { describeError, looksTechnical } from '@/utils/errors';
import { ExtractionError, extractResumeText, parseResume, type ParsedResume } from '@/parser';
import { mergeResumeIntoProfile, type MergeChange } from '@/profile/merge';
import { assertNoSensitiveInference } from '@/security/sensitive';
import { newId, now } from '@/profile/factory';
import { getResume, saveResume } from '@/storage/profiles';
import { ConfidenceBadge } from '@/components/ConfidenceBadge';
import type { Candidate } from '@/parser/contact';
import type { Profile, ResumeAttachment } from '@/types/profile';
import type { Settings } from '@/types/settings';

type Stage =
  | { name: 'idle' }
  | { name: 'reading'; fileName: string }
  | { name: 'review'; parsed: ParsedResume; source: SourceInfo }
  | { name: 'saving' }
  | { name: 'done'; changeCount: number }
  | { name: 'error'; message: string };

interface SourceInfo {
  fileName: string;
  mimeType: string;
  bytes: ArrayBuffer | null;
  text: string;
}

/**
 * Resume import.
 *
 * Everything here runs in this page: the file is read with FileReader, parsed by
 * the local parser, and the result is shown for review before a single value is
 * written. The bytes never cross a network boundary, and never even cross the
 * extension's own message bus — they go straight from the file input to
 * IndexedDB on this device.
 */
export function ImportResume({
  settings,
  embedded = false,
  onSaved,
}: {
  settings: Settings | null;
  /** Inside onboarding: no page header, and completion is reported upward. */
  embedded?: boolean;
  onSaved?: () => void;
}) {
  const [stage, setStage] = useState<Stage>({ name: 'idle' });
  const [dragging, setDragging] = useState(false);
  const [pasted, setPasted] = useState('');
  const [strategy, setStrategy] = useState<'fill-gaps' | 'replace'>('fill-gaps');
  const [existingResume, setExistingResume] = useState<ResumeAttachment | null>(null);
  const [attachmentWarning, setAttachmentWarning] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);

  const profileId = settings?.activeProfileId ?? null;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!profileId) return;
      const result = await send<Profile>({ type: 'ui:get-profile', profileId });
      if (!result.ok || cancelled) return;
      const resumeId = result.data.resumeIds[result.data.resumeIds.length - 1];
      if (!resumeId) {
        setExistingResume(null);
        return;
      }
      // Best effort: a locked vault or a storage hiccup only hides the notice.
      const attachment = await getResume(resumeId).catch(() => undefined);
      if (!cancelled) setExistingResume(attachment ?? null);
    })();
    return () => {
      cancelled = true;
    };
  }, [profileId, stage.name]);

  // Onboarding moves on once the profile is saved.
  useEffect(() => {
    if (stage.name === 'done') onSaved?.();
  }, [stage.name, onSaved]);

  const handleText = useCallback((text: string, source: SourceInfo) => {
    try {
      const parsed = parseResume(text);
      // Defence in depth: fail loudly if the parser ever starts producing
      // sensitive fields, rather than letting them flow into the profile.
      assertNoSensitiveInference(parsed);
      setStage({ name: 'review', parsed, source });
    } catch {
      setStage({
        name: 'error',
        message:
          'Fillwright couldn’t read that text as a resume. Nothing was saved. Check it’s the full resume, or try the original file.',
      });
    }
  }, []);

  const handleFile = useCallback(
    async (file: File) => {
      setAttachmentWarning('');
      setStage({ name: 'reading', fileName: file.name });
      try {
        const bytes = await file.arrayBuffer();
        const extracted = await extractResumeText(bytes, file.name);
        handleText(extracted.text, {
          fileName: file.name,
          mimeType: file.type || 'application/octet-stream',
          bytes,
          text: extracted.text,
        });
      } catch (cause) {
        const message =
          cause instanceof ExtractionError
            ? cause.message
            : 'This file could not be read. Try a PDF, DOCX or plain text file, or paste the text.';
        setStage({ name: 'error', message });
      }
    },
    [handleText],
  );

  const onDrop = (event: React.DragEvent) => {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer.files[0];
    if (file) void handleFile(file);
  };

  /**
   * Saves the reviewed profile.
   *
   * Wrapped end to end: without this, any unexpected throw left the pane on
   * "Saving to your profile…" forever, with no message and no way out. An
   * infinite spinner is the worst possible failure report — the user cannot
   * tell whether it is working, stuck, or has lost their data.
   */
  const apply = async () => {
    if (stage.name !== 'review' || !profileId) return;
    const source = stage.source;
    const parsed = stage.parsed;
    setStage({ name: 'saving' });

    try {
      const current = await send<Profile>({ type: 'ui:get-profile', profileId });
      if (!current.ok) {
        setStage({ name: 'error', message: describeSaveFailure(current.error, current.code) });
        return;
      }

      const { profile, changes } = mergeResumeIntoProfile(current.data, parsed, { strategy });

      // Store the original file so it can be re-attached to applications later.
      // The parsed text is already safe in `parsed`, so a failure here costs the
      // attachment but not the import.
      if (source.bytes) {
        try {
          const attachment: ResumeAttachment = {
            id: newId('res'),
            fileName: source.fileName,
            mimeType: source.mimeType,
            sizeBytes: source.bytes.byteLength,
            importedAt: now(),
            data: source.bytes,
            text: source.text,
          };
          await saveResume(attachment);
          profile.resumeIds = [...profile.resumeIds, attachment.id];
        } catch (cause) {
          // Keep going: the profile is the valuable part, and losing it because
          // the file copy failed would be a far worse outcome.
          setAttachmentWarning(describeAttachmentFailure(cause));
        }
      }

      const saved = await send<Profile>({ type: 'ui:save-profile', profile });
      if (!saved.ok) {
        setStage({ name: 'error', message: describeSaveFailure(saved.error, saved.code) });
        return;
      }
      setStage({ name: 'done', changeCount: changes.length });
    } catch (cause) {
      setStage({ name: 'error', message: describeSaveFailure(cause) });
    }
  };

  if (!profileId) {
    return (
      <div className="fw-pane">
        <h1 className="fw-pane__title">Resume</h1>
        <p className="fw-muted">Create a profile first, then import a resume into it.</p>
      </div>
    );
  }

  return (
    <div className={embedded ? 'fw-embedded' : 'fw-pane'}>
      {!embedded && (
        <header className="fw-pane__header">
          <h1 className="fw-pane__title">Resume</h1>
          <p className="fw-pane__subtitle">
            Fillwright reads your resume on this device and turns it into a profile you can edit.
            The file is not uploaded anywhere.
          </p>
        </header>
      )}

      {existingResume && stage.name === 'idle' && (
        <div className="fw-notice" role="status">
          Currently imported: <strong>{existingResume.fileName}</strong> (
          {formatBytes(existingResume.sizeBytes)}, added{' '}
          {new Date(existingResume.importedAt).toLocaleDateString()}). Importing another resume adds
          to this profile rather than replacing what you have edited.
        </div>
      )}

      {stage.name === 'error' && (
        <div className="fw-notice fw-notice--danger" role="alert">
          {stage.message}
          <button className="fw-btn fw-btn--sm" onClick={() => setStage({ name: 'idle' })}>
            Try again
          </button>
        </div>
      )}

      {(stage.name === 'idle' || stage.name === 'error') && (
        <>
          <div
            className={`fw-drop${dragging ? ' fw-drop--active' : ''}`}
            onDragOver={(event) => {
              event.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
          >
            <svg
              viewBox="0 0 24 24"
              width="28"
              height="28"
              aria-hidden="true"
              className="fw-drop__icon"
            >
              <path
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 16V4m0 0L8 8m4-4 4 4M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"
              />
            </svg>
            <p className="fw-drop__title">Drop your resume here</p>
            <p className="fw-drop__hint">PDF, DOCX or TXT — up to 15 MB</p>
            <button className="fw-btn fw-btn--primary" onClick={() => fileInput.current?.click()}>
              Choose a file
            </button>
            <input
              ref={fileInput}
              type="file"
              // The "Choose a file" button is the control; this input is its
              // implementation, so it is labelled and kept out of the tab order.
              aria-label="Resume file"
              tabIndex={-1}
              className="fw-sr-only"
              accept=".pdf,.docx,.txt,.md,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void handleFile(file);
                event.target.value = '';
              }}
            />
          </div>

          <section className="fw-section">
            <h2 className="fw-section__title">Or paste the text</h2>
            <textarea
              className="fw-textarea"
              rows={8}
              value={pasted}
              placeholder="Paste your resume text here…"
              onChange={(event) => setPasted(event.target.value)}
              aria-label="Resume text"
            />
            <button
              className="fw-btn"
              disabled={pasted.trim().length < 40}
              onClick={() =>
                handleText(pasted, {
                  fileName: 'Pasted text',
                  mimeType: 'text/plain',
                  bytes: null,
                  text: pasted,
                })
              }
            >
              Read pasted text
            </button>
          </section>
        </>
      )}

      {stage.name === 'reading' && (
        <div className="fw-drop fw-drop--busy" role="status" aria-live="polite">
          <span className="fw-spinner" aria-hidden="true" />
          <p className="fw-drop__title">Reading {stage.fileName}…</p>
          <p className="fw-drop__hint">This happens on your device.</p>
        </div>
      )}

      {stage.name === 'saving' && (
        <div className="fw-drop fw-drop--busy" role="status" aria-live="polite">
          <span className="fw-spinner" aria-hidden="true" />
          <p className="fw-drop__title">Saving to your profile…</p>
        </div>
      )}

      {stage.name === 'done' && !embedded && (
        <div className="fw-notice" role="status">
          <strong>Profile updated.</strong> {stage.changeCount} field
          {stage.changeCount === 1 ? '' : 's'} written. Review everything on the Profile page —
          nothing is used to fill a form until you say so.
          {attachmentWarning && <p className="fw-field__hint">{attachmentWarning}</p>}
          <div className="fw-actions">
            <button
              className="fw-btn fw-btn--primary"
              onClick={() => (location.hash = '#/profile')}
            >
              Review my profile
            </button>
            <button className="fw-btn" onClick={() => setStage({ name: 'idle' })}>
              Import another
            </button>
          </div>
        </div>
      )}

      {stage.name === 'review' && (
        <ReviewParsed
          parsed={stage.parsed}
          fileName={stage.source.fileName}
          strategy={strategy}
          onStrategyChange={setStrategy}
          onApply={apply}
          onCancel={() => setStage({ name: 'idle' })}
        />
      )}
    </div>
  );
}

function ReviewParsed({
  parsed,
  fileName,
  strategy,
  onStrategyChange,
  onApply,
  onCancel,
}: {
  parsed: ParsedResume;
  fileName: string;
  strategy: 'fill-gaps' | 'replace';
  onStrategyChange: (value: 'fill-gaps' | 'replace') => void;
  onApply: () => void;
  onCancel: () => void;
}) {
  const { contact } = parsed;
  const rows: Array<{ label: string; candidate: Candidate }> = [
    { label: 'Name', candidate: contact.fullName },
    { label: 'Email', candidate: contact.email },
    { label: 'Phone', candidate: contact.phone },
    { label: 'Location', candidate: contact.location },
    { label: 'LinkedIn', candidate: contact.links.linkedin },
    { label: 'GitHub', candidate: contact.links.github },
    { label: 'Portfolio', candidate: contact.links.portfolio },
  ].filter((row) => row.candidate.value);

  return (
    <div className="fw-review">
      <header className="fw-review__head">
        <div>
          <h2 className="fw-section__title">Here is what Fillwright read</h2>
          <p className="fw-muted">
            From <strong>{fileName}</strong>. Nothing has been saved yet.
          </p>
        </div>
        <span className={`fw-tag${parsed.coverage >= 0.8 ? '' : ' fw-tag--muted'}`}>
          {Math.round(parsed.coverage * 100)}% recognised
        </span>
      </header>

      {parsed.warnings.length > 0 && (
        <ul className="fw-warnlist">
          {parsed.warnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      )}

      <table className="fw-table">
        <caption className="fw-sr-only">Values read from your resume</caption>
        <thead>
          <tr>
            <th scope="col">Field</th>
            <th scope="col">Value</th>
            <th scope="col">Confidence</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ label, candidate }) => (
            <tr key={label}>
              <th scope="row">{label}</th>
              <td className="fw-table__value" title={candidate.note}>
                {candidate.value}
              </td>
              <td>
                <ConfidenceBadge confidence={candidate.confidence} compact />
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <ul className="fw-countlist">
        <CountRow
          label="Education"
          count={parsed.education.length}
          sample={parsed.education[0]?.institution}
        />
        <CountRow
          label="Experience"
          count={parsed.experience.length}
          sample={parsed.experience[0]?.company}
        />
        <CountRow
          label="Projects"
          count={parsed.projects.length}
          sample={parsed.projects[0]?.name}
        />
        <CountRow
          label="Skills"
          count={parsed.skills.length}
          sample={parsed.skills
            .slice(0, 4)
            .map((s) => s.name)
            .join(', ')}
        />
        <CountRow
          label="Certifications"
          count={parsed.certifications.length}
          sample={parsed.certifications[0]?.name}
        />
        <CountRow
          label="Achievements"
          count={parsed.achievements.length}
          sample={parsed.achievements[0]?.title}
        />
        <CountRow
          label="Languages"
          count={parsed.languages.length}
          sample={parsed.languages.map((l) => l.name).join(', ')}
        />
      </ul>

      <div className="fw-notice fw-notice--quiet">
        Work authorisation, visa status, demographics and salary are never read from a resume. You
        can set those yourself under Application preferences, and Fillwright will only use what you
        enter there.
      </div>

      <fieldset className="fw-fieldset">
        <legend className="fw-field__label">If a field already has a value</legend>
        <div className="fw-radiorow">
          <label className="fw-radio">
            <input
              type="radio"
              name="merge-strategy"
              checked={strategy === 'fill-gaps'}
              onChange={() => onStrategyChange('fill-gaps')}
            />
            <span>Keep what I have, fill the gaps</span>
          </label>
          <label className="fw-radio">
            <input
              type="radio"
              name="merge-strategy"
              checked={strategy === 'replace'}
              onChange={() => onStrategyChange('replace')}
            />
            <span>Replace with the resume version</span>
          </label>
        </div>
        <span className="fw-field__hint">Either way, anything you typed by hand is kept.</span>
      </fieldset>

      <div className="fw-actions">
        <button className="fw-btn fw-btn--primary" onClick={onApply}>
          Save to my profile
        </button>
        <button className="fw-btn" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function CountRow({ label, count, sample }: { label: string; count: number; sample?: string }) {
  return (
    <li className={`fw-countrow${count === 0 ? ' fw-countrow--empty' : ''}`}>
      <span className="fw-countrow__count">{count}</span>
      <span className="fw-countrow__label">{label}</span>
      {sample && <span className="fw-countrow__sample">{sample}</span>}
    </li>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export type { MergeChange };

/**
 * Turns a failure into something a person can act on.
 *
 * "Something went wrong" tells the user nothing and leaves them guessing
 * whether to retry, change the file, or give up.
 */
function describeSaveFailure(cause: unknown, code?: string): string {
  const message = cause instanceof Error ? cause.message : String(cause ?? '');
  if (code === 'ELOCKED')
    return 'Fillwright is locked. Unlock it under Security, then import again.';
  if (code === 'EQUOTA') return describeError('EQUOTA').message;

  if (/detached/i.test(message)) {
    return 'The file could not be read a second time. Please choose it again and retry.';
  }
  if (/ELOCKED/i.test(message) || /locked/i.test(message)) {
    return 'Fillwright is locked. Unlock it under Security, then import again.';
  }
  if (/quota|QuotaExceeded/i.test(message)) {
    return 'This browser is out of storage space for extensions. Remove an old resume under Privacy Center and try again.';
  }
  if (/receiving end|message port|Extension context/i.test(message)) {
    return 'Fillwright’s background service restarted while saving. Please try again — nothing was lost.';
  }
  if (/timed out/i.test(message)) {
    return 'Saving took too long and was stopped. Please try again.';
  }
  return message && !looksTechnical(message)
    ? `Your profile could not be saved. ${message}`
    : 'Your profile could not be saved. Please try again — nothing was lost.';
}

/** A failed file copy is recoverable: the parsed profile is unaffected. */
function describeAttachmentFailure(cause: unknown): string {
  const message = cause instanceof Error ? cause.message : String(cause ?? '');
  if (/detached/i.test(message)) {
    return 'Your details were saved, but the original file could not be kept. Re-import it if you want a copy stored.';
  }
  if (/quota/i.test(message)) {
    return 'Your details were saved, but there was not enough storage to keep a copy of the file.';
  }
  return 'Your details were saved, but the original file could not be kept.';
}
