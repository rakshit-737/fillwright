import '@/ui/base.css';
import './practice.css';
import { harvestFields } from '@/field-detection/harvest';
import { fillFields, undoFill, type UndoRecord } from '@/autofill/fill';
import { FillwrightWidget } from '@/content/widget';
import { send } from '@/utils/messaging';
import { describeError } from '@/utils/errors';
import type { FillPlan } from '@/types/fields';

/**
 * The onboarding practice form.
 *
 * Trust boundary: an extension page, not a web page. Content scripts cannot be
 * injected here, so this page runs the same harvest → plan → fill engine and
 * the same panel directly. The plan comes from the worker over the `ui:*`
 * channel, which only extension pages may use. The form submits nowhere.
 */

let undo: UndoRecord[] = [];
let plan: FillPlan | null = null;
let elements = new Map<string, HTMLElement[]>();

document.getElementById('application_form')!.addEventListener('submit', (event) => {
  event.preventDefault();
  const note = document.createElement('p');
  note.className = 'practice__banner';
  note.setAttribute('role', 'status');
  note.textContent =
    'You pressed Submit — on a real application, that click is always yours. Nothing was sent.';
  document.querySelector('.practice')!.appendChild(note);
});

const widget = new FillwrightWidget(
  {
    onFill: (entries) => {
      widget.renderFilling();
      void fillFields(entries, { elements, highlight: true }).then(
        async ({ outcomes, undo: records }) => {
          undo = [...records, ...undo];
          const filled = outcomes.filter((outcome) => outcome.ok).length;
          const failures = outcomes
            .filter((outcome) => !outcome.ok)
            .map((outcome) => ({
              label: entries.find((entry) => entry.fieldId === outcome.fieldId)?.label ?? 'A field',
              reason: outcome.error ?? '',
              entry: entries.find((entry) => entry.fieldId === outcome.fieldId)!,
              retryable: false,
            }));
          const left = (plan?.entries ?? []).filter(
            (entry) =>
              !entry.selected && entry.status !== 'skipped-existing' && entry.status !== 'unmapped',
          );
          widget.markFilled({
            filled,
            failures,
            remaining: left.length,
            manual: left.filter((entry) => entry.status === 'manual-required').length,
          });
          if (filled > 0) {
            await send({ type: 'ui:set-settings', patch: { onboardingTriedFill: true } });
          }
        },
      );
    },
    onUndo: () => {
      void undoFill(undo).then(({ restored, notRestored }) => {
        undo = [];
        widget.markUndone(restored, notRestored);
      });
    },
    onClose: () => widget.minimize(),
    onRescan: () => void scan(),
    onOpen: () => void scan(),
    onTeach: () => void scan(),
    onListProfiles: async () => [],
    onSwitchProfile: () => undefined,
    onAddEntries: () => undefined,
    onUnlock: () => {
      location.href = chrome.runtime.getURL('options.html#/security');
    },
    onOpenPage: (route) => {
      location.href = chrome.runtime.getURL(`options.html#/${route}`);
    },
    onReload: () => location.reload(),
    canDraft: () => false,
    onDraftStart: () => undefined,
    onDraftGenerate: () => undefined,
    onDraftUse: () => undefined,
  },
  matchMedia('(prefers-reduced-motion: reduce)').matches,
);

async function scan(): Promise<void> {
  widget.renderAnalyzing();
  const harvested = harvestFields(document);
  elements = harvested.elements;
  const fields = harvested.fields.filter((field) => field.visible && !field.disabled);
  const result = await send<{ plan: FillPlan; profileName: string }>({
    type: 'ui:practice-plan',
    fields,
  });
  if (!result.ok) {
    widget.renderError(describeError(result.code, result.error, true));
    return;
  }
  plan = result.data.plan;
  widget.setMeta({ title: 'Practice application', profileName: result.data.profileName });
  widget.renderPlan(plan);
  widget.focus();
}

void scan();
