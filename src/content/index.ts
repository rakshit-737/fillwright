import { harvestFields } from '@/field-detection/harvest';
import { collectPageSignals, guessPosting } from './page-signals';
import { fillFields, undoFill, type UndoRecord } from '@/autofill/fill';
import { collectPostingText, type JobMatch } from '@/autofill/job-match';
import { addEntries, findAddControls } from '@/autofill/repeat';
import { secondPassTargets } from '@/autofill/second-pass';
import {
  FillwrightWidget,
  type AddOffer,
  type FillSummary,
  type HiddenField,
  type ProfileChoice,
} from './widget';
import type { DraftFact } from './review';
import type { AnswerChoices } from '@/autofill/saved-answers';
import { applyAdapter, detectAdapter } from '@/adapters';
import type { CanonicalField, DetectedField, FillPlan, FillPlanEntry } from '@/types/fields';
import type { AutofillMode } from '@/types/settings';
import { isOpenableProfileField } from '@/field-detection/catalog';
import { describeError } from '@/utils/errors';
import { request, notify } from './transport';
import { controlSignature, createThrottle, mutationsMayAffectForm } from './observe';

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

let lastSignature = '';

/**
 * Passive evaluation (Assist/Smart) runs at most once every 1.5 s, and not
 * while the page is being scrolled.
 */
const passiveThrottle = createThrottle(() => evaluatePassive(), {
  intervalMs: 1_500,
  scrollQuietMs: 400,
});

/** Corrections for this page only, never saved. Keyed by field fingerprint. */
const overrides = new Map<string, { canonical: CanonicalField; customKey?: string }>();

function boot(): void {
  const activated = consumeActivation();

  if (scope[MARKER]) {
    // Already here: a fresh activation means "scan again".
    if (activated) void open();
    return;
  }
  scope[MARKER] = true;

  // No message listener: the worker never sends commands to this script.
  // Everything starts from the user's click (a fresh injection) or from the
  // page itself, so there is no inbound channel to guard.

  // Typing is tracked only as a timestamp, so a rescan never steals focus or
  // re-renders under someone mid-word. The keys themselves are never read.
  const markInput = (event: Event) => {
    if (!isOwnUi(event)) lastInputAt = Date.now();
  };
  document.addEventListener('input', markInput, { capture: true, passive: true });
  document.addEventListener('keydown', markInput, { capture: true, passive: true });

  watchNavigation();
  watchForNewFields();
  // Passive checks wait for scrolling to stop.
  window.addEventListener('scroll', () => passiveThrottle.noteScroll(), {
    passive: true,
    capture: true,
  });

  notify({ type: 'content:ready', url: location.href });

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
  lastSignature = `${location.href}#${controlSignature(document)}`;
  passiveThrottle.schedule();
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

  // Scored in the worker, which holds the classifier; the reply is a level.
  const reply = await request<{ level: 'none' | 'possible' | 'likely' }>({
    type: 'content:assess-page',
    fields: visible,
    page: collectPageSignals(document),
  });
  if (!reply.ok) return;
  const verdict = reply.data;

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
  // They press page controls, so they run only when the user has asked:
  // never from a quiet scan (Smart mode's passive preparation, a form change,
  // a remembered correction).
  const adapter = quiet ? null : detectAdapter(location.href);
  if (adapter) await applyAdapter(adapter);

  const { fields, elements, truncated } = harvestFields(document);
  lastSignature = `${location.href}#${controlSignature(document)}`;
  const visible = fields.filter((field) => field.visible && !field.disabled);
  const fieldMap = new Map(visible.map((field) => [field.id, field]));
  widget.setHidden(hiddenFieldsOf(fields));

  // Nothing here, but the form is in a same-origin frame that has its own
  // copy of this script (explicit activation injects into every frame): stay
  // out of the way so the user sees one panel, where the fields are.
  if (visible.length === 0 && window === window.top && hasReachableFormFrame()) {
    teardown();
    return;
  }

  // Nothing to read here, but a cross-origin frame fills the page: the form
  // is almost certainly inside it, where this script cannot go.
  if (visible.length === 0 && hasUnreachableFormFrame()) {
    if (!quiet) widget.renderError(describeError('EFRAME', undefined, true));
    return;
  }

  const response = await request<{
    plan: FillPlan;
    profileName?: string;
    settings?: {
      highlightFilledFields?: boolean;
      diagnostics?: boolean;
      theme?: 'system' | 'light' | 'dark';
      reducedMotion?: boolean;
    };
  }>({
    type: 'content:request-mappings',
    scan: {
      url: location.href,
      pageKey: location.href,
      adapterId: adapter?.id ?? null,
      scannedAt: new Date().toISOString(),
      fields: visible,
      mappings: [],
    },
    overrides: [...overrides].map(([fingerprint, correction]) => ({ fingerprint, ...correction })),
  });

  if (!response.ok) {
    if (response.code === 'ELOCKED') {
      widget.renderLocked();
      // Uninvited, a locked vault is shown as the small pill, not a dialog.
      if (quiet && !engaged) widget.minimize();
      return;
    }
    if (quiet) return;
    widget.renderError(describeError(response.code, response.error, true));
    return;
  }

  const plan = response.data.plan;
  session = {
    elements,
    fields: fieldMap,
    plan,
    undo: session?.undo ?? [],
    highlight: Boolean(response.data.settings?.highlightFilledFields),
  };

  const theme = response.data.settings?.theme;
  widget.setAppearance({
    theme: theme === 'light' || theme === 'dark' ? theme : 'system',
    reducedMotion: Boolean(response.data.settings?.reducedMotion),
  });

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
  const [progress, match, choices] = await Promise.all([
    send<{ steps: Record<string, number>; filled: number }>({ type: 'content:get-progress' }),
    loadJobMatch(),
    // Titles only, so the picker and essay rows can offer them.
    send<AnswerChoices>({ type: 'content:answer-choices' }),
  ]);
  if (widget) widget.choices = choices;
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
        void applyUndo().then((result) => widget?.markUndone(result.restored, result.notRestored));
      },
      onRescan: () => void open(),
      onClose: () => teardown(),
      onTeach: (entry, field, remember, customKey) =>
        void teachMapping(entry, field, remember, customKey),
      onListProfiles: async () =>
        (await send<ProfileChoice[]>({ type: 'content:list-profiles' })) ?? [],
      onSwitchProfile: (profileId) => {
        void request({ type: 'content:switch-profile', profileId }).then((reply) => {
          if (reply.ok) void open();
          else widget?.renderError(describeError(reply.code, reply.error, true));
        });
      },
      onAddEntries: (offer) => void addMissingEntries(offer),
      onUnlock: () => openExtensionPage('security'),
      onOpenPage: (route, field) => openExtensionPage(route, field),
      onReload: () => location.reload(),
      canDraft: () => draftAvailable !== false,
      onDraftStart: (entry) => void startDraft(entry),
      onDraftGenerate: (entry, factIds) => void generateDraft(entry, factIds),
      onDraftUse: (entry, text) => void applyDraft(entry, text),
      onShowField: (fieldId) => showField(fieldId),
      onSavedAnswerStart: (entry) => void startSavedAnswer(entry),
      onSavedAnswerPick: (entry, id) => void pickSavedAnswer(entry, id),
      onSavedAnswerUse: (entry, text) => void applySavedAnswer(entry, text),
    },
    matchMedia('(prefers-reduced-motion: reduce)').matches,
  );
  return instance;
}

/* ---------------------------------------------------------------- filling */

/**
 * Fields that exist but a person could not see: honeypots, off-screen or
 * transparent inputs. They are never sent for a value; the panel only counts
 * them. `display: none` is left out of the count — that is how ordinary
 * multi-step forms park later steps, and saying so would be noise.
 */
function hiddenFieldsOf(fields: DetectedField[]): HiddenField[] {
  return fields
    .filter(
      (field) =>
        !field.visible &&
        !field.disabled &&
        field.hiddenReason &&
        field.hiddenReason !== 'not displayed',
    )
    .map((field) => ({
      label:
        field.signals.labelText || field.signals.placeholder || field.signals.name || 'A field',
      reason: field.hiddenReason ?? 'hidden',
    }));
}

const SHOW_OUTLINE_MS = 2400;

/** "Show me": scroll a row's field into view and outline it for a moment. */
function showField(fieldId: string): void {
  const element = session?.elements.get(fieldId)?.find((node) => node.isConnected);
  if (!element) return;
  // A visually hidden radio or checkbox is shown through its label.
  const target =
    element instanceof HTMLInputElement &&
    (element.type === 'radio' || element.type === 'checkbox') &&
    element.closest('label')
      ? (element.closest('label') as HTMLElement)
      : element;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  target.scrollIntoView({
    block: 'center',
    inline: 'nearest',
    behavior: reduced ? 'auto' : 'smooth',
  });
  if (target.hasAttribute('data-fillwright-shown')) return;
  const previous = {
    outline: target.style.outline,
    outlineOffset: target.style.outlineOffset,
  };
  target.setAttribute('data-fillwright-shown', '');
  target.style.outline = '3px solid #4b3ecf';
  target.style.outlineOffset = '2px';
  setTimeout(() => {
    target.style.outline = previous.outline;
    target.style.outlineOffset = previous.outlineOffset;
    target.removeAttribute('data-fillwright-shown');
  }, SHOW_OUTLINE_MS);
}

async function runFill(entries: FillPlanEntry[]): Promise<void> {
  if (!widget) return;
  // The plan holds values read while the vault was open. If it has locked
  // since, those values are not written: the user unlocks and scans again.
  const gate = await request<{ locked: boolean }>({ type: 'content:vault-state' });
  if (gate.ok && gate.data.locked) {
    session = session ? { ...session, plan: null } : null;
    widget.renderLocked();
    return;
  }
  widget.renderFilling();
  const summary = await applyFill(entries);
  widget.markFilled(summary);
  // A dependent list usually loads within a moment of its parent changing.
  // The mutation observer catches most; this catches a page that swapped
  // options without changing their count.
  window.setTimeout(() => void checkSecondPass(), 1_200);
}

let checkingSecondPass = false;

/**
 * After a fill: reads the page again, and if dropdowns that were empty or
 * unmatched now have options that fit, offers "N more fields can be filled
 * now". It never fills them — the user opens the list and chooses. Returns
 * true when an offer was made.
 */
async function checkSecondPass(): Promise<boolean> {
  if (!session?.plan || !widget || checkingSecondPass) return false;
  if (widget.state !== 'success' && widget.state !== 'partial') return false;
  checkingSecondPass = true;
  try {
    const { fields } = harvestFields(document);
    const visible = fields.filter((field) => field.visible && !field.disabled);
    const targets = secondPassTargets([...session.fields.values()], visible, session.plan);
    if (targets.length === 0) return false;

    const response = await request<{ plan: FillPlan }>({
      type: 'content:request-mappings',
      scan: {
        url: location.href,
        pageKey: location.href,
        adapterId: null,
        scannedAt: new Date().toISOString(),
        fields: visible,
        mappings: [],
      },
      overrides: [...overrides].map(([fingerprint, canonical]) => ({ fingerprint, canonical })),
    });
    if (!response.ok) return false;
    const ids = new Set(targets.map((field) => field.id));
    const fillable = response.data.plan.entries.filter(
      (entry) =>
        ids.has(entry.fieldId) &&
        entry.newValue !== '' &&
        (entry.status === 'ready' || entry.status === 'review'),
    ).length;
    if (fillable === 0) return false;
    widget?.offerSecondPass(fillable);
    return true;
  } finally {
    checkingSecondPass = false;
  }
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
  const mappingIds = [
    ...new Set(
      [...filledIds]
        .map((id) => byId.get(id)?.savedMappingId)
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  notify({
    type: 'content:fill-complete',
    outcomes: outcomes.map(({ fieldId, ok }) => ({ fieldId, ok })),
    ...(mappingIds.length ? { mappingIds } : {}),
  });
  if (filled > 0) {
    void send({ type: 'content:step-progress', filled, stepKey: stepKey() });
    // Recorded only if the user switched history on; the worker checks.
    notify({
      type: 'content:log-application',
      ...guessPosting(document),
      origin: location.origin,
      fieldsFilled: filled,
    });
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
  customKey?: string,
): Promise<void> {
  if (!entry.fingerprint) return;
  const correction = { canonical: field, ...(customKey ? { customKey } : {}) };
  if (remember) {
    overrides.delete(entry.fingerprint);
    const saved = await request({
      type: 'content:save-mapping',
      mapping: { fingerprint: entry.fingerprint, label: entry.label, ...correction },
    });
    if (!saved.ok) {
      // Still apply it for this form, and say it was not remembered.
      overrides.set(entry.fingerprint, correction);
      widget?.setMeta({
        notice: 'Applied to this form, but Fillwright could not remember it for next time.',
      });
    }
  } else {
    overrides.set(entry.fingerprint, correction);
  }
  await scan({ quiet: true });
}

async function addMissingEntries(offer: AddOffer): Promise<void> {
  widget?.renderAnalyzing();
  const pressed = await addEntries(offer.kind, offer.missing);
  if (pressed === 0) {
    widget?.renderError({
      message: `Fillwright couldn’t find one clearly labelled “Add ${offer.kind}” button, so it didn’t press anything. Nothing on the form was changed. Add the entries yourself, then scan again.`,
      action: 'retry',
      actionLabel: 'Scan again',
    });
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

async function applyUndo(): Promise<{ ok: true; restored: number; notRestored: string[] }> {
  if (!session) return { ok: true, restored: 0, notRestored: [] };
  const { restored, notRestored } = await undoFill(session.undo);
  const fields = session.fields;
  session.undo = [];
  return {
    ok: true,
    restored,
    notRestored: notRestored.map((id) => fields.get(id)?.signals.labelText.trim() || 'A field'),
  };
}

/* -------------------------------------------------------------- drafting */

async function startDraft(entry: FillPlanEntry): Promise<void> {
  if (!widget) return;
  widget.drafts.set(entry.fieldId, { phase: 'loading' });
  widget.refresh();
  const response = await request<DraftFact[]>({ type: 'content:draft-facts' });
  if (!response.ok) {
    if (response.code === 'EAIOFF') draftAvailable = false;
    widget.drafts.set(entry.fieldId, {
      phase: 'error',
      message: `${describeError(response.code, response.error).message} Nothing on the form was changed.`,
    });
  } else {
    draftAvailable = true;
    const facts = response.data;
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
  const response = await request<{ text: string }>({
    type: 'content:draft',
    question,
    factIds,
    ...(field?.signals.maxLength ? { maxCharacters: field.signals.maxLength } : {}),
  });

  widget.drafts.set(
    entry.fieldId,
    response.ok
      ? { phase: 'result', text: String(response.data.text ?? ''), facts, chosen }
      : {
          phase: 'error',
          message: `${describeError(response.code, response.error).message} Nothing on the form was changed.`,
        },
  );
  widget.refresh();
}

/** The user approved an edited draft. Only now does it touch the form. */
async function applyDraft(entry: FillPlanEntry, text: string): Promise<void> {
  widget?.drafts.delete(entry.fieldId);
  await runFill([{ ...entry, newValue: text, status: 'ready', selected: true }]);
}

/* ---------------------------------------------------------- saved answers */

/**
 * "Use a saved answer": the worker returns titles ranked against this
 * question; the text of one answer crosses only after the user picks it, and
 * is written only after "Use this answer".
 */
async function startSavedAnswer(entry: FillPlanEntry): Promise<void> {
  if (!widget) return;
  widget.savedAnswers.set(entry.fieldId, { phase: 'loading' });
  widget.refresh();
  const field = session?.fields.get(entry.fieldId);
  const question = field?.signals.labelText || field?.signals.ariaLabel || entry.label;
  const response = await request<AnswerChoices>({ type: 'content:answer-choices', question });
  // Cancelled (or rescanned away) while loading: do not bring the panel back.
  if (!widget || widget.savedAnswers.get(entry.fieldId)?.phase !== 'loading') return;
  widget.savedAnswers.set(
    entry.fieldId,
    response.ok && response.data.answers.length > 0
      ? { phase: 'choose', answers: response.data.answers }
      : {
          phase: 'error',
          message: response.ok
            ? 'You have no saved answers yet. Add them under Preferences in Fillwright.'
            : `${describeError(response.code, response.error).message} Nothing on the form was changed.`,
        },
  );
  widget.refresh();
}

async function pickSavedAnswer(entry: FillPlanEntry, id: string): Promise<void> {
  const current = widget?.savedAnswers.get(entry.fieldId);
  if (!widget || !current || current.phase !== 'choose') return;
  widget.savedAnswers.set(entry.fieldId, { ...current, busy: true });
  widget.refresh();
  const response = await request<{ text: string }>({ type: 'content:saved-answer', id });
  if (!widget || widget.savedAnswers.get(entry.fieldId)?.phase !== 'choose') return;
  widget.savedAnswers.set(
    entry.fieldId,
    response.ok
      ? { phase: 'result', text: String(response.data.text ?? ''), answers: current.answers }
      : {
          phase: 'error',
          message: `${describeError(response.code, response.error).message} Nothing on the form was changed.`,
        },
  );
  widget.refresh();
}

async function applySavedAnswer(entry: FillPlanEntry, text: string): Promise<void> {
  widget?.savedAnswers.delete(entry.fieldId);
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

  // The callback only looks at node types — no document queries — because in
  // Assist/Smart mode it runs on every page's every render. Whether the form
  // really changed is decided later, off the callback, in onFormChanged.
  const observer = new MutationObserver((records) => {
    if (mutationsMayAffectForm(records)) scheduleChange();
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

  // A render that did not add, remove or replace a control is not a change.
  const signature = `${location.href}#${controlSignature(document)}`;
  if (signature === lastSignature) return;
  lastSignature = signature;

  if (!engaged) {
    passiveThrottle.schedule();
    return;
  }
  if (!widget || scanning) return;

  // Mid-review, or mid-fill: say the page changed and let the user refresh.
  if (
    widget.state === 'review' ||
    widget.state === 'filling' ||
    widget.drafts.size > 0 ||
    widget.savedAnswers.size > 0
  ) {
    widget.markStale();
    return;
  }
  // Straight after a fill, a changed dropdown is offered rather than rescanned
  // under the user's summary.
  if ((widget.state === 'success' || widget.state === 'partial') && (await checkSecondPass())) {
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

async function send<T = unknown>(message: {
  type: string;
  [key: string]: unknown;
}): Promise<T | null> {
  const reply = await request<T>(message);
  return reply.ok ? reply.data : null;
}

/** Only these extension pages may be opened from a web page. */
const OPENABLE = new Set(['security', 'import', 'privacy', 'assistance', 'profile']);

/**
 * Opens a Fillwright page. `field` (profile only) names the profile field to
 * focus; it must be a FIELD_CATALOG key, and the worker checks it again. This
 * only navigates — nothing here can read or write the profile.
 */
function openExtensionPage(route: string, field?: CanonicalField): void {
  if (!OPENABLE.has(route)) return;
  if (field !== undefined && (route !== 'profile' || !isOpenableProfileField(field))) return;
  notify({ type: 'content:open-page', route, ...(field ? { field } : {}) });
}

/** True when a same-origin iframe on this page contains form controls. */
function hasReachableFormFrame(): boolean {
  return Array.from(document.querySelectorAll('iframe')).some((frame) => {
    try {
      return Boolean(frame.contentDocument?.querySelector('input, select, textarea'));
    } catch {
      return false;
    }
  });
}

/**
 * True when a large, visible iframe from another origin is on the page —
 * where an application form usually lives when the top page has none.
 */
function hasUnreachableFormFrame(): boolean {
  return Array.from(document.querySelectorAll('iframe')).some((frame) => {
    let crossOrigin: boolean;
    try {
      crossOrigin = frame.contentDocument === null;
    } catch {
      crossOrigin = true;
    }
    if (!crossOrigin) return false;
    const box = frame.getBoundingClientRect();
    return box.width >= 300 && box.height >= 300;
  });
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
