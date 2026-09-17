import { harvestFields } from '@/field-detection/harvest';
import { classifyField } from '@/field-detection/classify';
import { collectContextInput, scoreApplicationContext } from '@/field-detection/context';
import { fillFields, undoFill, type UndoRecord } from '@/autofill/fill';
import { collectPostingText, type JobMatch } from '@/autofill/job-match';
import { addEntries, findAddControls } from '@/autofill/repeat';
import { FillwrightWidget, type AddOffer, type FillSummary, type ProfileChoice } from './widget';
import type { DraftFact } from './review';
import { applyAdapter, detectAdapter } from '@/adapters';
import type { CanonicalField, DetectedField, FillPlan, FillPlanEntry } from '@/types/fields';
import type { AutofillMode } from '@/types/settings';

/**
 * Fillwright content script.
 *
 * Arrives in one of two ways:
 *  - **explicitly**, when the user clicks the toolbar button or presses the
 *    shortcut. The worker marks the injection first, and the script scans at
 *    once;
 *  - **passively**, in Assist or Smart mode, via a registration the user
 *    enabled along with site access. The script then checks, cheaply and
 *    locally, whether the page is an application at all, and stays silent if
 *    it is not.
 *
 * The surrounding document is treated as hostile throughout. Page text is read
 * as data for the classifier and never interpreted as an instruction; the
 * profile is never held here, only the specific values the background proposes
 * for this one form; and nothing in this file submits a form. The only button
 * it may press is an unmistakable "add another entry" control, and only when
 * the user asks (see autofill/repeat.ts).
 */

const MARKER = '__fillwrightInjected';
const ACTIVATION = '__fillwrightActivation';
/** An activation mark older than this is stale and ignored. */
const ACTIVATION_WINDOW_MS = 10_000;
/** How long after the last keystroke the user counts as still typing. */
const TYPING_GRACE_MS = 1_500;

type Scope = typeof globalThis & { [MARKER]?: boolean; [ACTIVATION]?: number };
const scope = globalThis as Scope;

interface Session {
  elements: Map<string, HTMLElement[]>;
  fields: Map<string, DetectedField>;
  plan: FillPlan | null;
  undo: UndoRecord[];
  highlight: boolean;
}

let widget: FillwrightWidget | null = null;
let session: Session | null = null;
let mode: AutofillMode = 'manual';
/** True once the user has opened the panel on this page. */
let engaged = false;
let scanning = false;
let lastInputAt = 0;
let lastUrl = location.href;
let pendingChange: number | undefined;
let passiveChecks = 0;
let draftAvailable: boolean | null = null;

/** Corrections for this page only, never saved. Keyed by field fingerprint. */
const overrides = new Map<string, CanonicalField>();

function boot(): void {
  const activated = consumeActivation();

  if (scope[MARKER]) {
    // Already here: a fresh activation means "scan again".
    if (activated) void open();
    return;
  }
  scope[MARKER] = true;

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || typeof message.type !== 'string') return false;

    switch (message.type) {
      case 'bg:scan':
        void open();
        sendResponse({ ok: true });
        return false;
      case 'bg:fill':
        // Filling is asynchronous now that custom dropdowns are driven through
        // their real open/select interaction, so the channel is held open.
        void applyFill(message.entries ?? []).then(sendResponse);
        return true;
      case 'bg:undo':
        void applyUndo().then(sendResponse);
        return true;
      case 'bg:teardown':
        teardown();
        sendResponse({ ok: true });
        return false;
      default:
        return false;
    }
  });

  // Typing is tracked only as a timestamp, so a rescan never steals focus or
  // re-renders under someone mid-word. The keys themselves are never read.
  const markInput = (event: Event) => {
    if (!isOwnUi(event)) lastInputAt = Date.now();
  };
  document.addEventListener('input', markInput, { capture: true, passive: true });
  document.addEventListener('keydown', markInput, { capture: true, passive: true });

  watchNavigation();
  watchForNewFields();

  chrome.runtime.sendMessage({ type: 'content:ready', url: location.href }).catch(() => {
    /* The worker may be asleep; the next request wakes it. */
  });

  if (activated) void open();
  else void passiveBoot();
}

function consumeActivation(): boolean {
  const at = scope[ACTIVATION];
  delete scope[ACTIVATION];
  return typeof at === 'number' && Date.now() - at < ACTIVATION_WINDOW_MS;
}

/* ---------------------------------------------------------- passive mode */

async function passiveBoot(): Promise<void> {
  const response = await send<{ mode: AutofillMode; enabled: boolean }>({
    type: 'content:get-mode',
  });
  if (!response?.enabled) return;
  mode = response.mode;
  if (mode === 'manual') return;
  await whenIdle();
  await evaluatePassive();
}

/**
 * Decides, locally, whether to offer help on a page nobody asked about.
 * Harvesting and classification run here; nothing is sent to the worker
 * unless the page is judged to be an application.
 */
async function evaluatePassive(): Promise<void> {
  if (engaged || mode === 'manual') return;
  passiveChecks += 1;
  if (passiveChecks > 12) return;

  const { fields } = harvestFields(document);
  const visible = fields.filter((field) => field.visible && !field.disabled);
  if (visible.length < 2) return;

  const kinds = visible.map((field) => classifyField(field.signals).field);
  const verdict = scoreApplicationContext(collectContextInput(document, kinds));

  const worthy = verdict.level === 'likely' || (mode === 'smart' && verdict.level === 'possible');
  if (!worthy) return;

  widget ??= createWidget();
  if (mode === 'smart') {
    // Smart prepares the plan ahead of time. It still fills nothing.
    await scan({ quiet: true });
    widget?.minimize();
  } else if (widget.state === 'idle' || widget.state === 'detected') {
    widget.renderDetected(visible.length);
  }
}

/* --------------------------------------------------------------- scanning */

async function open(): Promise<void> {
  engaged = true;
  await scan({ quiet: false });
  widget?.focus();
}

let rerunLoud = false;

async function scan({ quiet }: { quiet: boolean }): Promise<void> {
  if (scanning) {
    // An explicit request during a background scan must not be swallowed.
    if (!quiet) rerunLoud = true;
    return;
  }
  scanning = true;
  try {
    await runScan(quiet);
  } finally {
    scanning = false;
  }
  if (rerunLoud) {
    rerunLoud = false;
    await scan({ quiet: false });
  }
}

async function runScan(quiet: boolean): Promise<void> {
  widget ??= createWidget();
  if (!quiet) widget.renderAnalyzing();

  // Site-specific adapters only prepare the DOM (expanding collapsed sections,
  // for example). They never supply values and never bypass any safety rule.
  const adapter = detectAdapter(location.href);
  if (adapter) await applyAdapter(adapter);

  const { fields, elements, truncated } = harvestFields(document);
  const visible = fields.filter((field) => field.visible && !field.disabled);
  const fieldMap = new Map(visible.map((field) => [field.id, field]));

  const response = await chrome.runtime
    .sendMessage({
      type: 'content:request-mappings',
      scan: {
        url: location.href,
        pageKey: location.href,
        adapterId: adapter?.id ?? null,
        scannedAt: new Date().toISOString(),
        fields: visible,
        mappings: [],
      },
      overrides: [...overrides].map(([fingerprint, canonical]) => ({ fingerprint, canonical })),
    })
    .catch(() => null);

  if (!response?.ok) {
    if (response?.code === 'ELOCKED') {
      widget.renderLocked();
      // Uninvited, a locked vault is shown as the small pill, not a dialog.
      if (quiet && !engaged) widget.minimize();
      return;
    }
    if (quiet) return;
    widget.renderError(friendlyError(response?.code, response?.error));
    return;
  }

  const plan = response.data.plan as FillPlan;
  session = {
    elements,
    fields: fieldMap,
    plan,
    undo: session?.undo ?? [],
    highlight: Boolean(response.data.settings?.highlightFilledFields),
  };

  // Diagnostics are read from the harvested fields, which stay in this page —
  // they are never sent to the worker and never persisted.
  widget.setDiagnostics(
    Boolean(response.data.settings?.diagnostics),
    new Map(visible.map((field) => [field.id, field.signals])),
  );

  widget.setMeta({
    title: pageTitle(),
    profileName: String(response.data.profileName ?? ''),
    addOffers: addOffersFor(plan),
  });
  widget.renderPlan(plan);

  if (truncated && !quiet) {
    widget.setMeta({ title: 'Large form — first 400 fields shown' });
  }

  // Secondary information arrives after the plan so it never delays it.
  void loadExtras();
}

async function loadExtras(): Promise<void> {
  const [progress, match] = await Promise.all([
    send<{ steps: Record<string, number>; filled: number }>({ type: 'content:get-progress' }),
    loadJobMatch(),
  ]);
  widget?.setMeta({
    progress: progress
      ? { steps: Object.keys(progress.steps).length, filled: progress.filled }
      : null,
    jobMatch: match,
  });
}

let jobMatchFor = '';
let jobMatchCache: JobMatch | null = null;

async function loadJobMatch(): Promise<JobMatch | null> {
  const text = collectPostingText(document);
  if (text.length < 200) return null;
  const key = `${location.pathname}|${text.length}`;
  if (key === jobMatchFor) return jobMatchCache;
  jobMatchFor = key;
  jobMatchCache = await send<JobMatch | null>({ type: 'content:job-match', text });
  return jobMatchCache;
}

function createWidget(): FillwrightWidget {
  const instance = new FillwrightWidget(
    {
      onFill: (entries) => void runFill(entries),
      onUndo: () => {
        void applyUndo().then((result) => widget?.markUndone(result.restored));
      },
      onRescan: () => void open(),
      onClose: () => teardown(),
      onTeach: (entry, field, remember) => void teachMapping(entry, field, remember),
      onListProfiles: async () =>
        (await send<ProfileChoice[]>({ type: 'content:list-profiles' })) ?? [],
      onSwitchProfile: (profileId) => {
        void send({ type: 'content:switch-profile', profileId }).then(() => open());
      },
      onAddEntries: (offer) => void addMissingEntries(offer),
      onUnlock: () => {
        // The content script cannot open an extension page itself; the worker does.
        void chrome.runtime.sendMessage({ type: 'ui:open-security' }).catch(() => undefined);
      },
      canDraft: () => draftAvailable !== false,
      onDraftStart: (entry) => void startDraft(entry),
      onDraftGenerate: (entry, factIds) => void generateDraft(entry, factIds),
      onDraftUse: (entry, text) => void applyDraft(entry, text),
    },
    matchMedia('(prefers-reduced-motion: reduce)').matches,
  );
  return instance;
}

/* ---------------------------------------------------------------- filling */

async function runFill(entries: FillPlanEntry[]): Promise<void> {
  if (!widget) return;
  widget.renderFilling();
  const summary = await applyFill(entries);
  widget.markFilled(summary);
}

async function applyFill(entries: FillPlanEntry[]): Promise<FillSummary & { ok: true }> {
  if (!session) return { ok: true, filled: 0, failures: [], remaining: 0, manual: 0 };

  const { outcomes, undo } = await fillFields(entries, {
    elements: session.elements,
    highlight: session.highlight,
  });

  // Keep the undo history so a second fill can still be reversed in full.
  session.undo = [...undo, ...session.undo];

  const byId = new Map(entries.map((entry) => [entry.fieldId, entry]));
  const filled = outcomes.filter((outcome) => outcome.ok).length;

  // A failure keeps its entry attached so the user can retry just that field.
  // Ambiguous dropdowns and vanished fields are not retryable: trying again
  // would fail the same way.
  const failures = outcomes
    .filter((outcome) => !outcome.ok)
    .map((outcome) => {
      const entry = byId.get(outcome.fieldId);
      const reason = outcome.error ?? 'It did not take.';
      return {
        label: entry?.label ?? 'A field',
        reason,
        entry: entry ?? ({ ...EMPTY_ENTRY, fieldId: outcome.fieldId } as FillPlanEntry),
        retryable: !/several|identical|pick one yourself|no longer on the page/i.test(reason),
      };
    });

  const filledIds = new Set(
    outcomes.filter((outcome) => outcome.ok).map((outcome) => outcome.fieldId),
  );
  const left = (session.plan?.entries ?? []).filter(
    (entry) =>
      !filledIds.has(entry.fieldId) &&
      !entry.selected &&
      entry.status !== 'skipped-existing' &&
      entry.status !== 'unmapped',
  );
  const manual = left.filter((entry) => entry.status === 'manual-required').length;

  // Counts only — no field values ever leave this page.
  chrome.runtime
    .sendMessage({
      type: 'content:fill-complete',
      outcomes: outcomes.map(({ fieldId, ok }) => ({ fieldId, ok })),
    })
    .catch(() => undefined);
  if (filled > 0) {
    void send({ type: 'content:step-progress', filled, stepKey: stepKey() });
  }

  return { ok: true, filled, failures, remaining: left.length, manual };
}

/**
 * Records a correction the user made, then rescans so it takes effect at once.
 *
 * A remembered mapping is stored against this origin on this device; an
 * unremembered one lives only in this page's memory until it is closed.
 */
async function teachMapping(
  entry: FillPlanEntry,
  field: CanonicalField,
  remember: boolean,
): Promise<void> {
  if (!entry.fingerprint) return;
  if (remember) {
    overrides.delete(entry.fingerprint);
    await send({
      type: 'content:save-mapping',
      mapping: { fingerprint: entry.fingerprint, label: entry.label, canonical: field },
    });
  } else {
    overrides.set(entry.fingerprint, field);
  }
  await scan({ quiet: true });
}

async function addMissingEntries(offer: AddOffer): Promise<void> {
  widget?.renderAnalyzing();
  const pressed = await addEntries(offer.kind, offer.missing);
  if (pressed === 0) {
    widget?.renderError(
      `Fillwright could not find a single, clearly labelled “Add ${offer.kind}” button. Please add the entries yourself, then scan again.`,
    );
    return;
  }
  await open();
}

/** Placeholder for a failure whose entry has vanished from the plan. */
const EMPTY_ENTRY: FillPlanEntry = {
  fieldId: '',
  label: 'A field',
  canonical: 'unknown',
  currentValue: '',
  newValue: '',
  status: 'unmapped',
  confidence: 0,
  rationale: '',
  selected: false,
  fingerprint: '',
  remembered: false,
};

async function applyUndo(): Promise<{ ok: true; restored: number }> {
  if (!session) return { ok: true, restored: 0 };
  const restored = await undoFill(session.undo);
  session.undo = [];
  return { ok: true, restored };
}

/* -------------------------------------------------------------- drafting */

async function startDraft(entry: FillPlanEntry): Promise<void> {
  if (!widget) return;
  widget.drafts.set(entry.fieldId, { phase: 'loading' });
  widget.refresh();
  const response = await chrome.runtime
    .sendMessage({ type: 'content:draft-facts' })
    .catch(() => null);
  if (!response?.ok) {
    if (response?.code === 'EAIOFF') draftAvailable = false;
    widget.drafts.set(entry.fieldId, {
      phase: 'error',
      message: response?.error ?? 'The on-device model could not be reached.',
    });
  } else {
    draftAvailable = true;
    const facts = response.data as DraftFact[];
    widget.drafts.set(entry.fieldId, {
      phase: 'facts',
      facts,
      chosen: new Set(facts.map((fact) => fact.id)),
    });
  }
  widget.refresh();
}

async function generateDraft(entry: FillPlanEntry, factIds: string[]): Promise<void> {
  const current = widget?.drafts.get(entry.fieldId);
  if (!widget || !current || !('facts' in current)) return;
  const { facts, chosen } = current;
  widget.drafts.set(entry.fieldId, { phase: 'generating', facts, chosen });
  widget.refresh();

  const field = session?.fields.get(entry.fieldId);
  const question = field?.signals.labelText || field?.signals.ariaLabel || entry.label;
  const response = await chrome.runtime
    .sendMessage({
      type: 'content:draft',
      question,
      factIds,
      ...(field?.signals.maxLength ? { maxCharacters: field.signals.maxLength } : {}),
    })
    .catch(() => null);

  widget.drafts.set(
    entry.fieldId,
    response?.ok
      ? { phase: 'result', text: String(response.data.text ?? ''), facts, chosen }
      : { phase: 'error', message: response?.error ?? 'No draft was produced.' },
  );
  widget.refresh();
}

/** The user approved an edited draft. Only now does it touch the form. */
async function applyDraft(entry: FillPlanEntry, text: string): Promise<void> {
  widget?.drafts.delete(entry.fieldId);
  await runFill([{ ...entry, newValue: text, status: 'ready', selected: true }]);
}

/* ------------------------------------------------ dynamic forms & routing */

/**
 * Multi-step applications and SPA routers change the form without a page
 * load. Fillwright notices and re-reads the form — but never while the user
 * is typing, and never under a list they are in the middle of reviewing.
 */
function watchForNewFields(): void {
  if (!('MutationObserver' in window)) return;

  const observer = new MutationObserver((records) => {
    const changed = records.some((record) =>
      [...Array.from(record.addedNodes), ...Array.from(record.removedNodes)].some((node) => {
        if (!(node instanceof HTMLElement)) return false;
        if (node.closest?.('[data-fillwright-ui]') || node.hasAttribute('data-fillwright-ui'))
          return false;
        return (
          node.matches?.('input, select, textarea') ||
          node.querySelector?.('input, select, textarea')
        );
      }),
    );
    if (changed) scheduleChange();
  });

  observer.observe(document.body ?? document.documentElement, { childList: true, subtree: true });
  observers.push(() => observer.disconnect());
}

/**
 * Same-document navigations (pushState, replaceState, popstate) are noticed by
 * polling the URL — the page's history functions are never wrapped, so
 * Fillwright cannot interfere with the site's router.
 */
function watchNavigation(): void {
  const check = () => {
    if (location.href === lastUrl) return;
    lastUrl = location.href;
    passiveChecks = 0;
    scheduleChange();
  };
  const timer = window.setInterval(check, 1_000);
  window.addEventListener('popstate', check);
  window.addEventListener('hashchange', check);
  observers.push(() => {
    window.clearInterval(timer);
    window.removeEventListener('popstate', check);
    window.removeEventListener('hashchange', check);
  });
}

const observers: Array<() => void> = [];

function scheduleChange(): void {
  window.clearTimeout(pendingChange);
  // Debounced: frameworks add fields in bursts during a render.
  pendingChange = window.setTimeout(() => void onFormChanged(), 900);
}

async function onFormChanged(): Promise<void> {
  if (userIsTyping()) {
    scheduleChange();
    return;
  }

  if (!engaged) {
    await evaluatePassive();
    return;
  }
  if (!widget || scanning) return;

  // Mid-review, or mid-fill: say the page changed and let the user refresh.
  if (widget.state === 'review' || widget.state === 'filling' || widget.drafts.size > 0) {
    widget.markStale();
    return;
  }
  // Otherwise refresh quietly, so the next step's fields are ready.
  if (widget.state === 'ready' || widget.state === 'success' || widget.state === 'partial') {
    await scan({ quiet: true });
  }
}

function userIsTyping(): boolean {
  if (Date.now() - lastInputAt < TYPING_GRACE_MS) return true;
  const active = document.activeElement;
  return (
    active instanceof HTMLElement &&
    !active.closest('[data-fillwright-ui]') &&
    (active.isContentEditable ||
      active.matches('input:not([type="checkbox"]):not([type="radio"]), textarea')) &&
    Date.now() - lastInputAt < TYPING_GRACE_MS * 4
  );
}

function whenIdle(): Promise<void> {
  return new Promise((resolve) => {
    const idle = (
      window as Window & { requestIdleCallback?: (cb: () => void, opts?: object) => number }
    ).requestIdleCallback;
    if (idle) idle(() => resolve(), { timeout: 2_000 });
    else window.setTimeout(resolve, 300);
  });
}

function isOwnUi(event: Event): boolean {
  return event
    .composedPath()
    .some((node) => node instanceof HTMLElement && node.hasAttribute('data-fillwright-ui'));
}

/* --------------------------------------------------------------- helpers */

/**
 * Offers to add blocks when the profile has more education or experience
 * entries than the form shows — only when there is exactly one clear
 * add-control for that kind of entry.
 */
function addOffersFor(plan: FillPlan): AddOffer[] {
  const offers: AddOffer[] = [];
  const controls = findAddControls();
  for (const kind of ['education', 'experience'] as const) {
    const shown = plan.blocks[kind];
    const missing = Math.min(5, plan.available[kind] - shown);
    if (shown === 0 || missing <= 0) continue;
    if (controls.filter((control) => control.kind === kind).length !== 1) continue;
    offers.push({ kind, missing });
  }
  return offers;
}

/** A short heading for the panel. Page text, shown via textContent only. */
function pageTitle(): string {
  const heading = document.querySelector('h1')?.textContent ?? document.title;
  const text = heading.replace(/\s+/g, ' ').trim();
  return text.length > 60 ? `${text.slice(0, 57)}…` : text;
}

/**
 * Identifies the current step of a multi-step form, so progress is counted
 * per step rather than per page load.
 */
function stepKey(): string {
  const marker =
    document.querySelector('[aria-current="step"]')?.textContent ??
    document.querySelector('form legend, form h2, [role="dialog"] h2, h2')?.textContent ??
    '';
  return `${location.pathname}#${marker.replace(/\s+/g, ' ').trim().slice(0, 60)}`;
}

function friendlyError(code: string | undefined, fallback: string | undefined): string {
  switch (code) {
    case 'ENOPROFILE':
      return 'Fillwright has no profile yet. Import your resume in Fillwright’s settings, then try again.';
    case 'EBADSCAN':
      return 'This page’s form could not be read safely, so Fillwright left it alone.';
    case 'EBADORIGIN':
    case 'ENOSENDER':
      return 'Fillwright only works on regular web pages.';
    default:
      return (
        fallback ??
        'Fillwright could not reach its background service. Reload the page and try again.'
      );
  }
}

async function send<T = unknown>(message: {
  type: string;
  [key: string]: unknown;
}): Promise<T | null> {
  const response = await chrome.runtime.sendMessage(message).catch(() => null);
  return response?.ok ? (response.data as T) : null;
}

function teardown(): void {
  widget?.destroy();
  widget = null;
  session = null;
  engaged = false;
  overrides.clear();
  // The observers stay: they are cheap, and a later activation on the same
  // page reuses them. In passive mode, closing the panel means "not here".
  passiveChecks = Number.POSITIVE_INFINITY;
}

boot();

export {};
