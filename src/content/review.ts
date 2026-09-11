import type { CanonicalField, FieldSignals, FillPlanEntry, MappingStatus } from '@/types/fields';
import { FIELD_CATALOG, catalogGroups } from '@/field-detection/catalog';
import { STATUS_LABELS } from '@/autofill/plan';

/**
 * The review row.
 *
 * This is the part of Fillwright that earns trust, so it has to answer three
 * questions without the user having to ask: what will change, how sure is it,
 * and why did it decide that. A row that cannot answer the third question
 * offers the user a way to correct it instead.
 *
 * Built with explicit DOM calls — no innerHTML — because every label here came
 * from the page.
 */

export interface ReviewCallbacks {
  /** Raw signals per field, when diagnostics are on. Null otherwise. */
  diagnostics?: Map<string, FieldSignals> | null;
  onToggle: (fieldId: string, selected: boolean) => void;
  /** The user told Fillwright what an unrecognised field means. */
  onTeach: (entry: FillPlanEntry, field: CanonicalField, remember: boolean) => void;
  onExplainToggle: () => void;
}

export function renderReviewList(
  entries: FillPlanEntry[],
  selection: Set<string>,
  expandedExplanations: Set<string>,
  teaching: Set<string>,
  callbacks: ReviewCallbacks,
): HTMLElement {
  const list = el('ul', 'fw-list');
  list.setAttribute('role', 'group');
  list.setAttribute('aria-label', 'Fields Fillwright found');

  for (const entry of entries) {
    list.appendChild(
      renderRow(entry, selection, expandedExplanations, teaching, callbacks),
    );
  }

  return list;
}

function renderRow(
  entry: FillPlanEntry,
  selection: Set<string>,
  expanded: Set<string>,
  teaching: Set<string>,
  callbacks: ReviewCallbacks,
): HTMLElement {
  const tone = statusTone(entry.status);
  const item = el('li', `fw-item fw-item--${tone}`);
  const fillable = entry.newValue !== '' && entry.status !== 'manual-required';

  const row = el('div', 'fw-item__row');

  if (fillable) {
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'fw-check';
    checkbox.checked = selection.has(entry.fieldId);
    checkbox.id = `fw-check-${entry.fieldId}`;
    checkbox.addEventListener('change', () =>
      callbacks.onToggle(entry.fieldId, checkbox.checked),
    );
    row.appendChild(checkbox);
  } else {
    row.appendChild(el('span', 'fw-check fw-check--spacer'));
  }

  const text = el('span', 'fw-item__text');

  const labelRow = el('span', 'fw-item__labelrow');
  const label = el('label', 'fw-item__label', entry.label);
  if (fillable) label.setAttribute('for', `fw-check-${entry.fieldId}`);
  labelRow.appendChild(label);
  if (entry.remembered) {
    labelRow.appendChild(el('span', 'fw-chip', 'remembered'));
  }
  text.appendChild(labelRow);

  if (entry.newValue) {
    const value = el('span', 'fw-item__value');
    if (entry.currentValue && entry.currentValue !== entry.newValue) {
      value.appendChild(el('span', 'fw-item__old', entry.currentValue));
      value.appendChild(el('span', 'fw-item__arrow', ' → '));
    }
    value.appendChild(el('span', 'fw-item__new', entry.newValue));
    text.appendChild(value);
  } else {
    text.appendChild(el('span', 'fw-item__status', reasonFor(entry)));
  }

  row.appendChild(text);

  // Confidence is shown only where it affects what happens next — on fields
  // that are about to be written, or that are being offered for review. On a
  // field Fillwright is deliberately leaving alone, "95%" answers a question
  // nobody asked and hides the one that matters ("already filled in").
  const showsConfidence =
    (entry.status === 'ready' || entry.status === 'review') && entry.newValue !== '';

  const meta = el('span', 'fw-item__meta');
  meta.appendChild(
    el(
      'span',
      `fw-badge fw-badge--${tone}`,
      showsConfidence ? `${Math.round(entry.confidence * 100)}%` : STATUS_LABELS[entry.status],
    ),
  );
  row.appendChild(meta);

  item.appendChild(row);

  /* --- the explanation, and the correction ---------------------------- */

  const tools = el('div', 'fw-item__tools');

  if (entry.rationale) {
    const why = button(expanded.has(entry.fieldId) ? 'Hide reason' : 'Why?', 'fw-link', () => {
      if (expanded.has(entry.fieldId)) expanded.delete(entry.fieldId);
      else expanded.add(entry.fieldId);
      callbacks.onExplainToggle();
    });
    why.setAttribute('aria-expanded', String(expanded.has(entry.fieldId)));
    tools.appendChild(why);
  }

  // Anything Fillwright could not place, or placed doubtfully, can be corrected
  // by the user — and the correction is what makes the next visit better.
  const teachable = entry.status === 'unmapped' || entry.status === 'review' || entry.remembered;
  if (teachable && entry.fingerprint) {
    tools.appendChild(
      button(
        teaching.has(entry.fieldId) ? 'Cancel' : 'Set what this is',
        'fw-link',
        () => {
          if (teaching.has(entry.fieldId)) teaching.delete(entry.fieldId);
          else teaching.add(entry.fieldId);
          callbacks.onExplainToggle();
        },
      ),
    );
  }

  if (tools.childElementCount > 0) item.appendChild(tools);

  if (expanded.has(entry.fieldId)) {
    item.appendChild(el('p', 'fw-why', entry.rationale));

    const signals = callbacks.diagnostics?.get(entry.fieldId);
    if (signals) item.appendChild(renderDiagnostics(entry, signals));
  }

  if (teaching.has(entry.fieldId)) {
    item.appendChild(renderTeachPicker(entry, callbacks));
  }

  return item;
}

/**
 * The correction control.
 *
 * Kept deliberately plain: a grouped select and one checkbox. The interesting
 * part is what it does afterwards — the mapping is stored against this site so
 * the same field is recognised next time, which is the difference between a
 * tool that guesses and one that learns.
 */
function renderTeachPicker(entry: FillPlanEntry, callbacks: ReviewCallbacks): HTMLElement {
  const panel = el('div', 'fw-teach');

  panel.appendChild(
    el('p', 'fw-teach__lead', `What does “${entry.label}” ask for?`),
  );

  const select = document.createElement('select');
  select.className = 'fw-teach__select';
  select.setAttribute('aria-label', `What ${entry.label} asks for`);

  const blank = document.createElement('option');
  blank.value = '';
  blank.textContent = 'Choose…';
  select.appendChild(blank);

  for (const group of catalogGroups()) {
    const optgroup = document.createElement('optgroup');
    optgroup.label = group;
    for (const candidate of FIELD_CATALOG.filter((item) => item.group === group)) {
      const option = document.createElement('option');
      option.value = candidate.field;
      option.textContent = candidate.label;
      if (candidate.field === entry.canonical) option.selected = true;
      optgroup.appendChild(option);
    }
    select.appendChild(optgroup);
  }
  panel.appendChild(select);

  const rememberRow = el('label', 'fw-teach__remember');
  const remember = document.createElement('input');
  remember.type = 'checkbox';
  remember.className = 'fw-check';
  remember.checked = true;
  rememberRow.appendChild(remember);
  rememberRow.appendChild(el('span', '', 'Remember this for this website'));
  panel.appendChild(rememberRow);

  const actions = el('div', 'fw-teach__actions');
  actions.appendChild(
    button('Use this', 'fw-btn fw-btn--primary fw-btn--sm', () => {
      if (!select.value) return;
      callbacks.onTeach(entry, select.value as CanonicalField, remember.checked);
    }),
  );
  panel.appendChild(actions);

  panel.appendChild(
    el(
      'p',
      'fw-note',
      'Stored on this device only, for this website. You can review or remove it in Fillwright’s settings.',
    ),
  );

  return panel;
}

/**
 * Developer diagnostics.
 *
 * Shows the signals the classifier actually saw, which is the only way to
 * understand why an unusual form mapped the way it did.
 *
 * The proposed value is masked. Page-derived text — labels, attribute names —
 * is shown in full, because that is precisely what is being diagnosed and it is
 * the site's own markup, not the user's data.
 */
function renderDiagnostics(entry: FillPlanEntry, signals: FieldSignals): HTMLElement {
  const panel = el('div', 'fw-diag');
  panel.appendChild(el('p', 'fw-diag__head', 'Detection signals'));

  const rows: Array<[string, string]> = [
    ['label', signals.labelText],
    ['aria-label', signals.ariaLabel],
    ['name', signals.name],
    ['id', signals.id],
    ['autocomplete', signals.autocomplete],
    ['placeholder', signals.placeholder],
    ['type', signals.inputType],
    ['section', signals.sectionHeading],
    ['nearby text', signals.precedingText],
    ['options', signals.optionLabels.slice(0, 6).join(' | ')],
  ];

  const list = el('dl', 'fw-diag__list');
  for (const [name, value] of rows) {
    if (!value) continue;
    list.appendChild(el('dt', 'fw-diag__key', name));
    list.appendChild(el('dd', 'fw-diag__value', truncate(value, 120)));
  }

  list.appendChild(el('dt', 'fw-diag__key', 'field'));
  list.appendChild(el('dd', 'fw-diag__value', entry.canonical));
  list.appendChild(el('dt', 'fw-diag__key', 'confidence'));
  list.appendChild(el('dd', 'fw-diag__value', entry.confidence.toFixed(3)));
  list.appendChild(el('dt', 'fw-diag__key', 'status'));
  list.appendChild(el('dd', 'fw-diag__value', entry.status));
  list.appendChild(el('dt', 'fw-diag__key', 'value'));
  list.appendChild(el('dd', 'fw-diag__value', mask(entry.newValue)));

  panel.appendChild(list);
  return panel;
}

/** Keeps enough of a value to recognise it, not enough to read it. */
function mask(value: string): string {
  if (!value) return '(none)';
  if (value.length <= 2) return '•'.repeat(value.length);
  return `${value.slice(0, 2)}${'•'.repeat(Math.min(8, value.length - 2))} (${value.length} chars)`;
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

/* ------------------------------------------------------------------ utils */

/**
 * The user-facing reason a field has no value.
 *
 * The rationale strings are written for a person, so the short form here is
 * just the status; the full sentence is one click away behind "Why?".
 */
function reasonFor(entry: FillPlanEntry): string {
  switch (entry.status) {
    case 'missing-value':
      return 'Not in your profile yet';
    case 'needs-consent':
      return 'Only you can answer this';
    case 'manual-required':
      return 'You need to write this';
    case 'skipped-existing':
      return 'You already filled this in';
    case 'unmapped':
      return 'Fillwright does not recognise this';
    default:
      return STATUS_LABELS[entry.status];
  }
}

export function statusTone(status: MappingStatus): string {
  switch (status) {
    case 'ready':
      return 'ok';
    case 'review':
    case 'needs-consent':
    case 'manual-required':
      return 'caution';
    default:
      return 'muted';
  }
}

function el(tag: string, className = '', text = ''): HTMLElement {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

function button(label: string, className: string, onClick: () => void): HTMLButtonElement {
  const node = document.createElement('button');
  node.type = 'button';
  node.className = className;
  node.textContent = label;
  node.addEventListener('click', onClick);
  return node;
}
