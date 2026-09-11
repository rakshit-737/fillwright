import { useCallback, useEffect, useMemo, useState } from 'react';
import { send } from '@/utils/messaging';
import { catalogLabel } from '@/field-detection/catalog';
import type { SavedMapping } from '@/types/fields';

/**
 * What Fillwright has learned from your corrections.
 *
 * Every entry here exists because a person told Fillwright what a field meant
 * on a particular site. That makes it worth showing plainly: it is the one part
 * of the product's behaviour the user authored themselves, so they should be
 * able to see it, check it and take it back.
 *
 * None of it leaves this device.
 */
export function SavedMappings() {
  const [mappings, setMappings] = useState<SavedMapping[]>([]);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState('');

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
    setNotice(`Forgot “${mapping.label}”. Fillwright will classify it normally again.`);
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
    for (const mapping of items) {
      await send({ type: 'ui:delete-saved-mapping', id: mapping.id });
    }
    await refresh();
    setNotice(`Forgot everything for ${hostOf(origin)}.`);
  };

  if (loading) {
    return (
      <div className="fw-pane" role="status">
        <span className="fw-spinner" aria-hidden="true" /> <span className="fw-muted">Loading…</span>
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
          Nothing learned yet. When Fillwright cannot place a field on an application, open the panel
          and choose <strong>Set what this is</strong> — the correction will appear here.
        </p>
      ) : (
        bySite.map(([origin, items]) => (
          <section className="fw-section" key={origin}>
            <div className="fw-section__head">
              <div>
                <h2 className="fw-section__title">{hostOf(origin)}</h2>
                <p className="fw-field__hint">
                  {items.length} remembered field{items.length === 1 ? '' : 's'}
                </p>
              </div>
              <button
                className="fw-btn fw-btn--sm"
                onClick={() => void forgetSite(origin, items)}
              >
                Forget this site
              </button>
            </div>

            <ul className="fw-maplist">
              {items.map((mapping) => (
                <li className="fw-mapping" key={mapping.id}>
                  <div className="fw-mapping__text">
                    <span className="fw-mapping__label">{mapping.label || 'Unlabelled field'}</span>
                    <span className="fw-mapping__target">
                      &rarr; {catalogLabel(mapping.canonical)}
                    </span>
                  </div>
                  <span className="fw-mapping__uses">
                    {mapping.useCount > 0
                      ? `used ${mapping.useCount} time${mapping.useCount === 1 ? '' : 's'}`
                      : 'not used yet'}
                  </span>
                  <button
                    className="fw-icon-btn fw-icon-btn--danger"
                    aria-label={`Forget ${mapping.label}`}
                    title="Forget this mapping"
                    onClick={() => void remove(mapping)}
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}

function hostOf(origin: string): string {
  try {
    return new URL(origin).hostname.replace(/^www\./, '');
  } catch {
    return origin || 'unknown site';
  }
}
