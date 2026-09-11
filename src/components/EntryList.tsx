import { useState, type ReactNode } from 'react';
import { ConfidenceBadge } from './ConfidenceBadge';
import type { Provenance } from '@/types/profile';

export interface EntryListProps<T> {
  title: string;
  description?: string;
  entries: T[];
  keyOf: (entry: T) => string;
  /** One-line summary shown when the card is collapsed. */
  summaryOf: (entry: T) => { primary: string; secondary?: string; provenance?: Provenance };
  renderEditor: (entry: T, update: (mutate: (draft: T) => void) => void) => ReactNode;
  onAdd: () => void;
  onRemove: (index: number) => void;
  onMove: (index: number, direction: -1 | 1) => void;
  onUpdate: (index: number, mutate: (draft: T) => void) => void;
  addLabel: string;
  emptyHint: string;
}

/**
 * Collapsible list of repeating profile entries.
 *
 * Entries stay collapsed by default so a profile with eight roles is still
 * scannable; the summary line shows enough to identify the entry, along with
 * how confident the parser was about it.
 */
export function EntryList<T>({
  title,
  description,
  entries,
  keyOf,
  summaryOf,
  renderEditor,
  onAdd,
  onRemove,
  onMove,
  onUpdate,
  addLabel,
  emptyHint,
}: EntryListProps<T>) {
  const [open, setOpen] = useState<Set<string>>(new Set());

  const toggle = (key: string) => {
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  return (
    <section className="fw-section">
      <div className="fw-section__head">
        <div>
          <h2 className="fw-section__title">{title}</h2>
          {description && <p className="fw-field__hint">{description}</p>}
        </div>
        <button className="fw-btn fw-btn--sm" onClick={onAdd}>
          {addLabel}
        </button>
      </div>

      {entries.length === 0 ? (
        <p className="fw-empty">{emptyHint}</p>
      ) : (
        <ul className="fw-entries">
          {entries.map((entry, index) => {
            const key = keyOf(entry);
            const summary = summaryOf(entry);
            const isOpen = open.has(key);
            return (
              <li className={`fw-entry${isOpen ? ' fw-entry--open' : ''}`} key={key}>
                <div className="fw-entry__bar">
                  <button
                    className="fw-entry__toggle"
                    aria-expanded={isOpen}
                    onClick={() => toggle(key)}
                  >
                    <svg
                      className="fw-entry__chevron"
                      viewBox="0 0 16 16"
                      width="12"
                      height="12"
                      aria-hidden="true"
                    >
                      <path
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="m6 4 4 4-4 4"
                      />
                    </svg>
                    <span className="fw-entry__primary">
                      {summary.primary || <em className="fw-entry__untitled">Untitled</em>}
                    </span>
                    {summary.secondary && (
                      <span className="fw-entry__secondary">{summary.secondary}</span>
                    )}
                  </button>

                  {summary.provenance?.source === 'resume' && (
                    <ConfidenceBadge
                      confidence={summary.provenance.confidence}
                      provenance={summary.provenance}
                      compact
                    />
                  )}

                  <div className="fw-entry__tools">
                    <button
                      className="fw-icon-btn"
                      onClick={() => onMove(index, -1)}
                      disabled={index === 0}
                      aria-label={`Move ${summary.primary || 'entry'} up`}
                      title="Move up"
                    >
                      <Chevron direction="up" />
                    </button>
                    <button
                      className="fw-icon-btn"
                      onClick={() => onMove(index, 1)}
                      disabled={index === entries.length - 1}
                      aria-label={`Move ${summary.primary || 'entry'} down`}
                      title="Move down"
                    >
                      <Chevron direction="down" />
                    </button>
                    <button
                      className="fw-icon-btn fw-icon-btn--danger"
                      onClick={() => {
                        if (window.confirm(`Remove "${summary.primary || 'this entry'}"?`)) {
                          onRemove(index);
                        }
                      }}
                      aria-label={`Remove ${summary.primary || 'entry'}`}
                      title="Remove"
                    >
                      <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
                        <path
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.5"
                          strokeLinecap="round"
                          d="M3 4.5h10M6.5 4.5V3h3v1.5M5 4.5l.5 8h5l.5-8"
                        />
                      </svg>
                    </button>
                  </div>
                </div>

                {isOpen && (
                  <div className="fw-entry__body">
                    {renderEditor(entry, (mutate) => onUpdate(index, mutate))}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function Chevron({ direction }: { direction: 'up' | 'down' }) {
  return (
    <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        d={direction === 'up' ? 'm4 10 4-4 4 4' : 'm4 6 4 4 4-4'}
      />
    </svg>
  );
}

/** Moves an item within an array, returning a new array. */
export function moveItem<T>(items: T[], index: number, direction: -1 | 1): T[] {
  const target = index + direction;
  if (target < 0 || target >= items.length) return items;
  const next = [...items];
  const [item] = next.splice(index, 1);
  if (item !== undefined) next.splice(target, 0, item);
  return next;
}
