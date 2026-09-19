import { isPressSafe } from '@/autofill/press-guard';

/**
 * Site adapters.
 *
 * The generic detector handles the great majority of application forms, so
 * adapters exist only to work around specific structural quirks — a section
 * that must be expanded before its fields exist, a container that holds the
 * real form. They are deliberately limited in what they are allowed to do:
 *
 *   - they MAY expand or reveal parts of the page so fields become visible;
 *   - they MAY name the container the form lives in;
 *   - they MAY NOT supply values, change a mapping, alter a confidence score,
 *     or bypass any safety rule — everything they surface still goes through
 *     the same classifier and the same review step;
 *   - they MAY NOT click a submit or apply control.
 *
 * That boundary matters: it means adding an adapter can never weaken the
 * product's guarantees, so adapters stay cheap to write and cheap to review.
 */

export interface SiteAdapter {
  id: string;
  label: string;
  /** Hostname patterns this adapter applies to. */
  matches: RegExp;
  /**
   * Selectors for controls that reveal more of the form (an "Add education"
   * button, a collapsed accordion). Clicked once each, before scanning.
   */
  expandSelectors?: string[];
  /** Milliseconds to wait after expanding, for the framework to render. */
  settleMs?: number;
  /** Notes shown in the docs; not used at runtime. */
  notes?: string;
}

export const ADAPTERS: SiteAdapter[] = [
  {
    id: 'greenhouse',
    label: 'Greenhouse',
    matches: /(?:^|\.)greenhouse\.io$|(?:^|\.)boards\.greenhouse\.io$/i,
    notes: 'Standard labelled inputs; the generic detector handles these well.',
  },
  {
    id: 'lever',
    label: 'Lever',
    matches: /(?:^|\.)lever\.co$|(?:^|\.)jobs\.lever\.co$/i,
    notes: 'Relies on name attributes and placeholders rather than <label> elements.',
  },
  {
    id: 'ashby',
    label: 'Ashby',
    matches: /(?:^|\.)ashbyhq\.com$/i,
    expandSelectors: ['button[aria-expanded="false"]'],
    settleMs: 350,
  },
  {
    id: 'workday',
    label: 'Workday',
    matches: /(?:^|\.)myworkdayjobs\.com$|(?:^|\.)workday\.com$/i,
    // Workday's "Add" buttons create a new, empty entry block. They are never
    // clicked here — doing so on every scan would add a block per rescan.
    // Adding entries is an explicit user action (see autofill/repeat.ts).
    expandSelectors: ['button[aria-expanded="false"]'],
    settleMs: 600,
    notes: 'Uses aria-labelledby rather than <label>, and ids containing colons and brackets.',
  },
  {
    id: 'smartrecruiters',
    label: 'SmartRecruiters',
    matches: /(?:^|\.)smartrecruiters\.com$/i,
    expandSelectors: ['button[aria-expanded="false"]'],
    settleMs: 350,
  },
  {
    id: 'icims',
    label: 'iCIMS',
    matches: /(?:^|\.)icims\.com$/i,
    notes: 'Renders the application inside a same-origin iframe; the script is injected per frame.',
  },
  {
    id: 'taleo',
    label: 'Taleo',
    matches: /(?:^|\.)taleo\.net$/i,
    notes: 'Older markup with table layouts; labels are usually adjacent cells.',
  },
  {
    id: 'workable',
    label: 'Workable',
    matches: /(?:^|\.)workable\.com$/i,
  },
  {
    id: 'linkedin',
    label: 'LinkedIn Easy Apply',
    matches: /(?:^|\.)linkedin\.com$/i,
    settleMs: 400,
    notes: 'Multi-step modal; the mutation observer picks up each step.',
  },
];

export function detectAdapter(url: string): SiteAdapter | null {
  let hostname: string;
  try {
    hostname = new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
  return ADAPTERS.find((adapter) => adapter.matches.test(hostname)) ?? null;
}

/**
 * Elements an adapter has already pressed on this page. A dropdown or an
 * accordion goes back to aria-expanded="false" when it closes, so without this
 * every rescan would press it again.
 */
let pressed = new WeakSet<HTMLElement>();

/** For tests: forget what has been pressed, as a fresh page load would. */
export function resetAdapterPresses(): void {
  pressed = new WeakSet<HTMLElement>();
}

const CONTROLS =
  'input, select, textarea, [contenteditable="true"], [role="combobox"], [role="textbox"]';

function countControls(): number {
  return document.querySelectorAll(CONTROLS).length;
}

/**
 * Runs an adapter's preparation step.
 *
 * Callers must only invoke this on an explicit activation by the user — never
 * from a quiet or passive scan. Only accordion-like elements that are visible,
 * enabled and collapsed are pressed, each at most once per page, and never
 * anything that looks like a submit control. If a press reveals no new form
 * controls, the remaining matches of that selector are left alone: they are
 * evidently not what the adapter was looking for.
 */
export async function applyAdapter(adapter: SiteAdapter): Promise<void> {
  if (!adapter.expandSelectors?.length) return;
  const wait = Math.min(adapter.settleMs ?? 0, 150);
  let pressedAny = false;

  for (const selector of adapter.expandSelectors) {
    let candidates: NodeListOf<HTMLElement>;
    try {
      candidates = document.querySelectorAll<HTMLElement>(selector);
    } catch {
      continue;
    }

    for (const element of Array.from(candidates).slice(0, 20)) {
      if (pressed.has(element) || !element.isConnected) continue;
      if (!isSafeToExpand(element)) continue;
      pressed.add(element);
      const before = countControls();
      try {
        element.click();
      } catch {
        /* A page may throw from its own handler; that is not our problem. */
      }
      pressedAny = true;
      if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
      if (countControls() <= before) break;
    }
  }

  if (pressedAny && adapter.settleMs) {
    await new Promise((resolve) => setTimeout(resolve, adapter.settleMs));
  }
}

/** Containers whose buttons are menus or navigation, never form sections. */
const NOT_A_FORM_SECTION =
  'nav, header, [role="navigation"], [role="banner"], [role="menu"], [role="menubar"], [role="toolbar"], [role="listbox"], [role="tablist"]';

/**
 * Accordion semantics: the element controls a region that exists on the page,
 * or it is the disclosure button of a heading.
 */
function isAccordion(element: HTMLElement): boolean {
  const controls = (element.getAttribute('aria-controls') ?? '').trim();
  if (controls) {
    const ids = controls.split(/\s+/);
    if (ids.some((id) => element.ownerDocument.getElementById(id) !== null)) return true;
  }
  const parent = element.parentElement;
  if (!parent) return false;
  return /^H[1-6]$/.test(parent.tagName) || parent.getAttribute('role') === 'heading';
}

/**
 * The base press guard shared by adapters and the explicit "add another entry"
 * action: visible, enabled, collapsed-or-plain, and nothing that could submit,
 * apply, delete or navigate.
 */
export function isSafeToPress(element: HTMLElement): boolean {
  if (!isPressSafe(element)) return false;
  if (element.closest('[data-fillwright-ui]')) return false;
  // A <button> with no explicit type defaults to type="submit", so checking the
  // type alone would refuse almost every expander. What actually matters is
  // whether pressing it could submit something: a submit button owned by a form.
  if (element instanceof HTMLButtonElement && element.type === 'submit' && element.form)
    return false;
  if (element instanceof HTMLInputElement) return false;
  if (element.getAttribute('aria-expanded') === 'true') return false;
  if ((element as HTMLButtonElement).disabled) return false;
  if (element.getClientRects().length === 0) return false;

  const text =
    `${element.textContent ?? ''} ${element.getAttribute('aria-label') ?? ''}`.toLowerCase();
  return !/\b(?:submit|apply now|apply|send|finish|complete application|continue to review|pay|delete|remove)\b/.test(
    text,
  );
}

/**
 * The guard that makes adapters safe.
 *
 * Everything isSafeToPress refuses, plus anything that is not plainly an
 * accordion: dropdowns, menus, comboboxes and navigation also report
 * aria-expanded="false", and pressing them is not ours to do.
 */
export function isSafeToExpand(element: HTMLElement): boolean {
  const popup = (element.getAttribute('aria-haspopup') ?? '').trim().toLowerCase();
  if (popup && popup !== 'false') return false;
  const role = (element.getAttribute('role') ?? '').toLowerCase();
  if (NOT_AN_EXPANDER_ROLES.includes(role)) return false;
  if (element.closest(NOT_A_FORM_SECTION)) return false;
  if (!isAccordion(element)) return false;
  return isSafeToPress(element);
}

const NOT_AN_EXPANDER_ROLES = [
  'combobox',
  'menuitem',
  'menuitemcheckbox',
  'menuitemradio',
  'option',
  'tab',
];
