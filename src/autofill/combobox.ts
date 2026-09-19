import { containsWords, localeYesNo, normalizeOptionText, sameByAlias } from './aliases';
import { isPressSafe } from './press-guard';

/**
 * Custom dropdowns.
 *
 * Trust boundary: runs in the content script against a page Fillwright does
 * not control. It clicks only option elements inside a list the control owns,
 * and the control itself to open it — never a submit, never a chip's remove
 * button.
 *
 * A growing share of application forms replace `<select>` with a div-based
 * combobox — React Select, Downshift, Radix, Headless UI, Workday prompts, or
 * something hand-rolled. There is no `.value` to set: the options may not
 * exist until the control is opened, some load only after typing, some are
 * virtualised so only the visible rows exist, and some accept several values.
 *
 * So this drives the control the way a person does: open it, read the options,
 * type only if the list needs it, pick the one that matches, and confirm the
 * control now shows it.
 *
 * Privacy: a search box belongs to the page, which can record every keystroke
 * before an option is chosen. Fillwright types nothing when the options are
 * already listed, and otherwise types the shortest prefix that works — at most
 * `MAX_PREFIX` characters of the value — never the whole value.
 *
 * The guiding rule is the same as everywhere else in Fillwright — when the right
 * option is not obvious, do nothing and say so.
 */

export interface ComboboxResult {
  ok: boolean;
  /** What was actually selected (one entry per value), for verification. */
  selected: string[];
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
/** A searchable control may list nothing until typed into; don't wait long. */
const SEARCHABLE_OPEN_MS = 300;
/** How long an async list may take to answer a search. */
const SEARCH_TIMEOUT_MS = 2_500;
/** Characters typed first, and the most ever typed. */
const MIN_PREFIX = 3;
export const MAX_PREFIX = 6;
/** Bounds for virtualised lists. */
const MAX_SCROLL_STEPS = 150;
const SCROLL_SETTLE_MS = 30;
const POLL_MS = 50;

export function isCombobox(element: HTMLElement): boolean {
  if (element instanceof HTMLSelectElement) return false;
  if (element.matches(COMBOBOX_SELECTOR)) return true;
  // A text input owned by a combobox wrapper.
  return Boolean(element.closest(COMBOBOX_SELECTOR));
}

/** Multi-value comboboxes: skills, languages, locations. */
export function isMultiSelect(element: HTMLElement): boolean {
  const control = (element.closest(COMBOBOX_SELECTOR) as HTMLElement | null) ?? element;
  if (control.getAttribute('aria-multiselectable') === 'true') return true;
  const owned = control.getAttribute('aria-controls') ?? control.getAttribute('aria-owns');
  const list = owned ? document.getElementById(owned) : null;
  if (list?.getAttribute('aria-multiselectable') === 'true') return true;
  return /\b(?:multi|react-select--is-multi|select__value-container--is-multi)\b/i.test(
    `${control.className} ${control.parentElement?.className ?? ''}`,
  );
}

/**
 * Selects an option — or, for a multi-select, one option per comma-separated
 * value, adding to what is already chosen and never removing anything.
 */
export async function selectInCombobox(
  element: HTMLElement,
  intended: string,
): Promise<ComboboxResult> {
  const multi = isMultiSelect(element);
  const values = multi
    ? intended
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean)
        .slice(0, 30)
    : [intended.trim()];
  if (values.length === 0 || !values[0]) {
    return { ok: false, selected: [], reason: 'There was no value to select.' };
  }

  const selected: string[] = [];
  const missed: string[] = [];
  for (const value of values) {
    if (multi && alreadyChosen(element, value)) {
      selected.push(value);
      continue;
    }
    const result = await selectOne(element, value);
    if (result.ok) selected.push(result.selected);
    else if (!multi) return { ok: false, selected: [], reason: result.reason };
    else missed.push(value);
  }

  if (selected.length === 0) {
    return {
      ok: false,
      selected: [],
      reason: `None of these could be matched to an option: ${missed.join(', ')}.`,
    };
  }
  return {
    ok: true,
    selected,
    reason: missed.length ? `Not in this list: ${missed.join(', ')}.` : '',
  };
}

async function selectOne(
  element: HTMLElement,
  intended: string,
): Promise<{ ok: boolean; selected: string; reason: string }> {
  const control = (element.closest(COMBOBOX_SELECTOR) as HTMLElement | null) ?? element;
  const search = findSearchInput(control, element);

  let list = await openList(control, element, search ? SEARCHABLE_OPEN_MS : OPEN_TIMEOUT_MS);

  // 1. Whatever is listed already — no typing at all.
  let match = list ? await findInList(list, intended) : null;

  // 2. Async or filtered lists: type the shortest useful prefix.
  if (!match?.option && search) {
    const prefixes = prefixesFor(intended);
    for (const prefix of prefixes) {
      setSearchText(search, prefix);
      list = await waitForOptions(control, SEARCH_TIMEOUT_MS);
      // No results for a prefix means none for anything longer: stop typing.
      if (!list) break;
      match = await findInList(list, intended);
      // Stop as soon as the answer is known — a unique match, or a list that
      // is ambiguous no matter how much more is typed.
      if (match.option || match.final) break;
    }
  }

  if (!list) {
    clearSearch(search);
    closeList(control, element);
    return {
      ok: false,
      selected: '',
      reason: search
        ? `This dropdown found nothing for "${intended}".`
        : 'Fillwright could not open this dropdown safely.',
    };
  }
  if (!match?.option) {
    clearSearch(search);
    closeList(control, element);
    return {
      ok: false,
      selected: '',
      reason: match?.reason ?? `No option in this dropdown matches "${intended}".`,
    };
  }

  const target = await bringIntoDom(list, match.option.label, match.seenAt);
  if (target && !isPressSafe(target)) {
    clearSearch(search);
    closeList(control, element);
    return {
      ok: false,
      selected: '',
      reason: 'That option is also a submit or link control, so Fillwright left it for you.',
    };
  }
  if (!target) {
    clearSearch(search);
    closeList(control, element);
    return { ok: false, selected: '', reason: 'The option moved before it could be chosen.' };
  }
  target.scrollIntoView?.({ block: 'nearest' });
  target.click();

  // Give the widget a tick to commit the selection and close itself.
  await waitFor(() => !isOpen(control), 300);

  // The option's click bubbles up to the control, and most of these widgets
  // toggle open on a control click — so selecting an option can immediately
  // re-open the menu it just closed. If that happened, close it explicitly.
  if (isOpen(control)) {
    closeList(control, element);
    await waitFor(() => !isOpen(control), 200);
  }

  return { ok: true, selected: match.option.label, reason: '' };
}

/**
 * The prefixes to try, shortest first. Starts at the first word (up to
 * MIN_PREFIX characters) and grows one character at a time to MAX_PREFIX.
 */
export function prefixesFor(value: string): string[] {
  const text = value.trim();
  const out: string[] = [];
  for (let length = MIN_PREFIX; length <= Math.min(MAX_PREFIX, text.length); length += 1) {
    out.push(text.slice(0, length));
  }
  if (out.length === 0 && text) out.push(text.slice(0, MAX_PREFIX));
  return out;
}

/* -------------------------------------------------------------- mechanics */

async function openList(
  control: HTMLElement,
  element: HTMLElement,
  timeoutMs: number,
): Promise<HTMLElement | null> {
  const existing = findListbox(control);
  if (existing && readOptions(existing).length > 0) return existing;

  element.focus({ preventScroll: true });
  // A click is what every one of these widgets listens for. The page chose the
  // role, so the press guard decides whether this is really just a toggle.
  if (isPressSafe(control)) control.click();

  let list = await waitForOptions(control, timeoutMs);
  if (list) return list;

  // Some widgets only open on a keyboard event.
  element.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, composed: true }),
  );
  list = await waitForOptions(control, timeoutMs);
  return list;
}

/**
 * Closes a dropdown Fillwright opened.
 *
 * Leaving a menu hanging over the form is a worse outcome than an unfilled
 * field, so this tries the gestures these widgets actually listen for, in
 * increasing order of intrusiveness, and stops as soon as one works.
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

async function waitForOptions(
  control: HTMLElement,
  timeoutMs: number,
): Promise<HTMLElement | null> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const list = findListbox(control);
    if (list && readOptions(list).length > 0) return list;
    if (Date.now() > deadline) return null;
    await sleep(POLL_MS);
  }
}

export interface ComboOption {
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

function isScrollable(list: HTMLElement): boolean {
  return list.scrollHeight > list.clientHeight + 4;
}

/**
 * Reads every option, including the ones a virtualised list has not rendered
 * yet, by scrolling it a bounded number of pages. Records where each label was
 * seen so it can be scrolled back into view, and stops early once an exact
 * match for `intended` has been seen.
 */
async function scanOptions(list: HTMLElement, intended: string): Promise<Map<string, number>> {
  const seenAt = new Map<string, number>();
  const target = intended.trim().toLowerCase();
  const collect = () => {
    let exact = false;
    for (const option of readOptions(list)) {
      if (!seenAt.has(option.label)) seenAt.set(option.label, list.scrollTop);
      if (option.label.toLowerCase() === target) exact = true;
    }
    return exact;
  };
  if (collect() || !isScrollable(list)) return seenAt;

  const start = list.scrollTop;
  let previous = -1;
  for (let step = 0; step < MAX_SCROLL_STEPS && list.scrollTop !== previous; step += 1) {
    previous = list.scrollTop;
    scrollTo(list, previous + Math.max(40, list.clientHeight - 20));
    await sleep(SCROLL_SETTLE_MS);
    if (collect()) return seenAt;
  }
  scrollTo(list, start);
  await sleep(SCROLL_SETTLE_MS);
  return seenAt;
}

function scrollTo(list: HTMLElement, top: number): void {
  list.scrollTop = top;
  // Native scroll events are asynchronous; virtual lists render on them.
  list.dispatchEvent(new Event('scroll'));
}

/** Scrolls a (possibly virtualised) list back to where `label` was seen. */
async function bringIntoDom(
  list: HTMLElement,
  label: string,
  seenAt: Map<string, number>,
): Promise<HTMLElement | null> {
  const find = () => readOptions(list).find((option) => option.label === label)?.element ?? null;
  const found = find();
  if (found) return found;
  const top = seenAt.get(label);
  if (top === undefined) return null;
  scrollTo(list, top);
  await sleep(SCROLL_SETTLE_MS);
  return find();
}

async function findInList(
  list: HTMLElement,
  intended: string,
): Promise<{
  option: ComboOption | null;
  reason: string;
  final: boolean;
  seenAt: Map<string, number>;
}> {
  const seenAt = await scanOptions(list, intended);
  const pseudo = [...seenAt.keys()].map((label) => ({ element: list, label }));
  const picked = pickOption(pseudo, intended);
  return {
    option: picked.option,
    reason: picked.reason,
    // Several exact or alias matches cannot be narrowed by typing more.
    final: picked.option !== null || /identical|several/i.test(picked.reason),
    seenAt,
  };
}

function findSearchInput(control: HTMLElement, element: HTMLElement): HTMLInputElement | null {
  const candidates = [
    element instanceof HTMLInputElement ? element : null,
    control instanceof HTMLInputElement ? control : null,
    control.querySelector<HTMLInputElement>('input:not([type="hidden"])'),
  ];
  for (const input of candidates) {
    if (input && input.type !== 'hidden' && !input.readOnly && !input.disabled) return input;
  }
  return null;
}

function setSearchText(input: HTMLInputElement, value: string): void {
  const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
  input.focus({ preventScroll: true });
  if (descriptor?.set) descriptor.set.call(input, value);
  else input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
}

/** Leaves no half-typed prefix behind when nothing was chosen. */
function clearSearch(input: HTMLInputElement | null): void {
  if (input && input.value) setSearchText(input, '');
}

function alreadyChosen(element: HTMLElement, value: string): boolean {
  const container = (element.closest(COMBOBOX_SELECTOR) as HTMLElement | null)?.parentElement;
  const chips = Array.from(
    (container ?? element.parentElement ?? element).querySelectorAll<HTMLElement>(
      '[class*="multi-value"], [class*="chip"], [class*="tag"], [data-automation-id="selectedItem"], [aria-selected="true"]',
    ),
  );
  const target = normalizeOptionText(value);
  return chips.some((chip) => normalizeOptionText(chip.textContent ?? '') === target);
}

/**
 * Chooses the option to click.
 *
 * Exact first, then a known alias (countries, degrees, months), then a unique
 * containment match. An ambiguous match returns nothing on purpose: "Bachelor"
 * fitting both "Bachelor of Arts" and "Bachelor of Science" is a coin flip, and
 * a coin flip does not belong on a job application.
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

  const aliased = options.filter((option) => sameByAlias(option.label, intended));
  if (aliased.length === 1) return { option: aliased[0]!, reason: '' };
  if (aliased.length > 1) {
    return {
      option: null,
      reason: `Several options mean "${intended}" — please pick one yourself.`,
    };
  }

  const yesNo = matchYesNo(options, target);
  if (yesNo) return { option: yesNo, reason: '' };

  const contained = options.filter((option) => containsWords(option.label, intended));
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
      const translated = localeYesNo(label);
      return wantYes
        ? YES_RE.test(label) || translated === 'yes'
        : NO_RE.test(label) || translated === 'no';
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
