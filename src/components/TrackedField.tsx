import { useId } from 'react';
import { ConfidenceBadge, SourceTag } from './ConfidenceBadge';
import { tv } from '@/profile/factory';
import type { TrackedValue } from '@/types/profile';

interface Props {
  label: string;
  value: TrackedValue;
  onChange: (next: TrackedValue) => void;
  type?: 'text' | 'email' | 'tel' | 'url' | 'date' | 'month';
  placeholder?: string;
  hint?: string;
  multiline?: boolean;
  /** Marks the field as one that materially improves autofill coverage. */
  important?: boolean;
}

/**
 * A profile field with its audit trail attached.
 *
 * Editing a value rewrites its provenance to `user` at full confidence. That is
 * the mechanism behind the "your edits are never overwritten" guarantee: the
 * resume merge checks this exact flag, so correcting a field here permanently
 * protects it from a future import.
 */
export function TrackedField({
  label,
  value,
  onChange,
  type = 'text',
  placeholder,
  hint,
  multiline = false,
  important = false,
}: Props) {
  const id = useId();
  const fromResume = value.provenance.source === 'resume';
  const empty = value.value.trim() === '';

  const handle = (next: string) => {
    if (next === value.value) return;
    onChange(tv(next, 'user', 1, 'entered by you'));
  };

  return (
    <div className={`fw-tf${important && empty ? ' fw-tf--wanted' : ''}`}>
      <div className="fw-tf__head">
        <label className="fw-tf__label" htmlFor={id}>
          {label}
          {important && empty && (
            <span className="fw-tf__wanted" title="Commonly asked for on applications">
              often required
            </span>
          )}
        </label>
        {!empty && fromResume && <ConfidenceBadge confidence={value.provenance.confidence} provenance={value.provenance} compact />}
      </div>

      {multiline ? (
        <textarea
          id={id}
          className="fw-textarea fw-tf__input"
          rows={4}
          value={value.value}
          placeholder={placeholder}
          onChange={(event) => handle(event.target.value)}
        />
      ) : (
        <input
          id={id}
          className="fw-input fw-tf__input"
          type={type}
          value={value.value}
          placeholder={placeholder}
          autoComplete="off"
          spellCheck={type === 'text'}
          onChange={(event) => handle(event.target.value)}
        />
      )}

      <div className="fw-tf__foot">
        {hint && <span className="fw-field__hint">{hint}</span>}
        {!empty && <SourceTag provenance={value.provenance} />}
      </div>
    </div>
  );
}

/** Plain text input for list-entry fields, which track provenance per entry. */
export function PlainField({
  label,
  value,
  onChange,
  type = 'text',
  placeholder,
  hint,
  multiline = false,
  rows = 3,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  type?: string;
  placeholder?: string;
  hint?: string;
  multiline?: boolean;
  rows?: number;
}) {
  const id = useId();
  return (
    <div className="fw-tf">
      <label className="fw-tf__label" htmlFor={id}>
        {label}
      </label>
      {multiline ? (
        <textarea
          id={id}
          className="fw-textarea fw-tf__input"
          rows={rows}
          value={value}
          placeholder={placeholder}
          onChange={(event) => onChange(event.target.value)}
        />
      ) : (
        <input
          id={id}
          className="fw-input fw-tf__input"
          type={type}
          value={value}
          placeholder={placeholder}
          autoComplete="off"
          onChange={(event) => onChange(event.target.value)}
        />
      )}
      {hint && <span className="fw-field__hint">{hint}</span>}
    </div>
  );
}

export function SelectField({
  label,
  value,
  options,
  onChange,
  hint,
}: {
  label: string;
  value: string;
  options: Array<[string, string]>;
  onChange: (next: string) => void;
  hint?: string;
}) {
  const id = useId();
  return (
    <div className="fw-tf">
      <label className="fw-tf__label" htmlFor={id}>
        {label}
      </label>
      <select
        id={id}
        className="fw-select fw-tf__input"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        {options.map(([optionValue, optionLabel]) => (
          <option key={optionValue} value={optionValue}>
            {optionLabel}
          </option>
        ))}
      </select>
      {hint && <span className="fw-field__hint">{hint}</span>}
    </div>
  );
}

/** Comma-separated list editor, used for skills, coursework and technologies. */
export function TagsField({
  label,
  values,
  onChange,
  placeholder,
  hint,
}: {
  label: string;
  values: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  hint?: string;
}) {
  const id = useId();
  return (
    <div className="fw-tf">
      <label className="fw-tf__label" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        className="fw-input fw-tf__input"
        value={values.join(', ')}
        placeholder={placeholder}
        autoComplete="off"
        onChange={(event) =>
          onChange(
            event.target.value
              .split(',')
              .map((item) => item.trim())
              .filter(Boolean),
          )
        }
      />
      {hint && <span className="fw-field__hint">{hint}</span>}
    </div>
  );
}

export function CheckField({
  label,
  checked,
  onChange,
  hint,
}: {
  label: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  hint?: string;
}) {
  return (
    <label className="fw-field fw-field--toggle">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <span>
        <span className="fw-field__label">{label}</span>
        {hint && <span className="fw-field__hint">{hint}</span>}
      </span>
    </label>
  );
}
