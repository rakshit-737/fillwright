import { useCallback, useEffect, useMemo, useState } from 'react';
import { send } from '@/utils/messaging';
import { FIELD_CATALOG, catalogGroups, catalogLabel } from '@/field-detection/catalog';
import type { CanonicalField, SavedMapping } from '@/types/fields';

/**
 * What Fillwright has learned from your corrections.
 *
 * Every entry here exists because a person told Fillwright what a field meant
 * on a particular site. That makes it worth showing plainly: it is the one part
 * of the product's behaviour the user authored themselves, so they should be
 * able to see it, check it, change it, pause it and take it back.
 *
 * None of it leaves this device.
 */
export function SavedMappings() {
  const [mappings, setMappings] = useState<SavedMapping[]>([]);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [inspecting, setInspecting] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const result = await send<SavedMapping[]>({ type: 'ui:list-saved-mappings' });
    if (result.ok) setMappings(result.data);
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const bySite = useMemo(() => {
    const groups = new Map<string, SavedMapping[]>();
    for (const mapping of mappings) {
      groups.set(mapping.origin, [...(groups.get(mapping.origin) ?? []), mapping]);
    }
    return Array.from(groups.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [mappings]);

  const remove = async (mapping: SavedMapping) => {
    await send({ type: 'ui:delete-saved-mapping', id: mapping.id });
    await refresh();
    setNotice(
      `Forgot “${mapping.label || 'that field'}”. Fillwright will classify it normally again.`,
    );
  };

  const retarget = async (mapping: SavedMapping, canonical: CanonicalField) => {
    setEditing(null);
    if (canonical === mapping.canonical) return;
    const result = await send({ type: 'ui:update-saved-mapping', id: mapping.id, canonical });
    await refresh();
    setNotice(
      result.ok
        ? `“${mapping.label || 'That field'}” now means ${catalogLabel(canonical).toLowerCase()}.`
        : result.error,
    );
  };

  const setPaused = async (mapping: SavedMapping, disabled: boolean) => {
    await send({ type: 'ui:update-saved-mapping', id: mapping.id, disabled });
    await refresh();
    setNotice(
      disabled
        ? `Paused “${mapping.label || 'that field'}”. Fillwright ignores it until you resume it.`
        : `Resumed “${mapping.label || 'that field'}”.`,
    );
  };

  const forgetSite = async (origin: string, items: SavedMapping[]) => {
    if (
      !window.confirm(
        `Forget everything Fillwright learned about ${hostOf(origin)}?\n\n` +
          `${items.length} remembered field${items.length === 1 ? '' : 's'} will be removed.`,
      )
    ) {
      return;
    }
    await send({ type: 'ui:clear-saved-mappings', origin });
    await refresh();
    setNotice(`Forgot everything for ${hostOf(origin)}.`);
  };

  const forgetAll = async () => {
    if (
      !window.confirm(
        `Forget all ${mappings.length} learned field${mappings.length === 1 ? '' : 's'} on ` +
          `${bySite.length} website${bySite.length === 1 ? '' : 's'}?\n\nThis cannot be undone.`,
      )
    ) {
      return;
    }
    await send({ type: 'ui:clear-saved-mappings' });
    await refresh();
    setNotice('Fillwright has forgotten every website correction.');
  };

  if (loading) {
    return (
      <div className="fw-pane" role="status">
        <span className="fw-spinner" aria-hidden="true" />{' '}
        <span className="fw-muted">Loading…</span>
      </div>
    );
  }

  return (
    <div className="fw-pane">
      <header className="fw-pane__header">
        <h1 className="fw-pane__title">What Fillwright has learned</h1>
        <p className="fw-pane__subtitle">
          When you tell Fillwright what a field means, it remembers that for the site you were on.
          Everything here came from a correction you made, and stays on this device.
        </p>
      </header>

      {notice && (
        <div className="fw-notice" role="status">
          {notice}
        </div>
      )}

      {mappings.length === 0 ? (
        <p className="fw-empty">
          Nothing learned yet. On an application, open Fillwright’s list, choose{' '}
          <strong>Change</strong> or <strong>Set what this is</strong> on a field, and tick
          “Remember this for this website”. The correction will appear here.
        </p>
      ) : (
        <>
          {bySite.map(([origin, items]) => (
            <section className="fw-section" key={origin} aria-labelledby={`site-${origin}`}>
              <div className="fw-section__head">
                <div>
                  <h2 className="fw-section__title" id={`site-${origin}`}>
                    {hostOf(origin)}
                  </h2>
                  <p className="fw-field__hint">
                    {items.length} remembered field{items.length === 1 ? '' : 's'}
                    {items.some((item) => item.disabled) &&
                      ` · ${items.filter((item) => item.disabled).length} paused`}
                  </p>
                </div>
                <button
                  className="fw-btn fw-btn--sm"
                  onClick={() => void forgetSite(origin, items)}
                >
                  Reset this site
                </button>
              </div>

              <ul className="fw-maplist">
                {items.map((mapping) => (
                  <li
                    className={`fw-mapping${mapping.disabled ? ' fw-mapping--paused' : ''}`}
                    key={mapping.id}
                  >
                    <div className="fw-mapping__row">
                      <div className="fw-mapping__text">
                        <span className="fw-mapping__label">
                          {mapping.label || 'Unlabelled field'}
                        </span>
                        {editing === mapping.id ? (
                          <FieldPicker
                            value={mapping.canonical}
                            label={mapping.label}
                            onChoose={(field) => void retarget(mapping, field)}
                            onCancel={() => setEditing(null)}
                          />
                        ) : (
                          <span className="fw-mapping__target">
                            &rarr; {catalogLabel(mapping.canonical)}
                            {mapping.disabled && (
                              <span className="fw-mapping__state"> · paused</span>
                            )}
                          </span>
                        )}
                      </div>
                      <span className="fw-mapping__uses">
                        {mapping.useCount > 0
                          ? `used ${mapping.useCount} time${mapping.useCount === 1 ? '' : 's'}`
                          : 'not used yet'}
                      </span>
                    </div>

                    <div className="fw-mapping__tools">
                      <button
                        className="fw-linkbtn"
                        aria-expanded={editing === mapping.id}
                        onClick={() => setEditing(editing === mapping.id ? null : mapping.id)}
                      >
                        Change
                      </button>
                      <button
                        className="fw-linkbtn"
                        onClick={() => void setPaused(mapping, !mapping.disabled)}
                      >
                        {mapping.disabled ? 'Resume' : 'Pause'}
                      </button>
                      <button
                        className="fw-linkbtn"
                        aria-expanded={inspecting === mapping.id}
                        onClick={() => setInspecting(inspecting === mapping.id ? null : mapping.id)}
                      >
                        Details
                      </button>
                      <button
                        className="fw-linkbtn fw-linkbtn--danger"
                        aria-label={`Forget ${mapping.label || 'this mapping'}`}
                        onClick={() => void remove(mapping)}
                      >
                        Forget
                      </button>
                    </div>

                    {inspecting === mapping.id && (
                      <dl className="fw-mapping__details">
                        <dt>Website</dt>
                        <dd>{origin}</dd>
                        <dt>Matches</dt>
                        <dd>
                          <code>{mapping.fingerprint}</code>
                        </dd>
                        <dt>Taught</dt>
                        <dd>{formatWhen(mapping.createdAt)}</dd>
                        <dt>Fills</dt>
                        <dd>{catalogLabel(mapping.canonical)}</dd>
                      </dl>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          ))}

          <section className="fw-section">
            <h2 className="fw-section__title">Start over</h2>
            <p className="fw-section__lead">
              Removes every correction on every website. Fillwright goes back to recognising fields
              on its own.
            </p>
            <div className="fw-actions">
              <button className="fw-btn fw-btn--danger" onClick={() => void forgetAll()}>
                Forget all learned fields
              </button>
            </div>
          </section>
        </>
      )}
    </div>
  );
}

function FieldPicker({
  value,
  label,
  onChoose,
  onCancel,
}: {
  value: CanonicalField;
  label: string;
  onChoose: (field: CanonicalField) => void;
  onCancel: () => void;
}) {
  const [choice, setChoice] = useState<CanonicalField>(value);
  return (
    <span className="fw-mapping__picker">
      <select
        className="fw-select"
        value={choice}
        aria-label={`What ${label || 'this field'} asks for`}
        onChange={(event) => setChoice(event.target.value as CanonicalField)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') onCancel();
        }}
      >
        {catalogGroups().map((group) => (
          <optgroup label={group} key={group}>
            {FIELD_CATALOG.filter((entry) => entry.group === group).map((entry) => (
              <option value={entry.field} key={entry.field}>
                {entry.label}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
      <button className="fw-btn fw-btn--sm fw-btn--primary" onClick={() => onChoose(choice)}>
        Save
      </button>
      <button className="fw-btn fw-btn--sm" onClick={onCancel}>
        Cancel
      </button>
    </span>
  );
}

function formatWhen(iso: string): string {
  const when = new Date(iso);
  return Number.isNaN(when.getTime())
    ? 'Unknown'
    : when.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

function hostOf(origin: string): string {
  try {
    return new URL(origin).hostname.replace(/^www\./, '');
  } catch {
    return origin || 'unknown site';
  }
}
