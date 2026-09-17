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

export interface DraftFact {
  id: string;
  label: string;
  value: string;
}

/**
 * A drafting panel for one written question. Owned by the widget; rendered
 * here so it sits directly under the question it answers.
 */
export type DraftView =
  | { phase: 'loading' }
  | { phase: 'facts' | 'generating'; facts: DraftFact[]; chosen: Set<string> }
  | { phase: 'result'; text: string; facts: DraftFact[]; chosen: Set<string> }
  | { phase: 'error'; message: string };

export interface ReviewCallbacks {
  /** Raw signals per field, when diagnostics are on. Null otherwise. */
  diagnostics?: Map<string, FieldSignals> | null;
  drafts?: Map<string, DraftView>;
  canDraft?: (entry: FillPlanEntry) => boolean;
  onDraftStart?: (entry: FillPlanEntry) => void;
  onDraftGenerate?: (entry: FillPlanEntry, factIds: string[]) => void;
  onDraftUse?: (entry: FillPlanEntry, text: string) => void;
  onDraftCancel?: (entry: FillPlanEntry) => void;
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
  } else if (entry.corrected) {
    labelRow.appendChild(el('span', 'fw-chip', 'your choice'));
  }
  if (entry.required && entry.status !== 'ready' && entry.status !== 'skipped-existing') {
    labelRow.appendChild(el('span', 'fw-chip fw-chip--required', 'required'));
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

  // Any mapping can be corrected - a confident match can still be wrong for
  // this particular form - and the correction is what makes the next visit
  // better. Unrecognised fields are phrased as a question instead.
  if (entry.fingerprint) {
    const opening = teaching.has(entry.fieldId);
    const label = opening ? 'Cancel' : entry.canonical === 'unknown' ? 'Set what this is' : 'Change';
    const change = button(label, 'fw-link', () => {
      if (teaching.has(entry.fieldId)) teaching.delete(entry.fieldId);
      else teaching.add(entry.fieldId);
      callbacks.onExplainToggle();
    });
    change.setAttribute('aria-expanded', String(opening));
    tools.appendChild(change);
  }

  if (
    entry.status === 'manual-required' &&
    callbacks.canDraft?.(entry) &&
    !callbacks.drafts?.has(entry.fieldId)
  ) {
    tools.appendChild(button('Draft with on-device AI', 'fw-link', () => callbacks.onDraftStart?.(entry)));
  }

  if (tools.childElementCount > 0) item.appendChild(tools);

  if (expanded.has(entry.fieldId)) {
    item.appendChild(renderWhy(entry));

    const signals = callbacks.diagnostics?.get(entry.fieldId);
    if (signals) item.appendChild(renderDiagnostics(entry, signals));
  }

  if (teaching.has(entry.fieldId)) {
    item.appendChild(renderTeachPicker(entry, callbacks));
  }

  const draft = callbacks.drafts?.get(entry.fieldId);
  if (draft) item.appendChild(renderDraft(entry, draft, callbacks));

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
  // Unticked, the choice applies to this form only and is then forgotten.
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
 * "Why?" — the explanation, in the user's language.
 *
 * Leads with what Fillwright thinks the field is, then the evidence, then how
 * sure it is and what that means for what happens next.
 */
function renderWhy(entry: FillPlanEntry): HTMLElement {
  const panel = el('div', 'fw-why');
  const meaning = FIELD_CATALOG.find((item) => item.field === entry.canonical)?.label;
  if (meaning) {
    const lead = el('p', 'fw-why__lead');
    lead.appendChild(el('span', '', 'Fillwright reads this as '));
    lead.appendChild(el('strong', '', meaning.toLowerCase()));
    panel.appendChild(lead);
  }
  panel.appendChild(el('p', 'fw-why__text', entry.rationale));
  if (entry.status === 'ready' || entry.status === 'review') {
    const percent = Math.round(entry.confidence * 100);
    panel.appendChild(
      el(
        'p',
        'fw-why__text',
        entry.status === 'ready'
          ? `${percent}% sure — high enough to fill when you press Fill.`
          : `${percent}% sure — not enough to fill on its own, so it is left unticked for you to check.`,
      ),
    );
  }
  return panel;
}

/**
 * Drafting a written answer.
 *
 * Three deliberate steps: see exactly which facts would be given to the
 * on-device model and untick any; generate; then read, edit and choose to use
 * it. Nothing reaches the form until "Use this answer" is pressed.
 */
function renderDraft(entry: FillPlanEntry, draft: DraftView, callbacks: ReviewCallbacks): HTMLElement {
  const panel = el('div', 'fw-teach fw-draft');
  panel.setAttribute('aria-busy', String(draft.phase === 'loading' || draft.phase === 'generating'));

  const actions = el('div', 'fw-teach__actions');
  const cancel = button('Cancel', 'fw-btn fw-btn--ghost fw-btn--sm', () => callbacks.onDraftCancel?.(entry));

  if (draft.phase === 'loading') {
    panel.appendChild(el('p', 'fw-note', 'Checking the on-device model…'));
    return panel;
  }

  if (draft.phase === 'error') {
    panel.appendChild(el('p', 'fw-error', draft.message));
    cancel.textContent = 'Close';
    actions.appendChild(cancel);
    panel.appendChild(actions);
    return panel;
  }

  if (draft.phase === 'facts' || draft.phase === 'generating') {
    const busy = draft.phase === 'generating';
    panel.appendChild(el('p', 'fw-teach__lead', 'Which facts may the draft use?'));
    panel.appendChild(
      el(
        'p',
        'fw-note',
        'Only ticked items are given to Chrome’s on-device model. Nothing is sent over the network. Contact details and sensitive answers are never included.',
      ),
    );
    const list = el('div', 'fw-facts');
    for (const fact of draft.facts) {
      const row = el('label', 'fw-teach__remember');
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.className = 'fw-check';
      box.checked = draft.chosen.has(fact.id);
      box.disabled = busy;
      box.addEventListener('change', () => {
        if (box.checked) draft.chosen.add(fact.id);
        else draft.chosen.delete(fact.id);
      });
      row.appendChild(box);
      row.appendChild(el('span', '', `${fact.label}: ${truncate(fact.value, 90)}`));
      list.appendChild(row);
    }
    panel.appendChild(list);

    actions.appendChild(cancel);
    const generate = button(busy ? 'Writing…' : 'Write a draft', 'fw-btn fw-btn--primary fw-btn--sm', () =>
      callbacks.onDraftGenerate?.(entry, [...draft.chosen]),
    );
    generate.disabled = busy;
    actions.appendChild(generate);
    panel.appendChild(actions);
    return panel;
  }

  if (draft.phase !== 'result') return panel;

  panel.appendChild(el('p', 'fw-teach__lead', 'Draft — edit it before you use it'));
  const area = document.createElement('textarea');
  area.className = 'fw-draft__text';
  area.value = draft.text;
  area.rows = 6;
  area.setAttribute('aria-label', `Draft answer for ${entry.label}`);
  area.addEventListener('input', () => {
    draft.text = area.value;
  });
  panel.appendChild(area);
  panel.appendChild(el('p', 'fw-note', 'Check every claim. A model can state things that are not true about you.'));

  actions.appendChild(cancel);
  actions.appendChild(
    button('Regenerate', 'fw-btn fw-btn--ghost fw-btn--sm', () =>
      callbacks.onDraftGenerate?.(entry, [...draft.chosen]),
    ),
  );
  actions.appendChild(
    button('Use this answer', 'fw-btn fw-btn--primary fw-btn--sm', () => {
      if (area.value.trim()) callbacks.onDraftUse?.(entry, area.value.trim());
    }),
  );
  panel.appendChild(actions);
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
