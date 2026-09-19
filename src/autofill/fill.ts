import type { FillOutcome, FillPlanEntry } from '@/types/fields';
import { isCombobox, selectInCombobox } from './combobox';
import { ariaOptionValue, obscuredBy } from '@/field-detection/harvest';
import { isPressSafe } from './press-guard';

/**
 * Writes values into form controls.
 *
 * The hard part is not setting `.value` — it is making the page believe a human
 * did it. React, Vue and Angular all track input state internally and will
 * happily discard a value assigned directly, or fail to run the validation that
 * the Submit button depends on. So every write goes through the native property
 * setter and then dispatches the same event sequence a real keystroke produces.
 *
 * What this module will never do: click a button, submit a form, or touch a
 * file input. Those are the user's, always.
 */

export interface FillContext {
  /** Field id to the element(s) backing it, from the harvester. */
  elements: Map<string, HTMLElement[]>;
  highlight: boolean;
}

/** Recorded before every write, so the whole fill can be reversed. */
export interface UndoRecord {
  fieldId: string;
  elements: HTMLElement[];
  previousValue: string;
  /** For radio groups: which member was checked, if any. */
  previousCheckedValue: string | null;
}

export interface FillResult {
  outcomes: FillOutcome[];
  undo: UndoRecord[];
}

const HIGHLIGHT_CLASS = 'fillwright-filled';
const HIGHLIGHT_MS = 2600;

export async function fillFields(
  entries: FillPlanEntry[],
  context: FillContext,
): Promise<FillResult> {
  const outcomes: FillOutcome[] = [];
  const undo: UndoRecord[] = [];

  for (const entry of entries) {
    if (!entry.selected) continue;

    const elements = context.elements.get(entry.fieldId);
    // A detached element means the form moved on (a new step, a re-render).
    // Writing into it would do nothing visible — or, worse, fill a step the
    // user has already left — so it is reported instead.
    if (!elements?.length || elements.every((element) => !element.isConnected)) {
      outcomes.push({
        fieldId: entry.fieldId,
        ok: false,
        previousValue: '',
        error: 'This field is no longer on the page. Scan again to pick up the current step.',
      });
      continue;
    }

    // The scan judged this field visible, but a page can still lay something
    // over it. Only what a person would actually see there gets a value.
    const covered = coveredReason(elements);
    if (covered) {
      outcomes.push({
        fieldId: entry.fieldId,
        ok: false,
        previousValue: '',
        error: `Not filled: this field is ${covered}. It may be a trap for bots.`,
      });
      continue;
    }

    try {
      const record = snapshot(entry.fieldId, elements);
      const wrote = await writeValue(elements, entry.newValue);
      if (!wrote) {
        outcomes.push({
          fieldId: entry.fieldId,
          ok: false,
          previousValue: record.previousValue,
          error: 'Fillwright could not find a matching option in this control.',
        });
        continue;
      }

      // Verify rather than assume. A framework can reject or rewrite a value
      // immediately after it is set — a controlled input reverting it, an input
      // mask reformatting it, a maxlength truncating it. Reporting success
      // because the write call returned would be a lie the user only discovers
      // after submitting.
      const verdict = verify(elements, entry.newValue);
      if (!verdict.ok) {
        // Put back what was there, so a rejected write leaves no trace.
        try {
          await writeValue(record.elements, record.previousCheckedValue ?? record.previousValue);
        } catch {
          /* Restoring is best-effort; the outcome below still reports failure. */
        }
        outcomes.push({
          fieldId: entry.fieldId,
          ok: false,
          previousValue: record.previousValue,
          error: verdict.reason,
        });
        continue;
      }

      undo.push(record);
      outcomes.push({ fieldId: entry.fieldId, ok: true, previousValue: record.previousValue });
      if (context.highlight) flash(elements[0]!);
    } catch (cause) {
      outcomes.push({
        fieldId: entry.fieldId,
        ok: false,
        previousValue: '',
        error: cause instanceof Error ? cause.message : 'Could not fill this field',
      });
    }
  }

  restoreScroll(scrolledFrom);
  return { outcomes, undo };
}

/** Page scroll before the presence check moved it, restored after the fill. */
let scrolledFrom: { x: number; y: number } | null = null;

function restoreScroll(from: { x: number; y: number } | null): void {
  scrolledFrom = null;
  if (from) window.scrollTo({ left: from.x, top: from.y, behavior: 'instant' });
}

/**
 * Null when at least one of the field's elements (or its label) is what sits
 * at its position; otherwise why not. A control outside the viewport is
 * scrolled to first, because the hit test only sees the viewport.
 */
function coveredReason(elements: HTMLElement[]): string | null {
  const doc = elements[0]?.ownerDocument;
  if (!doc || typeof doc.elementsFromPoint !== 'function') return null;
  let reason: string | null = null;
  for (const element of elements) {
    if (!element.isConnected) continue;
    const rect = element.getBoundingClientRect();
    // Nothing to test against (no layout); the scan already judged the box.
    if (rect.width === 0 && rect.height === 0) return null;
    const view = doc.defaultView ?? window;
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    if (cx < 0 || cy < 0 || cx > view.innerWidth || cy > view.innerHeight) {
      scrolledFrom ??= { x: view.scrollX, y: view.scrollY };
      element.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
    }
    const found = obscuredBy(element);
    if (!found) return null;
    reason = found;
  }
  return reason;
}

/** Restores every value captured by the matching fill. */
export async function undoFill(records: UndoRecord[]): Promise<number> {
  let restored = 0;
  for (const record of records) {
    try {
      if (record.previousCheckedValue !== null) {
        await writeValue(record.elements, record.previousCheckedValue);
      } else {
        await writeValue(record.elements, record.previousValue);
      }
      restored++;
    } catch {
      // A field that has since been removed cannot be restored; keep going so
      // one stale element does not abandon the rest of the undo.
    }
  }
  return restored;
}

/* -------------------------------------------------------------- verifying */

interface Verdict {
  ok: boolean;
  reason: string;
}

/**
 * Confirms the page actually accepted what was written.
 *
 * Comparison is forgiving about presentation but strict about content: an input
 * mask that turns "9845012345" into "(984) 501-2345" has accepted the value,
 * while a control that silently reverted to empty has not.
 */
/** What a combobox reported selecting, for the verification that follows. */
const comboSelections = new WeakMap<HTMLElement, string[]>();

export function verify(elements: HTMLElement[], intended: string): Verdict {
  const first = elements[0]!;

  // A combobox shows its selection as text somewhere in the control rather than
  // in a `value`, so the whole control is checked for it.
  if (!(first instanceof HTMLSelectElement) && isCombobox(first)) {
    // Widgets show the choice beside the input (a chip, a single-value div),
    // so the control and its immediate container are both read.
    const control = (first.closest('[role="combobox"], [aria-haspopup="listbox"]') ??
      first) as HTMLElement;
    const shown = normalizeForCompare(
      `${currentValue(first)} ${control.textContent ?? ''} ${control.parentElement?.textContent ?? ''}`,
    );
    const expected = comboSelections.get(first) ?? [intended];
    return expected.every((label) => shown.includes(normalizeForCompare(label)))
      ? { ok: true, reason: '' }
      : { ok: false, reason: 'The dropdown did not keep the selection.' };
  }

  if (first instanceof HTMLInputElement && first.type === 'radio') {
    const checked = elements.find((element) => (element as HTMLInputElement).checked) as
      HTMLInputElement | undefined;
    if (!checked) return { ok: false, reason: 'The page did not accept the selection.' };
    return matches(checked.value, intended) || matches(labelTextOf(checked), intended)
      ? { ok: true, reason: '' }
      : { ok: false, reason: 'A different option ended up selected.' };
  }

  if (isAriaRadio(first)) {
    const checked = elements.find((element) => element.getAttribute('aria-checked') === 'true');
    if (!checked) return { ok: false, reason: 'The page did not accept the selection.' };
    return matches(ariaOptionValue(checked), intended)
      ? { ok: true, reason: '' }
      : { ok: false, reason: 'A different option ended up selected.' };
  }

  if (first instanceof HTMLInputElement && first.type === 'checkbox') {
    const shouldCheck = /^(?:yes|true|on|1|checked)$/i.test(intended.trim());
    return first.checked === shouldCheck
      ? { ok: true, reason: '' }
      : { ok: false, reason: 'The page did not accept the change.' };
  }

  if (first instanceof HTMLSelectElement) {
    const selected = first.selectedOptions[0];
    if (!selected || selected.value === '') {
      return { ok: false, reason: 'The dropdown did not keep the selection.' };
    }
    return matches(selected.value, intended) || matches(selected.text, intended)
      ? { ok: true, reason: '' }
      : { ok: false, reason: 'The dropdown selected something else.' };
  }

  const actual = currentValue(first);
  if (actual === '') {
    return {
      ok: false,
      reason: 'The page cleared the value straight after it was entered.',
    };
  }
  if (matches(actual, intended)) return { ok: true, reason: '' };

  // A field that reformatted or truncated the value still accepted it.
  if (normalizeForCompare(actual).startsWith(normalizeForCompare(intended).slice(0, 6))) {
    return { ok: true, reason: '' };
  }
  if (normalizeForCompare(intended).startsWith(normalizeForCompare(actual)) && actual.length > 2) {
    return { ok: true, reason: '' };
  }

  return { ok: false, reason: 'The page changed the value after it was entered.' };
}

function matches(actual: string, intended: string): boolean {
  return normalizeForCompare(actual) === normalizeForCompare(intended);
}

/** Ignores case, spacing and punctuation that controls add for display. */
function normalizeForCompare(value: string): string {
  return value.toLowerCase().replace(/[\s()\-.+/]/g, '');
}

function labelTextOf(element: HTMLInputElement): string {
  return (element.labels?.[0]?.textContent ?? '').trim();
}

/* ------------------------------------------------------------------ writing */

function snapshot(fieldId: string, elements: HTMLElement[]): UndoRecord {
  const first = elements[0]!;
  if (first instanceof HTMLInputElement && first.type === 'radio') {
    const checked = elements.find((element) => (element as HTMLInputElement).checked);
    return {
      fieldId,
      elements,
      previousValue: (checked as HTMLInputElement | undefined)?.value ?? '',
      previousCheckedValue: (checked as HTMLInputElement | undefined)?.value ?? '',
    };
  }
  if (isAriaRadio(first)) {
    const checked = elements.find((element) => element.getAttribute('aria-checked') === 'true');
    const previous = checked ? ariaOptionValue(checked) : '';
    return { fieldId, elements, previousValue: previous, previousCheckedValue: previous };
  }
  return { fieldId, elements, previousValue: currentValue(first), previousCheckedValue: null };
}

function currentValue(element: HTMLElement): string {
  if (element instanceof HTMLSelectElement) return element.value;
  if (element instanceof HTMLInputElement) {
    return element.type === 'checkbox'
      ? element.checked
        ? element.value || 'on'
        : ''
      : element.value;
  }
  if (element instanceof HTMLTextAreaElement) return element.value;
  if (element.isContentEditable) return element.textContent ?? '';
  return '';
}

async function writeValue(elements: HTMLElement[], value: string): Promise<boolean> {
  const first = elements[0]!;

  // A custom dropdown has no value to set: it has to be opened and clicked
  // through, like a person would. Checked before the plain-input branch because
  // these widgets are usually built around a text input.
  if (!(first instanceof HTMLSelectElement) && isCombobox(first)) {
    const result = await selectInCombobox(first, value);
    if (!result.ok) throw new Error(result.reason);
    comboSelections.set(first, result.selected);
    return true;
  }

  if (first instanceof HTMLInputElement && first.type === 'radio') {
    return setRadioGroup(elements as HTMLInputElement[], value);
  }
  if (isAriaRadio(first)) {
    return setAriaRadioGroup(elements, value);
  }
  if (first instanceof HTMLInputElement && first.type === 'checkbox') {
    return setCheckbox(first, value);
  }
  if (first instanceof HTMLSelectElement) {
    return setSelect(first, value);
  }
  if (first instanceof HTMLInputElement || first instanceof HTMLTextAreaElement) {
    // A file input cannot be set programmatically, and Fillwright does not try.
    if (first instanceof HTMLInputElement && first.type === 'file') return false;
    setNativeValue(first, value);
    return true;
  }
  if (first.isContentEditable) {
    setContentEditable(first, value);
    return true;
  }
  return false;
}

/**
 * Sets a value through the element's native property setter.
 *
 * React installs its own `value` setter on the input instance to track state.
 * Assigning `element.value = x` hits that shadowing setter and React never sees
 * the change, so the value is reverted on the next render. Calling the
 * prototype's setter directly updates the DOM underneath React, and the `input`
 * event that follows is what makes React adopt it.
 */
export function setNativeValue(
  element: HTMLInputElement | HTMLTextAreaElement,
  value: string,
): void {
  const prototype =
    element instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value');

  element.focus({ preventScroll: true });

  if (descriptor?.set) descriptor.set.call(element, value);
  else element.value = value;

  dispatchInputEvents(element);
  element.blur();
}

function setSelect(element: HTMLSelectElement, value: string): boolean {
  const target = Array.from(element.options).find(
    (option) => option.value === value || option.text.trim() === value.trim(),
  );
  if (!target) return false;

  const descriptor = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');
  element.focus({ preventScroll: true });
  if (descriptor?.set) descriptor.set.call(element, target.value);
  else element.value = target.value;

  dispatchInputEvents(element);
  element.blur();
  return true;
}

function isAriaRadio(element: HTMLElement): boolean {
  return (
    !(element instanceof HTMLInputElement) &&
    element.getAttribute('role') === 'radio' &&
    element.closest('[role="radiogroup"]') !== null
  );
}

/**
 * Selects an option in a button-based radio group by pressing it, as a person
 * would. Only elements with role="radio" inside a role="radiogroup" are ever
 * pressed — never a generic button.
 */
function setAriaRadioGroup(members: HTMLElement[], value: string): boolean {
  const target = members.find((member) => matches(ariaOptionValue(member), value));
  if (!target || !isAriaRadio(target) || !isPressSafe(target)) return false;
  if (target.getAttribute('aria-checked') === 'true') return true;
  target.focus({ preventScroll: true });
  target.click();
  target.blur();
  return true;
}

function setRadioGroup(members: HTMLInputElement[], value: string): boolean {
  const target = members.find(
    (member) =>
      member.value === value || (member.labels?.[0]?.textContent ?? '').trim() === value.trim(),
  );
  if (!target) return false;
  if (target.checked) return true;

  target.focus({ preventScroll: true });
  // click() drives the browser's own checked/unchecked bookkeeping for the
  // whole group, which setting `.checked` directly does not.
  target.click();
  if (!target.checked) {
    target.checked = true;
    dispatchInputEvents(target);
  }
  target.blur();
  return true;
}

function setCheckbox(element: HTMLInputElement, value: string): boolean {
  const shouldCheck = /^(?:yes|true|on|1|checked)$/i.test(value.trim());
  if (element.checked === shouldCheck) return true;
  element.focus({ preventScroll: true });
  element.click();
  if (element.checked !== shouldCheck) {
    element.checked = shouldCheck;
    dispatchInputEvents(element);
  }
  element.blur();
  return true;
}

/**
 * Writes into a contenteditable.
 *
 * `textContent` is used rather than `innerHTML`: the value may have come from a
 * resume, and inserting it as markup would turn stored text into live DOM.
 */
function setContentEditable(element: HTMLElement, value: string): void {
  element.focus({ preventScroll: true });
  element.textContent = value;
  dispatchInputEvents(element);
  element.blur();
}

/**
 * The event sequence a real edit produces.
 *
 * `input` drives framework state, `change` drives validation and dependent
 * fields, and the key events make listeners that debounce on typing fire.
 */
function dispatchInputEvents(element: HTMLElement): void {
  element.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
  element.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
  // Some autocomplete widgets only react to key events.
  element.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, composed: true }));
}

/* --------------------------------------------------------------- highlight */

let styleInjected = false;

function flash(element: HTMLElement): void {
  injectHighlightStyle(element.ownerDocument);
  element.classList.add(HIGHLIGHT_CLASS);
  setTimeout(() => element.classList.remove(HIGHLIGHT_CLASS), HIGHLIGHT_MS);
}

function injectHighlightStyle(doc: Document): void {
  if (styleInjected || doc.getElementById('fillwright-highlight-style')) return;
  styleInjected = true;
  const style = doc.createElement('style');
  style.id = 'fillwright-highlight-style';
  style.setAttribute('data-fillwright-ui', '');
  // textContent, not innerHTML — this is a stylesheet, not markup.
  style.textContent = `
    .${HIGHLIGHT_CLASS} {
      animation: fillwright-flash ${HIGHLIGHT_MS}ms ease-out;
    }
    @keyframes fillwright-flash {
      0%   { box-shadow: 0 0 0 3px rgba(75, 62, 207, 0.45); }
      100% { box-shadow: 0 0 0 3px rgba(75, 62, 207, 0); }
    }
    @media (prefers-reduced-motion: reduce) {
      .${HIGHLIGHT_CLASS} { animation: none; outline: 2px solid rgba(75, 62, 207, 0.6); }
    }
  `;
  doc.head?.appendChild(style);
}
