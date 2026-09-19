import { useEffect, useState } from 'react';
import { send } from '@/utils/messaging';
import type { DeepPartial } from '@/types/messages';
import type { AutofillMode, Settings } from '@/types/settings';

interface Props {
  settings: Settings | null;
  onChange: (settings: Settings) => void;
}

export function SettingsPane({ settings, onChange }: Props) {
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');

  if (!settings) return <div className="fw-pane fw-muted">Loading settings…</div>;

  const patch = async (next: DeepPartial<Settings>) => {
    setSaving(true);
    const result = await send<Settings>({ type: 'ui:set-settings', patch: next });
    setSaving(false);
    if (result.ok) {
      onChange(result.data);
      setSaveError('');
    } else {
      setSaveError(`That setting wasn’t saved. ${result.error}`);
    }
  };

  return (
    <div className="fw-pane">
      <header className="fw-pane__header">
        <h1 className="fw-pane__title">Settings</h1>
        <p className="fw-pane__subtitle">
          Defaults are deliberately cautious. Loosen them only where you want to.
          {saving && <span className="fw-saving"> Saving…</span>}
        </p>
      </header>

      {saveError && (
        <div className="fw-notice fw-notice--danger" role="alert">
          {saveError}
        </div>
      )}

      <AutofillModeSection settings={settings} onChange={onChange} />

      <section className="fw-section">
        <h2 className="fw-section__title">Autofill</h2>
        <Toggle
          label="Allow overwriting existing values"
          hint="Off by default, so anything you already typed is left alone. When on, Fillwright still shows you every change first."
          checked={settings.autofill.allowOverwrite}
          onChange={(value) => patch({ autofill: { allowOverwrite: value } })}
        />
        <Toggle
          label="Highlight fields Fillwright changed"
          checked={settings.autofill.highlightFilledFields}
          onChange={(value) => patch({ autofill: { highlightFilledFields: value } })}
        />
        <Slider
          label="Confidence needed to fill automatically"
          hint="Weaker matches are shown as suggestions instead of being filled."
          value={settings.autofill.confidenceThreshold}
          onChange={(value) => patch({ autofill: { confidenceThreshold: value } })}
        />
      </section>

      <section className="fw-section">
        <h2 className="fw-section__title">Privacy</h2>
        <Toggle
          label="Keep a local application history"
          hint="Company, role, site and date only. Never uploaded, and never includes what you typed."
          checked={settings.privacy.keepApplicationHistory}
          onChange={(value) => patch({ privacy: { keepApplicationHistory: value } })}
        />
      </section>

      <section className="fw-section">
        <h2 className="fw-section__title">Advanced</h2>
        <Toggle
          label="Show detection details"
          hint="Adds the signals behind each match to the on-page panel, for working out why an unusual form maps badly. Values are masked, and nothing is sent anywhere."
          checked={settings.advanced.diagnostics}
          onChange={(value) => patch({ advanced: { diagnostics: value } })}
        />
      </section>

      <section className="fw-section">
        <h2 className="fw-section__title">Appearance</h2>
        <Radio
          label="Theme"
          value={settings.ui.theme}
          options={[
            ['system', 'Match system'],
            ['light', 'Light'],
            ['dark', 'Dark'],
          ]}
          onChange={(value) => patch({ ui: { theme: value as Settings['ui']['theme'] } })}
        />
        <Toggle
          label="Reduce motion"
          hint="Also applies to the panel on job sites."
          checked={settings.ui.reducedMotion}
          onChange={(value) => patch({ ui: { reducedMotion: value } })}
        />
        <Toggle
          label="Show the on-page prompt in Assist and Smart"
          hint="When off, Fillwright only appears on a job site when you click its button or press the shortcut."
          checked={settings.ui.showFloatingWidget}
          onChange={(value) => patch({ ui: { showFloatingWidget: value } })}
        />
      </section>
    </div>
  );
}

function Toggle({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="fw-field fw-field--toggle">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>
        <span className="fw-field__label">{label}</span>
        {hint && <span className="fw-field__hint">{hint}</span>}
      </span>
    </label>
  );
}

function Slider({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint?: string;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <div className="fw-field">
      <label className="fw-field__label" htmlFor="fw-threshold">
        {label} <strong>{Math.round(value * 100)}%</strong>
      </label>
      {hint && <span className="fw-field__hint">{hint}</span>}
      <input
        id="fw-threshold"
        type="range"
        min={0.4}
        max={0.95}
        step={0.05}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </div>
  );
}

function Radio({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: Array<[string, string]>;
  onChange: (value: string) => void;
}) {
  return (
    <fieldset className="fw-field fw-fieldset">
      <legend className="fw-field__label">{label}</legend>
      <div className="fw-radiorow">
        {options.map(([optionValue, optionLabel]) => (
          <label className="fw-radio" key={optionValue}>
            <input
              type="radio"
              name={label}
              value={optionValue}
              checked={value === optionValue}
              onChange={() => onChange(optionValue)}
            />
            <span>{optionLabel}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

const SITE_ACCESS = { origins: ['https://*/*'] };

const MODES: Array<[AutofillMode, string, string]> = [
  [
    'manual',
    'Manual',
    'Fillwright only runs when you click its button or press the shortcut. Needs no access to websites.',
  ],
  [
    'assist',
    'Assist',
    'Offers a small prompt on pages that clearly are job applications. Needs permission to read https pages.',
  ],
  [
    'smart',
    'Smart',
    'Also prepares the fill plan in advance, so it is ready when you open the panel. Same permission as Assist.',
  ],
];

/**
 * How proactive Fillwright is. No mode fills without your approval, and no
 * mode submits anything. Site access is requested here, in response to your
 * click, so Chrome shows its own permission prompt and you can refuse it.
 */
function AutofillModeSection({
  settings,
  onChange,
}: {
  settings: Settings;
  onChange: (settings: Settings) => void;
}) {
  const [notice, setNotice] = useState('');
  const [shortcut, setShortcut] = useState('');

  useEffect(() => {
    chrome.commands
      ?.getAll()
      .then((commands) => {
        setShortcut(
          commands.find((command) => command.name === 'fillwright-activate')?.shortcut ?? '',
        );
      })
      .catch(() => undefined);
  }, []);

  const choose = async (mode: AutofillMode) => {
    setNotice('');
    if (mode !== 'manual') {
      let granted = false;
      try {
        granted =
          (await chrome.permissions.contains(SITE_ACCESS)) ||
          (await chrome.permissions.request(SITE_ACCESS));
      } catch {
        granted = false;
      }
      if (!granted) {
        setNotice('Site access was not granted, so Fillwright stays in Manual mode.');
        return;
      }
    }
    const result = await send<Settings>({ type: 'ui:set-settings', patch: { autofill: { mode } } });
    if (result.ok) onChange(result.data);
    else {
      setNotice(`The mode wasn’t changed. ${result.error}`);
      return;
    }
    if (mode === 'manual' && (await chrome.permissions.contains(SITE_ACCESS).catch(() => false))) {
      setNotice(
        'Manual mode is on. Fillwright still holds site access — remove it below if you no longer need it.',
      );
    }
  };

  const revoke = async () => {
    const removed = await chrome.permissions.remove(SITE_ACCESS).catch(() => false);
    const result = await send<Settings>({
      type: 'ui:set-settings',
      patch: { autofill: { mode: 'manual' } },
    });
    if (result.ok) onChange(result.data);
    setNotice(
      !removed
        ? 'Chrome didn’t remove site access. You can remove it on chrome://extensions.'
        : result.ok
          ? 'Site access removed. Fillwright is in Manual mode.'
          : `Site access removed, but the mode wasn’t switched to Manual. ${result.error}`,
    );
  };

  return (
    <section className="fw-section">
      <h2 className="fw-section__title">When Fillwright appears</h2>
      <fieldset className="fw-modes" aria-label="Autofill mode">
        {MODES.map(([value, title, detail]) => (
          <label className="fw-mode" key={value}>
            <input
              type="radio"
              name="autofill-mode"
              value={value}
              checked={settings.autofill.mode === value}
              onChange={() => void choose(value)}
            />
            <span>
              <span className="fw-mode__title">{title}</span>
              <span className="fw-mode__detail">{detail}</span>
            </span>
          </label>
        ))}
      </fieldset>
      {notice && (
        <p className="fw-field__hint" role="status">
          {notice}
        </p>
      )}
      <p className="fw-field__hint">
        Keyboard shortcut: {shortcut ? <kbd className="fw-kbd">{shortcut}</kbd> : 'not set'}.{' '}
        <button
          className="fw-linkbtn"
          onClick={() =>
            void chrome.tabs
              .create({ url: 'chrome://extensions/shortcuts' })
              .catch(() => setNotice('Open chrome://extensions/shortcuts to change the shortcut.'))
          }
        >
          Change shortcut
        </button>
        {' · '}
        <button className="fw-linkbtn" onClick={() => void revoke()}>
          Remove site access
        </button>
      </p>
      <p className="fw-field__hint">
        No mode fills a form without your approval, and none ever submits one.
      </p>
    </section>
  );
}
