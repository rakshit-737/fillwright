import { useMemo, useState } from 'react';
import { FIELD_CATALOG } from '@/field-detection/catalog';
import type { ImportPreview, ImportSelection, SettingValue } from '@/profile/portable';

/**
 * Step two of an import: shows what the file holds and lets the user choose.
 *
 * Profiles start ticked — they are added alongside, never over, what is
 * stored. Settings changes and learned mappings start unticked: either can
 * change how Fillwright behaves on real forms, so they need an explicit yes.
 * Everything shown here is text from the file, rendered as React text nodes.
 */
export function ImportReview({
  preview,
  busy,
  onImport,
  onCancel,
}: {
  preview: ImportPreview;
  busy: boolean;
  onImport: (selection: ImportSelection) => void;
  onCancel: () => void;
}) {
  const [profiles, setProfiles] = useState<Set<number>>(
    () => new Set(preview.profiles.map((p) => p.index)),
  );
  const [mappings, setMappings] = useState<Set<number>>(() => new Set());
  const [settings, setSettings] = useState<Set<string>>(() => new Set());
  const [history, setHistory] = useState(false);

  const bySite = useMemo(() => {
    const groups = new Map<string, ImportPreview['mappings']>();
    for (const mapping of preview.mappings) {
      groups.set(mapping.origin, [...(groups.get(mapping.origin) ?? []), mapping]);
    }
    return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [preview.mappings]);

  const toggle = <T,>(set: Set<T>, value: T, on: boolean): Set<T> => {
    const next = new Set(set);
    if (on) next.add(value);
    else next.delete(value);
    return next;
  };

  const nothing = profiles.size + mappings.size + settings.size === 0 && !history;

  return (
    <section className="fw-section fw-import-review" aria-labelledby="fw-import-review-title">
      <h2 className="fw-section__title" id="fw-import-review-title">
        Review this import
      </h2>
      <p className="fw-section__lead">
        Nothing has been saved yet. Tick what you want to keep. Settings and learned fields start
        unticked because they change how Fillwright behaves on real forms.
      </p>
      {preview.warnings.length > 0 && (
        <div className="fw-notice" role="status">
          {preview.warnings.join(' ')}
        </div>
      )}

      <fieldset className="fw-import-group">
        <legend className="fw-field__label">Profiles ({preview.profiles.length})</legend>
        {preview.profiles.map((profile) => (
          <label className="fw-field fw-field--toggle" key={profile.index}>
            <input
              type="checkbox"
              data-import="profile"
              checked={profiles.has(profile.index)}
              onChange={(e) => setProfiles(toggle(profiles, profile.index, e.target.checked))}
            />
            <span className="fw-field__label">{profile.name}</span>
          </label>
        ))}
      </fieldset>

      {bySite.length > 0 && (
        <fieldset className="fw-import-group">
          <legend className="fw-field__label">
            Learned fields ({preview.mappings.length}), by site
          </legend>
          <p className="fw-field__hint">
            Imported fields are marked &ldquo;imported&rdquo; and never start ticked on a form until
            you confirm one there.
          </p>
          {bySite.map(([origin, items]) => (
            <div className="fw-import-site" key={origin}>
              <label className="fw-field fw-field--toggle">
                <input
                  type="checkbox"
                  data-import="site"
                  checked={items.every((item) => mappings.has(item.index))}
                  onChange={(e) => {
                    let next = mappings;
                    for (const item of items) next = toggle(next, item.index, e.target.checked);
                    setMappings(next);
                  }}
                />
                <span className="fw-field__label">{hostOf(origin)}</span>
              </label>
              <ul className="fw-import-list">
                {items.map((item) => (
                  <li key={item.index}>
                    <label className="fw-field fw-field--toggle">
                      <input
                        type="checkbox"
                        data-import="mapping"
                        checked={mappings.has(item.index)}
                        onChange={(e) =>
                          setMappings(toggle(mappings, item.index, e.target.checked))
                        }
                      />
                      <span>
                        {item.label || 'Unlabelled field'} &rarr; {catalogLabel(item.canonical)}{' '}
                        <span className="fw-chip">imported</span>
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </fieldset>
      )}

      {preview.settingsChanges.length > 0 && (
        <fieldset className="fw-import-group">
          <legend className="fw-field__label">
            Settings this file would change ({preview.settingsChanges.length})
          </legend>
          {preview.settingsChanges.map((change) => (
            <label className="fw-field fw-field--toggle" key={change.path}>
              <input
                type="checkbox"
                data-import="setting"
                data-path={change.path}
                checked={settings.has(change.path)}
                onChange={(e) => setSettings(toggle(settings, change.path, e.target.checked))}
              />
              <span>
                <span className="fw-field__label">{settingLabel(change.path)}</span>
                <span className="fw-field__hint">
                  {show(change.from)} &rarr; {show(change.to)}
                </span>
              </span>
            </label>
          ))}
        </fieldset>
      )}

      {preview.history > 0 && (
        <label className="fw-field fw-field--toggle">
          <input
            type="checkbox"
            data-import="history"
            checked={history}
            onChange={(e) => setHistory(e.target.checked)}
          />
          <span>
            <span className="fw-field__label">Application history ({preview.history} entries)</span>
            <span className="fw-field__hint">Added only if history is switched on.</span>
          </span>
        </label>
      )}

      <div className="fw-actions">
        <button
          className="fw-btn fw-btn--primary"
          disabled={busy || nothing}
          onClick={() =>
            onImport({
              profiles: [...profiles],
              mappings: [...mappings],
              settings: [...settings],
              history,
            })
          }
        >
          Import selected
        </button>
        <button className="fw-btn" disabled={busy} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </section>
  );
}

const SETTING_LABELS: Record<string, string> = {
  'autofill.fillEmptyFieldsOnly': 'Fill empty fields only',
  'autofill.allowOverwrite': 'Overwrite fields that already have a value',
  'autofill.confidenceThreshold': 'Confidence needed to pre-tick a field',
  'autofill.previewBeforeFill': 'Preview before filling',
  'autofill.highlightFilledFields': 'Highlight filled fields',
  'autofill.mode': 'Autofill mode',
  'ui.theme': 'Theme',
  'ui.reducedMotion': 'Reduced motion',
  'ui.showFloatingWidget': 'Show the floating panel',
  'ai.enabled': 'On-device assistance',
  'ai.provider': 'Assistance provider',
  'ai.assistFieldMapping': 'Assist with field matching',
  'ai.assistAnswerDrafting': 'Assist with drafting answers',
  'privacy.keepApplicationHistory': 'Keep application history',
  'privacy.autoLockMinutes': 'Auto-lock after (minutes)',
};

function settingLabel(path: string): string {
  return SETTING_LABELS[path] ?? path;
}

function show(value: SettingValue): string {
  if (typeof value === 'boolean') return value ? 'on' : 'off';
  return String(value);
}

function catalogLabel(field: string): string {
  return FIELD_CATALOG.find((entry) => entry.field === field)?.label ?? field;
}

function hostOf(origin: string): string {
  try {
    return new URL(origin).host;
  } catch {
    return origin;
  }
}
