import { harvestFields } from '@/field-detection/harvest';
import { fillFields, undoFill, type UndoRecord } from '@/autofill/fill';
import { FillwrightWidget, type FillSummary } from './widget';
import { applyAdapter, detectAdapter } from '@/adapters';
import type { CanonicalField, FillPlan, FillPlanEntry } from '@/types/fields';

/**
 * Fillwright content script.
 *
 * Injected on demand — when the user clicks the toolbar button or presses the
 * shortcut — rather than declared for every page, so Fillwright has no presence
 * on sites the user has not activated it on.
 *
 * The surrounding document is treated as hostile throughout. Page text is read
 * as data for the classifier and never interpreted as an instruction; the
 * profile is never held here, only the specific values the background proposes
 * for this one form; and nothing in this file clicks a button or submits a form.
 */

const MARKER = '__fillwrightInjected';

declare global {
  interface Window {
    [MARKER]?: boolean;
  }
}

interface Session {
  elements: Map<string, HTMLElement[]>;
  plan: FillPlan | null;
  undo: UndoRecord[];
  highlight: boolean;
}

let widget: FillwrightWidget | null = null;
let session: Session | null = null;
let observer: MutationObserver | null = null;

function boot(): void {
  if (window[MARKER]) {
    // Already injected: a second activation means "scan again".
    void scan();
    return;
  }
  window[MARKER] = true;

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || typeof message.type !== 'string') return false;

    switch (message.type) {
      case 'bg:scan':
        void scan();
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

  chrome.runtime.sendMessage({ type: 'content:ready', url: location.href }).catch(() => {
    /* The worker may be asleep; the scan request wakes it. */
  });

  void scan();
}

/* --------------------------------------------------------------- scanning */

async function scan(): Promise<void> {
  widget ??= createWidget();
  widget.renderLoading();

  // Site-specific adapters only prepare the DOM (expanding collapsed sections,
  // for example). They never supply values and never bypass any safety rule.
  const adapter = detectAdapter(location.href);
  if (adapter) await applyAdapter(adapter);

  const { fields, elements, truncated } = harvestFields(document);
  const visible = fields.filter((field) => field.visible && !field.disabled);

  if (visible.length === 0) {
    session = { elements, plan: null, undo: [], highlight: false };
    widget.renderPlan({
      scanId: '',
      entries: [],
      readyCount: 0,
      reviewCount: 0,
      skippedCount: 0,
      blocks: { education: 0, experience: 0 },
      available: { education: 0, experience: 0 },
    });
    watchForNewFields();
    return;
  }

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
    })
    .catch(() => null);

  if (!response?.ok) {
    if (response?.code === 'ELOCKED') {
      widget.renderLocked(() => {
        // The content script cannot open an extension page itself; the worker
        // does it, because only it holds the tabs permission path.
        void chrome.runtime.sendMessage({ type: 'ui:open-security' }).catch(() => undefined);
      });
      return;
    }
    widget.renderError(response?.error ?? 'Fillwright could not reach its background service.');
    return;
  }

  const plan = response.data.plan as FillPlan;
  session = {
    elements,
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

  if (truncated) {
    // Better to say so than to silently present a partial picture.
    widget.renderError('This page has an unusually large number of fields; only the first 400 were scanned.');
    window.setTimeout(() => widget?.renderPlan(plan), 2500);
  } else {
    widget.renderPlan(plan);
  }

  watchForNewFields();
}

function createWidget(): FillwrightWidget {
  return new FillwrightWidget(
    {
      onFill: (entries) => {
        void applyFill(entries).then((summary) => widget?.markFilled(summary));
      },
      onUndo: () => {
        void applyUndo().then((result) => widget?.markUndone(result.restored));
      },
      onRescan: () => void scan(),
      onClose: () => teardown(),
      onTeach: (entry, field, remember) => {
        void teachMapping(entry, field, remember);
      },
    },
    matchMedia('(prefers-reduced-motion: reduce)').matches,
  );
}

/* ---------------------------------------------------------------- filling */

async function applyFill(entries: FillPlanEntry[]): Promise<FillSummary & { ok: true }> {
  if (!session) return { ok: true, filled: 0, failures: [], remaining: 0 };

  const { outcomes, undo } = await fillFields(entries, {
    elements: session.elements,
    highlight: session.highlight,
  });

  // Keep the undo history so a second fill can still be reversed in full.
  session.undo = [...undo, ...session.undo];

  const byId = new Map(entries.map((entry) => [entry.fieldId, entry]));
  const filled = outcomes.filter((outcome) => outcome.ok).length;

  // A failure keeps its entry attached so the user can retry just that field
  // without re-running the whole fill.
  const failures = outcomes
    .filter((outcome) => !outcome.ok)
    .map((outcome) => {
      const entry = byId.get(outcome.fieldId);
      return {
        label: entry?.label ?? 'A field',
        reason: outcome.error ?? 'It did not take.',
        entry: entry ?? ({ ...EMPTY_ENTRY, fieldId: outcome.fieldId } as FillPlanEntry),
      };
    });

  const remaining = (session.plan?.entries ?? []).filter(
    (entry) => !entry.selected && entry.status !== 'skipped-existing' && entry.status !== 'unmapped',
  ).length;

  // Counts only — no field values ever leave this page.
  chrome.runtime
    .sendMessage({
      type: 'content:fill-complete',
      outcomes: outcomes.map(({ fieldId, ok }) => ({ fieldId, ok })),
    })
    .catch(() => undefined);

  return { ok: true, filled, failures, remaining };
}

/**
 * Records a correction the user made, then rescans so the new mapping takes
 * effect immediately rather than on the next visit.
 *
 * The mapping is stored against this origin on this device. It is never sent
 * anywhere — the background writes it to the same local database as everything
 * else.
 */
async function teachMapping(
  entry: FillPlanEntry,
  field: CanonicalField,
  remember: boolean,
): Promise<void> {
  if (remember && entry.fingerprint) {
    await chrome.runtime
      .sendMessage({
        type: 'content:save-mapping',
        mapping: { fingerprint: entry.fingerprint, label: entry.label, canonical: field },
      })
      .catch(() => undefined);
  }
  await scan();
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

/* ------------------------------------------------------- dynamic forms */

/**
 * Multi-step applications and React forms add fields after the initial render,
 * so the page is watched for new controls and the user is offered a rescan.
 *
 * Deliberately conservative: the observer is disconnected as soon as it fires,
 * and it never rescans on its own. An automatic rescan on a busy page would
 * fight the user for focus while they are typing.
 */
function watchForNewFields(): void {
  observer?.disconnect();
  if (!('MutationObserver' in window)) return;

  let timer: number | undefined;

  observer = new MutationObserver((records) => {
    const addedControls = records.some((record) =>
      Array.from(record.addedNodes).some((node) => {
        if (!(node instanceof HTMLElement)) return false;
        if (node.closest('[data-fillwright-ui]')) return false;
        return node.matches?.('input, select, textarea') || node.querySelector?.('input, select, textarea');
      }),
    );
    if (!addedControls) return;

    window.clearTimeout(timer);
    // Debounced: frameworks add fields in bursts during a render.
    timer = window.setTimeout(() => {
      observer?.disconnect();
      void scan();
    }, 900);
  });

  observer.observe(document.body, { childList: true, subtree: true });
}

function teardown(): void {
  observer?.disconnect();
  observer = null;
  widget?.destroy();
  widget = null;
  session = null;
}

boot();

export {};
