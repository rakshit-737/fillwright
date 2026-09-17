/**
 * Cheap change detection for the content script.
 *
 * Trust boundary: runs in every page the content script is on — in Assist
 * and Smart modes, that is every https page the user visits — so it must cost
 * next to nothing. It reads node types and one attribute; it never queries
 * the document from inside a MutationObserver callback, and it never reads
 * page text or values.
 */

const CONTROL_TAGS = new Set(['INPUT', 'SELECT', 'TEXTAREA']);

/**
 * True when a mutation batch might have added or removed a form control.
 *
 * Deliberately over-inclusive and O(nodes): an element that is itself a
 * control, or that has element children (and so might contain one), counts.
 * The expensive "did the form really change?" question is answered later, in
 * `controlSignature`, off the observer callback.
 */
export function mutationsMayAffectForm(records: MutationRecord[]): boolean {
  for (const record of records) {
    if (record.type !== 'childList') continue;
    if (touches(record.addedNodes) || touches(record.removedNodes)) return true;
  }
  return false;
}

function touches(nodes: NodeList): boolean {
  for (let i = 0; i < nodes.length; i += 1) {
    const node = nodes[i]!;
    if (node.nodeType !== 1) continue;
    const element = node as Element;
    if (element.hasAttribute('data-fillwright-ui')) continue;
    if (CONTROL_TAGS.has(element.tagName) || element.firstElementChild !== null) return true;
  }
  return false;
}

/**
 * A fingerprint of the page's form controls: how many there are, and the
 * identity of the first and last. Two equal signatures mean a mutation burst
 * did not change the form, so no rescan is needed. Called off the observer.
 */
export function controlSignature(doc: Document): string {
  const controls = doc.getElementsByTagName('input').length;
  const selects = doc.getElementsByTagName('select').length;
  const areas = doc.getElementsByTagName('textarea').length;
  const all = doc.querySelectorAll('input, select, textarea');
  const first = all[0];
  const last = all[all.length - 1];
  const id = (element: Element | undefined) =>
    element ? `${element.tagName}#${element.id}|${element.getAttribute('name') ?? ''}` : '';
  return `${controls}/${selects}/${areas}|${id(first)}|${id(last)}`;
}

/**
 * Runs `task` at most once per `intervalMs`, and never while the page is
 * scrolling. Calls in between are coalesced into one trailing run.
 */
export function createThrottle(
  task: () => void | Promise<void>,
  options: { intervalMs: number; scrollQuietMs: number; now?: () => number },
) {
  const now = options.now ?? (() => Date.now());
  let lastRun = -Infinity;
  let lastScroll = -Infinity;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let runs = 0;

  const fire = () => {
    timer = undefined;
    const time = now();
    const wait = Math.max(
      lastRun + options.intervalMs - time,
      lastScroll + options.scrollQuietMs - time,
    );
    if (wait > 0) {
      timer = setTimeout(fire, wait);
      return;
    }
    lastRun = time;
    runs += 1;
    void task();
  };

  return {
    schedule(): void {
      if (timer === undefined) timer = setTimeout(fire, 0);
    },
    noteScroll(): void {
      lastScroll = now();
    },
    cancel(): void {
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
    },
    get runs(): number {
      return runs;
    },
  };
}
