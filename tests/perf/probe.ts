/**
 * Performance probe — built ONLY into the end-to-end test build
 * (dist-e2e/perf-probe.js) and injected by scripts/perf.mjs into the
 * extension's isolated world. Never shipped.
 *
 * Trust boundary: test code. Exposes timing helpers on the isolated world's
 * global object, which page scripts cannot see.
 */
import { harvestFields } from '@/field-detection/harvest';
import { classifyField } from '@/field-detection/classify';
import { mutationsMayAffectForm } from '@/content/observe';

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

/** The observer check as it shipped in v0.4.0, for a before/after figure. */
function legacyObserverCheck(records: MutationRecord[]): boolean {
  return records.some((record) =>
    [...Array.from(record.addedNodes), ...Array.from(record.removedNodes)].some((node) => {
      if (!(node instanceof HTMLElement)) return false;
      if (node.closest?.('[data-fillwright-ui]') || node.hasAttribute('data-fillwright-ui')) {
        return false;
      }
      return Boolean(
        node.matches?.('input, select, textarea') ||
        node.querySelector?.('input, select, textarea'),
      );
    }),
  );
}

async function observerCost(
  check: (records: MutationRecord[]) => boolean,
  nodes: number,
): Promise<number> {
  // Worst case for the check: a large burst of container nodes, each with
  // deep non-control content, none of which is a form control.
  const host = document.createElement('div');
  document.body.appendChild(host);
  const records = await new Promise<MutationRecord[]>((resolve) => {
    const observer = new MutationObserver((batch) => {
      observer.disconnect();
      resolve(batch);
    });
    observer.observe(host, { childList: true, subtree: true });
    const fragment = document.createDocumentFragment();
    for (let i = 0; i < nodes; i += 1) {
      const card = document.createElement('div');
      for (let j = 0; j < 20; j += 1) {
        const span = document.createElement('span');
        span.textContent = `item ${i}.${j}`;
        card.appendChild(span);
      }
      fragment.appendChild(card);
    }
    host.appendChild(fragment);
    for (const child of Array.from(host.children).slice(0, nodes / 2)) child.remove();
  });
  const times: number[] = [];
  for (let run = 0; run < 9; run += 1) {
    const start = performance.now();
    check(records);
    times.push(performance.now() - start);
  }
  host.remove();
  return median(times);
}

(globalThis as unknown as Record<string, unknown>).__fwPerf = {
  harvestClassify(runs = 9): number {
    const times: number[] = [];
    for (let run = 0; run < runs; run += 1) {
      const start = performance.now();
      const { fields } = harvestFields(document);
      for (const field of fields) classifyField(field.signals);
      times.push(performance.now() - start);
    }
    return median(times);
  },
  async observer(nodes = 2_000): Promise<{ current: number; legacy: number }> {
    return {
      current: await observerCost(mutationsMayAffectForm, nodes),
      legacy: await observerCost(legacyObserverCheck, nodes),
    };
  },
};
