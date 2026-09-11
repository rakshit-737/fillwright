import { useCallback, useEffect, useState } from 'react';
import { send } from '@/utils/messaging';
import { passphraseStrength } from '@/security/crypto';
import type { Settings } from '@/types/settings';

interface VaultState {
  state: 'off' | 'locked' | 'unlocked';
  autoLockMinutes: number;
  createdAt: string | null;
  iterations: number | null;
}

type Mode = 'idle' | 'enabling' | 'unlocking' | 'changing' | 'disabling';

const AUTO_LOCK_CHOICES: Array<[number, string]> = [
  [5, 'After 5 minutes'],
  [15, 'After 15 minutes'],
  [30, 'After 30 minutes'],
  [60, 'After 1 hour'],
  [0, 'Never'],
];

/**
 * Encryption at rest.
 *
 * The copy here is as important as the code. Encryption is easy to oversell,
 * and a user who believes it protects more than it does will make worse
 * decisions than one who was told the truth — so this says exactly what the
 * feature does and, prominently, what it does not.
 */
export function Security({
  settings,
  onSettingsChange,
}: {
  settings: Settings | null;
  onSettingsChange: (settings: Settings) => void;
}) {
  const [vault, setVault] = useState<VaultState | null>(null);
  const [mode, setMode] = useState<Mode>('idle');
  const [passphrase, setPassphrase] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [nextPassphrase, setNextPassphrase] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const refresh = useCallback(async () => {
    const result = await send<VaultState>({ type: 'ui:vault-status' });
    if (result.ok) setVault(result.data);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const reset = () => {
    setMode('idle');
    setPassphrase('');
    setConfirmation('');
    setNextPassphrase('');
    setError('');
  };

  const strength = passphraseStrength(mode === 'changing' ? nextPassphrase : passphrase);

  const enable = async () => {
    if (passphrase !== confirmation) {
      setError('The two passphrases do not match.');
      return;
    }
    if (strength.score < 1) {
      setError(strength.hint);
      return;
    }
    setBusy(true);
    setError('');
    const result = await send({ type: 'ui:vault-enable', passphrase });
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    reset();
    await refresh();
    await syncSettings(onSettingsChange);
    setNotice('Encryption is on. Your profile and resume are now stored encrypted.');
  };

  const unlock = async () => {
    setBusy(true);
    setError('');
    const result = await send({ type: 'ui:vault-unlock', passphrase });
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    reset();
    await refresh();
    setNotice('Unlocked.');
  };

  const lockNow = async () => {
    await send({ type: 'ui:vault-lock' });
    await refresh();
    setNotice('Locked. Your passphrase is needed to use Fillwright again.');
  };

  const change = async () => {
    if (nextPassphrase !== confirmation) {
      setError('The two new passphrases do not match.');
      return;
    }
    setBusy(true);
    setError('');
    const result = await send({
      type: 'ui:vault-change-passphrase',
      current: passphrase,
      next: nextPassphrase,
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    reset();
    await refresh();
    setNotice('Passphrase changed. Everything was re-encrypted with the new one.');
  };

  const disable = async () => {
    const confirmed = window.confirm(
      'Turn encryption off?\n\n' +
        'Your profile and resume will be stored unencrypted on this device again.',
    );
    if (!confirmed) return;

    setBusy(true);
    setError('');
    const result = await send({ type: 'ui:vault-disable', passphrase });
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    reset();
    await refresh();
    await syncSettings(onSettingsChange);
    setNotice('Encryption is off.');
  };

  const setAutoLock = async (minutes: number) => {
    const result = await send<Settings>({
      type: 'ui:set-settings',
      patch: { privacy: { autoLockMinutes: minutes } },
    });
    if (result.ok) {
      onSettingsChange(result.data);
      await refresh();
    }
  };

  if (!vault) {
    return (
      <div className="fw-pane" role="status">
        <span className="fw-spinner" aria-hidden="true" /> <span className="fw-muted">Loading…</span>
      </div>
    );
  }

  return (
    <div className="fw-pane">
      <header className="fw-pane__header">
        <h1 className="fw-pane__title">Security</h1>
        <p className="fw-pane__subtitle">
          Encrypt your profile and resume where they are stored on this device.
        </p>
      </header>

      {notice && (
        <div className="fw-notice" role="status">
          {notice}
        </div>
      )}

      <section className={`fw-vault fw-vault--${vault.state}`}>
        <div className="fw-vault__head">
          <span className={`fw-vault__dot fw-vault__dot--${vault.state}`} aria-hidden="true" />
          <div>
            <h2 className="fw-vault__state">
              {vault.state === 'off' && 'Encryption is off'}
              {vault.state === 'locked' && 'Locked'}
              {vault.state === 'unlocked' && 'Unlocked'}
            </h2>
            <p className="fw-vault__detail">
              {vault.state === 'off' &&
                'Your profile is stored unencrypted in this browser’s local database.'}
              {vault.state === 'locked' &&
                'Fillwright cannot read your profile or fill forms until you unlock it.'}
              {vault.state === 'unlocked' &&
                'Your profile is encrypted at rest and readable while this browser stays open.'}
            </p>
          </div>
        </div>
      </section>

      {/* ------------------------------------------------- honest scope --- */}
      <section className="fw-section">
        <h2 className="fw-section__title">What this does, and what it does not</h2>
        <div className="fw-scope">
          <div>
            <h3 className="fw-scope__title fw-scope__title--does">It does</h3>
            <ul className="fw-checklist">
              <Check ok>
                Encrypt your profile and stored resume with AES-256-GCM, so the browser’s database
                file is not readable on its own
              </Check>
              <Check ok>
                Derive the key from your passphrase with PBKDF2-SHA256
                {vault.iterations ? ` (${vault.iterations.toLocaleString()} iterations)` : ''}, which
                makes guessing it slow
              </Check>
              <Check ok>Require the passphrase again after the browser closes</Check>
            </ul>
          </div>
          <div>
            <h3 className="fw-scope__title fw-scope__title--not">It does not</h3>
            <ul className="fw-checklist">
              <Check ok={false}>
                Protect against software running on this computer as you while the vault is unlocked
              </Check>
              <Check ok={false}>
                Guarantee that decrypted values are erased from memory — JavaScript cannot promise
                that, and we will not claim it
              </Check>
              <Check ok={false}>
                Encrypt your settings, application history or remembered field mappings — those hold
                no resume content
              </Check>
            </ul>
          </div>
        </div>
        <p className="fw-note">
          If you forget the passphrase there is no recovery. Nothing is stored anywhere that could
          reset it, which is the point — but it does mean the only copy is the one you remember.
        </p>
      </section>

      {/* ----------------------------------------------------- controls --- */}

      {vault.state === 'off' && mode !== 'enabling' && (
        <div className="fw-actions">
          <button className="fw-btn fw-btn--primary" onClick={() => setMode('enabling')}>
            Turn on encryption
          </button>
        </div>
      )}

      {mode === 'enabling' && (
        <section className="fw-section">
          <h2 className="fw-section__title">Choose a passphrase</h2>
          <PassphraseField
            label="Passphrase"
            value={passphrase}
            onChange={setPassphrase}
            autoFocus
          />
          <StrengthMeter strength={strength} show={passphrase.length > 0} />
          <PassphraseField label="Confirm passphrase" value={confirmation} onChange={setConfirmation} />
          {error && <p className="fw-formerror" role="alert">{error}</p>}
          <div className="fw-actions">
            <button className="fw-btn fw-btn--primary" disabled={busy} onClick={() => void enable()}>
              {busy ? 'Encrypting…' : 'Turn on encryption'}
            </button>
            <button className="fw-btn" disabled={busy} onClick={reset}>
              Cancel
            </button>
          </div>
        </section>
      )}

      {vault.state === 'locked' && (
        <section className="fw-section">
          <h2 className="fw-section__title">Unlock</h2>
          <PassphraseField label="Passphrase" value={passphrase} onChange={setPassphrase} autoFocus />
          {error && <p className="fw-formerror" role="alert">{error}</p>}
          <div className="fw-actions">
            <button className="fw-btn fw-btn--primary" disabled={busy} onClick={() => void unlock()}>
              {busy ? 'Unlocking…' : 'Unlock'}
            </button>
          </div>
        </section>
      )}

      {vault.state === 'unlocked' && (
        <>
          <section className="fw-section">
            <h2 className="fw-section__title">Lock automatically</h2>
            <p className="fw-field__hint">
              Checked whenever Fillwright is used, so an idle browser does not stay unlocked.
            </p>
            <div className="fw-radiorow">
              {AUTO_LOCK_CHOICES.map(([minutes, label]) => (
                <label className="fw-radio" key={minutes}>
                  <input
                    type="radio"
                    name="auto-lock"
                    checked={(settings?.privacy.autoLockMinutes ?? 30) === minutes}
                    onChange={() => void setAutoLock(minutes)}
                  />
                  <span>{label}</span>
                </label>
              ))}
            </div>
          </section>

          {mode === 'changing' ? (
            <section className="fw-section">
              <h2 className="fw-section__title">Change passphrase</h2>
              <PassphraseField
                label="Current passphrase"
                value={passphrase}
                onChange={setPassphrase}
                autoFocus
              />
              <PassphraseField
                label="New passphrase"
                value={nextPassphrase}
                onChange={setNextPassphrase}
              />
              <StrengthMeter strength={strength} show={nextPassphrase.length > 0} />
              <PassphraseField
                label="Confirm new passphrase"
                value={confirmation}
                onChange={setConfirmation}
              />
              {error && <p className="fw-formerror" role="alert">{error}</p>}
              <div className="fw-actions">
                <button className="fw-btn fw-btn--primary" disabled={busy} onClick={() => void change()}>
                  {busy ? 'Re-encrypting…' : 'Change passphrase'}
                </button>
                <button className="fw-btn" disabled={busy} onClick={reset}>
                  Cancel
                </button>
              </div>
            </section>
          ) : mode === 'disabling' ? (
            <section className="fw-section">
              <h2 className="fw-section__title">Turn off encryption</h2>
              <p className="fw-field__hint">
                Confirm with your passphrase. Your data will be rewritten unencrypted.
              </p>
              <PassphraseField label="Passphrase" value={passphrase} onChange={setPassphrase} autoFocus />
              {error && <p className="fw-formerror" role="alert">{error}</p>}
              <div className="fw-actions">
                <button className="fw-btn fw-btn--danger" disabled={busy} onClick={() => void disable()}>
                  {busy ? 'Decrypting…' : 'Turn off encryption'}
                </button>
                <button className="fw-btn" disabled={busy} onClick={reset}>
                  Cancel
                </button>
              </div>
            </section>
          ) : (
            <div className="fw-actions">
              <button className="fw-btn" onClick={() => void lockNow()}>
                Lock now
              </button>
              <button className="fw-btn" onClick={() => setMode('changing')}>
                Change passphrase
              </button>
              <button className="fw-btn fw-btn--danger" onClick={() => setMode('disabling')}>
                Turn off encryption
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------- fragments */

function PassphraseField({
  label,
  value,
  onChange,
  autoFocus = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoFocus?: boolean;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="fw-tf">
      <label className="fw-tf__label">{label}</label>
      <div className="fw-passrow">
        <input
          className="fw-input"
          type={visible ? 'text' : 'password'}
          value={value}
          autoFocus={autoFocus}
          autoComplete="new-password"
          spellCheck={false}
          onChange={(event) => onChange(event.target.value)}
        />
        <button
          className="fw-btn fw-btn--sm"
          type="button"
          aria-pressed={visible}
          onClick={() => setVisible(!visible)}
        >
          {visible ? 'Hide' : 'Show'}
        </button>
      </div>
    </div>
  );
}

function StrengthMeter({
  strength,
  show,
}: {
  strength: ReturnType<typeof passphraseStrength>;
  show: boolean;
}) {
  if (!show) return null;
  return (
    <div className="fw-strength" aria-live="polite">
      <div className="fw-strength__bars" aria-hidden="true">
        {[0, 1, 2, 3].map((index) => (
          <span
            key={index}
            className={`fw-strength__bar${index < strength.score ? ` fw-strength__bar--on-${strength.score}` : ''}`}
          />
        ))}
      </div>
      <span className="fw-strength__label">
        {strength.label} — {strength.hint}
      </span>
    </div>
  );
}

function Check({ children, ok }: { children: React.ReactNode; ok: boolean }) {
  return (
    <li className="fw-check">
      <span className={`fw-check__mark${ok ? ' fw-check__mark--ok' : ' fw-check__mark--no'}`} aria-hidden="true">
        {ok ? '✓' : '✗'}
      </span>
      <span>{children}</span>
    </li>
  );
}

async function syncSettings(onSettingsChange: (settings: Settings) => void): Promise<void> {
  const result = await send<Settings>({ type: 'ui:get-settings' });
  if (result.ok) onSettingsChange(result.data);
}
