import { useState } from 'react';
import { send } from '@/utils/messaging';
import type { DeepPartial } from '@/types/messages';
import type { Settings } from '@/types/settings';

interface Props {
  settings: Settings | null;
  onChange: (settings: Settings) => void;
}

export function SettingsPane({ settings, onChange }: Props) {
  const [saving, setSaving] = useState(false);

  if (!settings) return <div className="fw-pane fw-muted">Loading settings…</div>;

  const patch = async (next: DeepPartial<Settings>) => {
    setSaving(true);
    const result = await send<Settings>({ type: 'ui:set-settings', patch: next });
    setSaving(false);
    if (result.ok) onChange(result.data);
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

      <section className="fw-section">
        <h2 className="fw-section__title">Autofill</h2>
        <Toggle
          label="Fill empty fields only"
          hint="Leaves anything you already typed untouched."
          checked={settings.autofill.fillEmptyFieldsOnly}
          onChange={(value) => patch({ autofill: { fillEmptyFieldsOnly: value } })}
        />
        <Toggle
          label="Allow overwriting existing values"
          hint="Off by default. When on, Fillwright still shows you every change first."
          checked={settings.autofill.allowOverwrite}
          onChange={(value) => patch({ autofill: { allowOverwrite: value } })}
        />
        <Toggle
          label="Show a preview before filling"
          hint="Review every value Fillwright is about to write."
          checked={settings.autofill.previewBeforeFill}
          onChange={(value) => patch({ autofill: { previewBeforeFill: value } })}
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
          checked={settings.ui.reducedMotion}
          onChange={(value) => patch({ ui: { reducedMotion: value } })}
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
