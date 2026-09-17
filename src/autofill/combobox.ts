/**
 * Custom dropdowns.
 *
 * A growing share of application forms replace `<select>` with a div-based
 * combobox — React Select, Downshift, Radix, Headless UI, or something
 * hand-rolled. There is no `.value` to set: the options do not exist in the DOM
 * until the control is opened, and selection happens through a click or a
 * keyboard sequence the widget listens for.
 *
 * So this drives the control the way a person does: open it, read the options
 * that appear, pick the one that matches, and confirm the control now shows it.
 *
 * The guiding rule is the same as everywhere else in Fillwright — when the right
 * option is not obvious, do nothing and say so. Selecting a plausible-looking
 * wrong option on a job application is worse than leaving it for the user.
 */

export interface ComboboxResult {
  ok: boolean;
  /** What was actually selected, for verification. */
  selected: string;
  reason: string;
}

/** Roles and attributes that mark a div-based dropdown. */
const COMBOBOX_SELECTOR =
  '[role="combobox"], [aria-haspopup="listbox"], [aria-autocomplete="list"], .select__control, .react-select__control';

const OPTION_SELECTOR =
  '[role="option"], li[id*="option"], .select__option, .react-select__option, [data-radix-collection-item]';

const LISTBOX_SELECTOR =
  '[role="listbox"], .select__menu, .react-select__menu, [data-radix-popper-content-wrapper]';

/** How long to wait for an options list to appear after opening. */
const OPEN_TIMEOUT_MS = 700;
const POLL_MS = 50;

export function isCombobox(element: HTMLElement): boolean {
  if (element instanceof HTMLSelectElement) return false;
  if (element.matches(COMBOBOX_SELECTOR)) return true;
  // A text input owned by a combobox wrapper.
  return Boolean(element.closest(COMBOBOX_SELECTOR));
}

/**
 * Selects an option in a custom dropdown.
 *
 * Deliberately asynchronous: these widgets render their options after a tick,
 * and pretending otherwise is why naive implementations select nothing.
 */
export async function selectInCombobox(
  element: HTMLElement,
  intended: string,
): Promise<ComboboxResult> {
  const control = (element.closest(COMBOBOX_SELECTOR) as HTMLElement | null) ?? element;

  const opened = await openList(control, element);
  if (!opened) {
    return {
      ok: false,
      selected: '',
      reason: 'Fillwright could not open this dropdown safely.',
    };
  }

  // Typing filters the list on searchable comboboxes and is harmless on others.
  const search = findSearchInput(control);
  if (search) {
    setSearchText(search, intended);
    await waitFor(() => readOptions(opened).length > 0, 400);
  }

  const options = readOptions(opened);
  if (options.length === 0) {
    closeList(control, element);
    return { ok: false, selected: '', reason: 'This dropdown showed no options to choose from.' };
  }

  const match = pickOption(options, intended);
  if (!match.option) {
    closeList(control, element);
    return { ok: false, selected: '', reason: match.reason };
  }

  match.option.element.scrollIntoView?.({ block: 'nearest' });
  match.option.element.click();

  // Give the widget a tick to commit the selection and close itself.
  await waitFor(() => !isOpen(control), 300);

  // The option's click bubbles up to the control, and most of these widgets
  // toggle open on a control click — so selecting an option can immediately
  // re-open the menu it just closed, leaving it hanging over the form. If that
  // happened, close it explicitly.
  if (isOpen(control)) {
    closeList(control, element);
    await waitFor(() => !isOpen(control), 200);
  }

  return { ok: true, selected: match.option.label, reason: '' };
}

/* -------------------------------------------------------------- mechanics */

async function openList(control: HTMLElement, element: HTMLElement): Promise<HTMLElement | null> {
  const existing = findListbox(control);
  if (existing) return existing;

  element.focus({ preventScroll: true });
  // A click is what every one of these widgets listens for. It is a dropdown
  // toggle, never a submit control — `isCombobox` has already established that.
  control.click();

  let list = await waitForListbox(control);
  if (list) return list;

  // Some widgets only open on a keyboard event.
  element.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, composed: true }),
  );
  list = await waitForListbox(control);
  return list;
}

/**
 * Closes a dropdown Fillwright opened.
 *
 * Leaving a menu hanging over the form is a worse outcome than an unfilled
 * field, so this tries the three gestures these widgets actually listen for,
 * in increasing order of intrusiveness, and stops as soon as one works.
 */
function closeList(control: HTMLElement, element: HTMLElement): void {
  element.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, composed: true }),
  );
  if (!isOpen(control)) return;

  // Most of these libraries close on an outside press rather than on Escape.
  document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  if (!isOpen(control)) return;

  (document.activeElement as HTMLElement | null)?.blur?.();
}

/**
 * Whether THIS control is open.
 *
 * Scoped to the control on purpose: `findListbox` falls back to a document-wide
 * search so it can locate portal-rendered menus, and reusing that here would
 * report a control as open because some other widget on the page has a menu up.
 */
function isOpen(control: HTMLElement): boolean {
  if (control.getAttribute('aria-expanded') === 'true') return true;

  const owned = control.getAttribute('aria-controls') ?? control.getAttribute('aria-owns');
  if (owned && document.getElementById(owned)) return true;

  return (
    control.querySelector(LISTBOX_SELECTOR) !== null ||
    control.parentElement?.querySelector(LISTBOX_SELECTOR) != null
  );
}

/**
 * Finds the options list.
 *
 * These widgets frequently render the list in a portal at the end of `<body>`
 * rather than inside the control, so a search scoped to the control alone
 * misses it. The document-level fallback is deliberately last and takes the
 * most recently rendered list.
 */
function findListbox(control: HTMLElement): HTMLElement | null {
  const owned = control.getAttribute('aria-controls') ?? control.getAttribute('aria-owns');
  if (owned) {
    const byId = document.getElementById(owned);
    if (byId) return byId;
  }

  const inside = control.querySelector<HTMLElement>(LISTBOX_SELECTOR);
  if (inside) return inside;

  const siblings = control.parentElement?.querySelector<HTMLElement>(LISTBOX_SELECTOR);
  if (siblings) return siblings;

  const portals = Array.from(document.querySelectorAll<HTMLElement>(LISTBOX_SELECTOR)).filter(
    (node) => node.getClientRects().length > 0,
  );
  return portals[portals.length - 1] ?? null;
}

async function waitForListbox(control: HTMLElement): Promise<HTMLElement | null> {
  const deadline = Date.now() + OPEN_TIMEOUT_MS;
  for (;;) {
    const list = findListbox(control);
    if (list && readOptions(list).length > 0) return list;
    if (Date.now() > deadline) return null;
    await sleep(POLL_MS);
  }
}

interface ComboOption {
  element: HTMLElement;
  label: string;
}

function readOptions(list: HTMLElement): ComboOption[] {
  return Array.from(list.querySelectorAll<HTMLElement>(OPTION_SELECTOR))
    .filter((node) => node.getAttribute('aria-disabled') !== 'true')
    .slice(0, 300)
    .map((node) => ({ element: node, label: (node.textContent ?? '').replace(/\s+/g, ' ').trim() }))
    .filter((option) => option.label.length > 0);
}

function findSearchInput(control: HTMLElement): HTMLInputElement | null {
  const input = control.querySelector<HTMLInputElement>('input:not([type="hidden"])');
  if (input && !input.readOnly && !input.disabled) return input;
  return null;
}

function setSearchText(input: HTMLInputElement, value: string): void {
  const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
  input.focus({ preventScroll: true });
  if (descriptor?.set) descriptor.set.call(input, value);
  else input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
}

/**
 * Chooses the option to click.
 *
 * Exact first, then a unique containment match. An ambiguous match returns
 * nothing on purpose: "Bachelor" fitting both "Bachelor of Arts" and "Bachelor
 * of Science" is a coin flip, and a coin flip does not belong on a job
 * application.
 */
export function pickOption(
  options: ComboOption[],
  intended: string,
): { option: ComboOption | null; reason: string } {
  const target = intended.trim().toLowerCase();
  if (!target) return { option: null, reason: 'There was no value to select.' };

  const exact = options.filter((option) => option.label.toLowerCase() === target);
  if (exact.length === 1) return { option: exact[0]!, reason: '' };
  if (exact.length > 1) {
    return { option: null, reason: 'This dropdown has several identical options.' };
  }

  const yesNo = matchYesNo(options, target);
  if (yesNo) return { option: yesNo, reason: '' };

  const contained = options.filter((option) => {
    const label = option.label.toLowerCase();
    return label.includes(target) || target.includes(label);
  });
  if (contained.length === 1) return { option: contained[0]!, reason: '' };
  if (contained.length > 1) {
    return {
      option: null,
      reason: `Several options could match "${intended}" — please pick one yourself.`,
    };
  }

  return { option: null, reason: `No option in this dropdown matches "${intended}".` };
}

const YES_RE = /^(?:yes|y|true|i am|i do)$/i;
const NO_RE = /^(?:no|n|false|i am not|i do not)$/i;

function matchYesNo(options: ComboOption[], target: string): ComboOption | null {
  if (!YES_RE.test(target) && !NO_RE.test(target)) return null;
  const wantYes = YES_RE.test(target);
  return (
    options.find((option) => {
      const label = option.label.toLowerCase();
      return wantYes ? YES_RE.test(label) : NO_RE.test(label);
    }) ?? null
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((done) => setTimeout(done, ms));
}

async function waitFor(predicate: () => boolean, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (predicate()) return true;
    if (Date.now() > deadline) return false;
    await sleep(POLL_MS);
  }
}
