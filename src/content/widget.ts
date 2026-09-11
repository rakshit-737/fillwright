import type { CanonicalField, FieldSignals, FillPlan, FillPlanEntry } from '@/types/fields';
import { renderReviewList } from './review';
import { WIDGET_CSS } from './styles';

/**
 * The on-page Fillwright panel.
 *
 * Rendered entirely inside a closed-off shadow root, for two reasons: the
 * page's CSS cannot reach in and restyle (or hide) the controls the user is
 * relying on, and the panel's own styles cannot leak out and disturb the
 * application form.
 *
 * Built with explicit DOM calls throughout. Nothing here uses innerHTML, so no
 * string taken from the page — a label, a value, a heading — can become markup.
 */

export interface WidgetCallbacks {
  onFill: (entries: FillPlanEntry[]) => void;
  onUndo: () => void;
  onClose: () => void;
  onRescan: () => void;
  /** The user corrected what a field means. */
  onTeach: (entry: FillPlanEntry, field: CanonicalField, remember: boolean) => void;
}

export interface FillSummary {
  filled: number;
  /** Fields that were attempted and did not take, with the reason for each. */
  failures: Array<{ label: string; reason: string; entry: FillPlanEntry }>;
  /** Fields still needing the user: review, consent, essays, missing values. */
  remaining: number;
}

export class FillwrightWidget {
  private host: HTMLElement;
  private root: ShadowRoot;
  private panel!: HTMLElement;
  private plan: FillPlan | null = null;
  private selection = new Set<string>();
  private expanded = false;
  private canUndo = false;
  /** Rows whose "Why?" explanation is open. */
  private explanations = new Set<string>();
  /** Rows whose correction picker is open. */
  private teaching = new Set<string>();
  /** Developer diagnostics, off unless explicitly switched on in settings. */
  private diagnostics = false;
  private signals = new Map<string, FieldSignals>();

  constructor(private callbacks: WidgetCallbacks, reducedMotion: boolean) {
    this.host = document.createElement('div');
    // data-fillwright-ui marks the subtree so the harvester skips its own
    // controls; data-fillwright-widget identifies THIS element specifically,
    // because other injected nodes (the highlight stylesheet) also carry the
    // former and a bare lookup could otherwise land on the wrong one.
    this.host.setAttribute('data-fillwright-ui', '');
    this.host.setAttribute('data-fillwright-widget', '');
    this.host.style.cssText = 'all: initial; position: fixed; z-index: 2147483647;';

    this.root = this.host.attachShadow({ mode: 'open' });

    const style = document.createElement('style');
    style.textContent = WIDGET_CSS;
    this.root.appendChild(style);

    const container = document.createElement('div');
    container.className = 'fw-widget';
    if (reducedMotion) container.setAttribute('data-reduced-motion', 'true');
    this.root.appendChild(container);
    this.panel = container;

    document.documentElement.appendChild(this.host);
    this.renderLoading();
  }

  destroy(): void {
    this.host.remove();
  }

  /* -------------------------------------------------------------- states */

  renderLoading(): void {
    this.clear();
    const card = this.card();
    card.appendChild(this.header('Scanning this page…'));
    const body = el('div', 'fw-body');
    body.appendChild(el('p', 'fw-muted', 'Looking for application fields.'));
    card.appendChild(body);
  }

  renderError(message: string): void {
    this.clear();
    const card = this.card();
    card.appendChild(this.header('Fillwright'));
    const body = el('div', 'fw-body');
    body.appendChild(el('p', 'fw-error', message));
    const actions = el('div', 'fw-actions');
    actions.appendChild(this.button('Try again', 'ghost', () => this.callbacks.onRescan()));
    body.appendChild(actions);
    card.appendChild(body);
  }

  /**
   * A locked vault is an expected state, not a failure, so it gets its own
   * screen with the one action that resolves it rather than a red error.
   */
  renderLocked(onUnlock: () => void): void {
    this.clear();
    const card = this.card();
    card.appendChild(this.header('Fillwright is locked'));

    const body = el('div', 'fw-body');
    body.appendChild(
      el(
        'p',
        'fw-muted',
        'Your profile is encrypted. Unlock Fillwright to fill this application.',
      ),
    );

    const actions = el('div', 'fw-actions');
    actions.appendChild(this.button('Unlock Fillwright', 'primary', onUnlock));
    actions.appendChild(this.button('Not now', 'ghost', () => this.callbacks.onClose()));
    body.appendChild(actions);
    card.appendChild(body);
  }

  /**
   * Supplies the raw detection signals for diagnostics.
   *
   * They stay in this page: diagnostics exist to debug a form that maps badly,
   * and shipping them anywhere would turn a debugging aid into a data leak.
   */
  setDiagnostics(enabled: boolean, signals: Map<string, FieldSignals>): void {
    this.diagnostics = enabled;
    this.signals = signals;
  }

  renderPlan(plan: FillPlan): void {
    this.plan = plan;
    this.selection = new Set(plan.entries.filter((entry) => entry.selected).map((entry) => entry.fieldId));
    this.draw();
  }

  markFilled(summary: FillSummary): void {
    this.canUndo = summary.filled > 0;
    this.clear();
    const card = this.card();
    card.appendChild(this.header('Fillwright'));

    const body = el('div', 'fw-body');

    body.appendChild(
      el(
        'p',
        'fw-done',
        summary.filled > 0
          ? `Filled ${summary.filled} field${summary.filled === 1 ? '' : 's'}.`
          : 'Nothing was filled.',
      ),
    );

    // A partial fill is a normal outcome, not an error state. The counts stay
    // visible so the user knows exactly what is left rather than having to
    // re-read the whole form to find out.
    const counts = el('div', 'fw-summary');
    counts.appendChild(this.stat(String(summary.filled), 'filled', 'ok'));
    if (summary.failures.length > 0) {
      counts.appendChild(this.stat(String(summary.failures.length), 'did not take', 'caution'));
    }
    if (summary.remaining > 0) {
      counts.appendChild(this.stat(String(summary.remaining), 'left for you'));
    }
    body.appendChild(counts);

    if (summary.failures.length > 0) {
      const list = el('ul', 'fw-list');
      list.setAttribute('aria-label', 'Fields that could not be filled');
      for (const failure of summary.failures.slice(0, 6)) {
        const item = el('li', 'fw-item fw-item--caution');
        const row = el('div', 'fw-item__row');
        const text = el('span', 'fw-item__text');
        text.appendChild(el('span', 'fw-item__label', failure.label));
        text.appendChild(el('span', 'fw-item__status', failure.reason));
        row.appendChild(text);
        item.appendChild(row);
        list.appendChild(item);
      }
      body.appendChild(list);
    }

    body.appendChild(
      el(
        'p',
        'fw-note',
        'Review the form, then submit it yourself. Fillwright never submits an application.',
      ),
    );

    const actions = el('div', 'fw-actions');
    if (summary.failures.length > 0) {
      actions.appendChild(
        this.button('Try those again', 'ghost', () => {
          this.callbacks.onFill(
            summary.failures.map((failure) => ({ ...failure.entry, selected: true })),
          );
        }),
      );
    }
    if (this.canUndo) actions.appendChild(this.button('Undo', 'ghost', () => this.callbacks.onUndo()));
    actions.appendChild(this.button('Done', 'primary', () => this.callbacks.onClose()));
    body.appendChild(actions);

    card.appendChild(body);
  }

  markUndone(restored: number): void {
    this.clear();
    const card = this.card();
    card.appendChild(this.header('Fillwright'));
    const body = el('div', 'fw-body');
    body.appendChild(el('p', 'fw-done', `Restored ${restored} field${restored === 1 ? '' : 's'}.`));
    const actions = el('div', 'fw-actions');
    actions.appendChild(this.button('Scan again', 'ghost', () => this.callbacks.onRescan()));
    actions.appendChild(this.button('Close', 'primary', () => this.callbacks.onClose()));
    body.appendChild(actions);
    card.appendChild(body);
  }

  /* ------------------------------------------------------------ rendering */

  private draw(): void {
    const plan = this.plan;
    if (!plan) return;

    this.clear();
    const card = this.card();
    card.appendChild(this.header('Fillwright'));

    const body = el('div', 'fw-body');

    if (plan.entries.length === 0) {
      body.appendChild(el('p', 'fw-muted', 'No application fields were found on this page.'));
      const actions = el('div', 'fw-actions');
      actions.appendChild(this.button('Scan again', 'ghost', () => this.callbacks.onRescan()));
      actions.appendChild(this.button('Close', 'primary', () => this.callbacks.onClose()));
      body.appendChild(actions);
      card.appendChild(body);
      return;
    }

    const summary = el('div', 'fw-summary');
    summary.appendChild(this.stat(String(plan.entries.length), 'detected'));
    summary.appendChild(this.stat(String(plan.readyCount), 'ready', 'ok'));
    if (plan.reviewCount > 0) summary.appendChild(this.stat(String(plan.reviewCount), 'need you', 'caution'));
    if (plan.skippedCount > 0) summary.appendChild(this.stat(String(plan.skippedCount), 'already filled'));
    body.appendChild(summary);

    if (this.expanded) {
      body.appendChild(this.list(plan));
    }

    const actions = el('div', 'fw-actions');
    actions.appendChild(
      this.button(this.expanded ? 'Hide details' : 'Review', 'ghost', () => {
        this.expanded = !this.expanded;
        this.draw();
      }),
    );
    const count = this.selection.size;
    const fill = this.button(
      count === 0 ? 'Nothing selected' : `Fill ${count} field${count === 1 ? '' : 's'}`,
      'primary',
      () => {
        const entries = plan.entries.map((entry) => ({
          ...entry,
          selected: this.selection.has(entry.fieldId),
        }));
        this.callbacks.onFill(entries);
      },
    );
    if (count === 0) fill.setAttribute('disabled', 'true');
    actions.appendChild(fill);
    body.appendChild(actions);

    body.appendChild(el('p', 'fw-note', 'Fillwright never submits an application. That is always your click.'));
    card.appendChild(body);
  }

  private list(plan: FillPlan): HTMLElement {
    return renderReviewList(plan.entries, this.selection, this.explanations, this.teaching, {
      diagnostics: this.diagnostics ? this.signals : null,
      onToggle: (fieldId, selected) => {
        if (selected) this.selection.add(fieldId);
        else this.selection.delete(fieldId);
        this.draw();
      },
      onTeach: (entry, field, remember) => {
        this.teaching.delete(entry.fieldId);
        this.callbacks.onTeach(entry, field, remember);
      },
      onExplainToggle: () => this.draw(),
    });
  }

  /* --------------------------------------------------------------- pieces */

  private card(): HTMLElement {
    const card = el('div', 'fw-card');
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-label', 'Fillwright');
    this.panel.appendChild(card);
    return card;
  }

  private header(title: string): HTMLElement {
    const header = el('div', 'fw-header');
    const brand = el('div', 'fw-brand');
    brand.appendChild(el('span', 'fw-mark'));
    brand.appendChild(el('span', 'fw-title', title));
    header.appendChild(brand);

    const close = document.createElement('button');
    close.className = 'fw-close';
    close.type = 'button';
    close.setAttribute('aria-label', 'Close Fillwright');
    close.textContent = '×';
    close.addEventListener('click', () => this.callbacks.onClose());
    header.appendChild(close);
    return header;
  }

  private stat(value: string, label: string, tone = ''): HTMLElement {
    const stat = el('div', `fw-stat${tone ? ` fw-stat--${tone}` : ''}`);
    stat.appendChild(el('span', 'fw-stat__value', value));
    stat.appendChild(el('span', 'fw-stat__label', label));
    return stat;
  }

  private button(label: string, variant: 'primary' | 'ghost', onClick: () => void): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `fw-btn fw-btn--${variant}`;
    button.textContent = label;
    button.addEventListener('click', onClick);
    return button;
  }

  private clear(): void {
    this.panel.replaceChildren();
  }
}

function el(tag: string, className = '', text = ''): HTMLElement {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}
