import { useId, useState } from 'react';
import { resolveValue } from '@/autofill/resolve';
import { catalogLabel } from '@/field-detection/catalog';
import type { CanonicalField } from '@/types/fields';
import type { Profile } from '@/types/profile';

/**
 * "What autofill will see" for one section of the profile.
 *
 * Trust boundary: extension page; reads the profile being edited. Values come
 * from `resolveValue` — the same function the worker uses to fill a form — so
 * this shows exactly what a form would receive, including fields that are
 * built from others (full name, formatted location, years of experience) and
 * fields deliberately left blank.
 */
export function AutofillPreview({
  profile,
  fields,
  entries = 1,
}: {
  profile: Profile;
  fields: CanonicalField[];
  /** For repeated sections, how many entries to show. */
  entries?: number;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const blocks = Math.max(1, entries);

  return (
    <div className="fw-preview">
      <button
        className="fw-linkbtn"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen(!open)}
      >
        {open ? 'Hide what autofill will see' : 'What autofill will see'}
      </button>
      {open && (
        <div id={id} className="fw-preview__body">
          {Array.from({ length: blocks }, (_, index) => (
            <dl className="fw-preview__list" key={index}>
              {blocks > 1 && <p className="fw-preview__block">Form block {index + 1}</p>}
              {fields.map((field) => {
                const resolved = resolveValue(field, profile, index);
                return (
                  <div className="fw-preview__row" key={field}>
                    <dt>{catalogLabel(field)}</dt>
                    <dd>
                      {resolved.value ? (
                        resolved.value
                      ) : (
                        <span className="fw-muted">
                          left blank{resolved.note ? ` — ${resolved.note}` : ''}
                        </span>
                      )}
                    </dd>
                  </div>
                );
              })}
            </dl>
          ))}
        </div>
      )}
    </div>
  );
}
