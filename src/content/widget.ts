import type { CanonicalField, FieldSignals, FillPlan, FillPlanEntry } from '@/types/fields';
import type { JobMatch } from '@/autofill/job-match';
import type { RepeatKind } from '@/autofill/repeat';
import { renderReviewList, type DraftView } from './review';
import { WIDGET_CSS } from './styles';
import type { UserError } from '@/utils/errors';

/**
 * The on-page Fillwright panel.
 *
 * Rendered inside a CLOSED shadow root. The page's CSS cannot restyle or hide
 * the controls, the panel's styles cannot leak into the form, and — because
 * the root is closed — the page's own scripts cannot read the preview. The
 * preview shows values before the user approves them, sensitive answers
 * included; an open root would hand them to any script on the page first.
 *
 * Built with explicit DOM calls throughout. Nothing here uses innerHTML, so no
 * string taken from the page — a label, a value, a heading — can become markup.
 *
 * The panel is a small state machine. Each state has exactly one renderer, so
 * what the user sees always matches what Fillwright is doing.
 */

export type WidgetState =
  | 'idle'
  | 'detected'
  | 'analyzing'
  | 'ready'
  | 'review'
  | 'filling'
  | 'success'
  | 'partial'
  | 'error'
  | 'locked'
  | 'undo';

export interface ProfileChoice {
  id: string;
  name: string;
  active: boolean;
}

export interface AddOffer {
  kind: RepeatKind;
  missing: number;
}

export interface PageMeta {
  /** A short page heading, e.g. "Software Engineer — Acme". Page text. */
  title: string;
  profileName: string;
  /** Fields filled on earlier steps of this application, in this tab. */
  progress: { steps: number; filled: number } | null;
  jobMatch: JobMatch | null;
  addOffers: AddOffer[];
  /** A one-line, non-blocking message, e.g. "could not remember that". */
  notice?: string;
}

export interface WidgetCallbacks {
  onFill: (entries: FillPlanEntry[]) => void;
  onUndo: () => void;
  onClose: () => void;
  onRescan: () => void;
  /** The user corrected what a field means. */
  onTeach: (entry: FillPlanEntry, field: CanonicalField, remember: boolean) => void;
  onListProfiles: () => Promise<ProfileChoice[]>;
  onSwitchProfile: (profileId: string) => void;
  onAddEntries: (offer: AddOffer) => void;
  onUnlock: () => void;
  /** Opens one of Fillwright's own pages (import, privacy, …). */
  onOpenPage: (route: string) => void;
  onReload: () => void;
  /** Whether a written question can be drafted at all (AI on and available). */
  canDraft: (entry: FillPlanEntry) => boolean;
  onDraftStart: (entry: FillPlanEntry) => void;
  onDraftGenerate: (entry: FillPlanEntry, factIds: string[]) => void;
  onDraftUse: (entry: FillPlanEntry, text: string) => void;
  /** The draft panel was closed: stop any draft still being written. */
  onDraftStop?: (entry: FillPlanEntry) => void;
}

export interface FillSummary {
  filled: number;
  /** Fields that were attempted and did not take, with the reason for each. */
  failures: Array<{ label: string; reason: string; entry: FillPlanEntry; retryable: boolean }>;
  /** Fields still needing the user: review, consent, essays, missing values. */
  remaining: number;
  /** Written answers still to do. */
  manual: number;
}

const POSITION_KEY = '__fillwrightPanelPosition';

export class FillwrightWidget {
  private host: HTMLElement;
  private root: ShadowRoot;
  private panel: HTMLElement;
  private live: HTMLElement;

  state: WidgetState = 'idle';
  private plan: FillPlan | null = null;
  private meta: PageMeta = {
    title: '',
    profileName: '',
    progress: null,
    jobMatch: null,
    addOffers: [],
  };
  private selection = new Set<string>();
  private canUndo = false;
  private stale = false;
  private minimized = false;
  private lastSummary: FillSummary | null = null;
  private lastError: UserError = { message: '', action: 'retry', actionLabel: 'Try again' };
  private detectedCount = 0;
  /** The page element focused before the panel took focus. */
  private returnFocus: HTMLElement | null = null;
  private suppressFocus = false;
  private lastAnnounced = '';

  /** Rows whose "Why?" explanation is open. */
  private explanations = new Set<string>();
  /** Rows whose correction picker is open. */
  private teaching = new Set<string>();
  /** Drafting panels, per field. */
  drafts = new Map<string, DraftView>();
  private profiles: ProfileChoice[] | null = null;
  private showProfiles = false;
  private showMatch = false;

  /** Developer diagnostics, off unless explicitly switched on in settings. */
  private diagnostics = false;
  private signals = new Map<string, FieldSignals>();

  constructor(
    private callbacks: WidgetCallbacks,
    reducedMotion: boolean,
  ) {
    this.host = document.createElement('div');
    // data-fillwright-ui marks the subtree so the harvester skips its own
    // controls; data-fillwright-widget identifies THIS element specifically.
    this.host.setAttribute('data-fillwright-ui', '');
    this.host.setAttribute('data-fillwright-widget', '');
    this.host.style.cssText = 'all: initial; position: fixed; z-index: 2147483647;';

    this.root = this.host.attachShadow({ mode: 'closed' });

    const style = document.createElement('style');
    style.textContent = WIDGET_CSS;
    this.root.appendChild(style);

    const container = document.createElement('div');
    container.className = 'fw-widget';
    if (reducedMotion) container.setAttribute('data-reduced-motion', 'true');
    container.addEventListener('keydown', (event) => this.onKeyDown(event));
    this.root.appendChild(container);
    this.panel = container;

    // Announces state changes to screen readers without moving focus.
    this.live = el('div', 'fw-sr');
    this.live.setAttribute('aria-live', 'polite');
    this.root.appendChild(this.live);

    this.restorePosition();
    document.documentElement.appendChild(this.host);
  }

  destroy(): void {
    this.restoreFocus();
    this.host.remove();
  }

  /** For the end-to-end harness and tests; the page itself cannot call this. */
  get shadow(): ShadowRoot {
    return this.root;
  }

  /* ------------------------------------------------------------ inputs */

  setDiagnostics(enabled: boolean, signals: Map<string, FieldSignals>): void {
    this.diagnostics = enabled;
    this.signals = signals;
  }

  setMeta(patch: Partial<PageMeta>): void {
    this.meta = { ...this.meta, ...patch };
    if (this.state === 'ready' || this.state === 'review') this.draw();
  }

  /** The page changed under a plan the user is looking at. */
  markStale(): void {
    if (this.stale) return;
    this.stale = true;
    if (this.state === 'ready' || this.state === 'review') this.draw();
  }

  /* ------------------------------------------------------------ states */

  renderDetected(fieldCount: number): void {
    this.detectedCount = fieldCount;
    this.go('detected');
  }

  renderAnalyzing(): void {
    this.go('analyzing');
  }

  renderError(error: UserError): void {
    this.lastError = error;
    this.go('error');
  }

  renderLocked(): void {
    this.go('locked');
  }

  renderPlan(plan: FillPlan): void {
    const keepReview = this.state === 'review';
    this.plan = plan;
    this.stale = false;
    this.selection = new Set(
      plan.entries.filter((entry) => entry.selected).map((entry) => entry.fieldId),
    );
    // Drafts and pickers refer to fields of the previous scan.
    const ids = new Set(plan.entries.map((entry) => entry.fieldId));
    for (const id of [...this.drafts.keys()]) if (!ids.has(id)) this.drafts.delete(id);
    this.go(keepReview ? 'review' : 'ready');
  }

  renderFilling(): void {
    this.go('filling');
  }

  markFilled(summary: FillSummary): void {
    this.canUndo = summary.filled > 0 || this.canUndo;
    this.lastSummary = summary;
    this.go(summary.failures.length > 0 || summary.remaining > 0 ? 'partial' : 'success');
  }

  markUndone(restored: number): void {
    this.canUndo = false;
    this.lastSummary = { filled: restored, failures: [], remaining: 0, manual: 0 };
    this.go('undo');
  }

  /** Re-renders the current state, e.g. after a draft finished. */
  refresh(): void {
    this.draw();
  }

  private go(state: WidgetState): void {
    this.state = state;
    this.minimized = false;
    this.draw();
    this.announce();
  }

  private announce(): void {
    const plan = this.plan;
    const summary = this.lastSummary;
    const text: Partial<Record<WidgetState, string>> = {
      detected: 'Fillwright found an application form.',
      analyzing: 'Fillwright is reading this form.',
      ready: plan
        ? `${plan.entries.length} application fields found. ${plan.readyCount} ready.`
        : '',
      filling: 'Filling fields.',
      success: summary ? `Application form filled. ${summary.filled} fields updated.` : '',
      partial: summary ? `${summary.filled} fields updated. Some need your attention.` : '',
      error: this.lastError.message,
      locked: 'Fillwright is locked.',
      undo: summary ? `Restored ${summary.filled} fields.` : '',
    };
    // Announce a change once. Redrawing the same state (opening the list,
    // a quiet rescan with the same counts) must not repeat it.
    const next = text[this.state] ?? '';
    if (!next || next === this.lastAnnounced) return;
    this.lastAnnounced = next;
    this.live.textContent = next;
  }

  /* ------------------------------------------------------------ drawing */

  private draw(): void {
    const hadFocus = this.root.activeElement !== null;
    this.panel.replaceChildren();
    this.panel.setAttribute('data-state', this.state);

    if (this.minimized) {
      this.drawPill();
      if (hadFocus && !this.suppressFocus) this.focusFirst();
      return;
    }

    switch (this.state) {
      case 'idle':
        return;
      case 'detected':
        this.drawDetected();
        break;
      case 'analyzing':
        this.drawBusy('Reading this form…', 'Matching fields to your profile, on this device.');
        break;
      case 'filling':
        this.drawBusy(
          'Filling the form…',
          'Nothing is submitted. You stay in control of the final click.',
        );
        break;
      case 'ready':
      case 'review':
        this.drawPlan();
        break;
      case 'success':
      case 'partial':
        this.drawFilled();
        break;
      case 'undo':
        this.drawUndone();
        break;
      case 'error':
        this.drawError();
        break;
      case 'locked':
        this.drawLocked();
        break;
    }
    if (hadFocus) this.focusFirst();
  }

  private drawPill(): void {
    const pill = document.createElement('button');
    pill.type = 'button';
    pill.className = 'fw-pill';
    pill.setAttribute('aria-label', 'Open Fillwright');
    pill.appendChild(el('span', 'fw-mark'));
    const plan = this.plan;
    pill.appendChild(
      el(
        'span',
        '',
        plan && (this.state === 'ready' || this.state === 'review')
          ? `${plan.readyCount} ready`
          : 'Fillwright',
      ),
    );
    pill.addEventListener('click', () => {
      this.minimized = false;
      this.draw();
      this.focusFirst();
    });
    this.panel.appendChild(pill);
  }

  private drawDetected(): void {
    const card = this.card('Application form found');
    const body = this.body(card);
    body.appendChild(
      el(
        'p',
        'fw-muted',
        `This page looks like a job application with ${this.detectedCount} field${
          this.detectedCount === 1 ? '' : 's'
        }. Fillwright can match them to your profile — nothing is filled until you approve.`,
      ),
    );
    const actions = el('div', 'fw-actions');
    actions.appendChild(this.button('Not now', 'ghost', () => this.callbacks.onClose()));
    actions.appendChild(
      this.button('Review with Fillwright', 'primary', () => this.callbacks.onRescan()),
    );
    body.appendChild(actions);
  }

  private drawBusy(title: string, detail: string): void {
    const card = this.card(title);
    const body = this.body(card);
    const row = el('div', 'fw-busy');
    row.appendChild(el('span', 'fw-spinner'));
    row.appendChild(el('p', 'fw-muted', detail));
    body.appendChild(row);
  }

  /**
   * One error screen: what happened, and exactly one thing to do about it.
   * "Close" is always available and is not counted as an action.
   */
  private drawError(): void {
    const error = this.lastError;
    const card = this.card('Fillwright couldn’t finish');
    const body = this.body(card);
    const message = el('p', 'fw-error', error.message || 'Fillwright couldn’t finish.');
    message.setAttribute('role', 'alert');
    body.appendChild(message);

    const actions = el('div', 'fw-actions');
    actions.appendChild(this.button('Close', 'ghost', () => this.callbacks.onClose()));
    const run = this.actionFor(error);
    if (run) actions.appendChild(this.button(error.actionLabel, 'primary', run));
    body.appendChild(actions);
  }

  private actionFor(error: UserError): (() => void) | null {
    switch (error.action) {
      case 'retry':
        return () => this.callbacks.onRescan();
      case 'reload-page':
        return () => this.callbacks.onReload();
      case 'unlock':
        return () => this.callbacks.onUnlock();
      case 'open-import':
        return () => this.callbacks.onOpenPage('import');
      case 'open-privacy':
        return () => this.callbacks.onOpenPage('privacy');
      case 'open-settings':
        return () => this.callbacks.onOpenPage('assistance');
      default:
        return null;
    }
  }

  /**
   * A locked vault is an expected state, not a failure, so it gets its own
   * screen with the one action that resolves it rather than a red error.
   */
  private drawLocked(): void {
    const card = this.card('Fillwright is locked');
    const body = this.body(card);
    body.appendChild(
      el('p', 'fw-muted', 'Your profile is encrypted. Unlock Fillwright to fill this application.'),
    );
    const actions = el('div', 'fw-actions');
    actions.appendChild(this.button('Not now', 'ghost', () => this.callbacks.onClose()));
    actions.appendChild(
      this.button('Unlock Fillwright', 'primary', () => this.callbacks.onUnlock()),
    );
    body.appendChild(actions);
  }

  private drawPlan(): void {
    const plan = this.plan;
    if (!plan) return;
    const reviewing = this.state === 'review';

    const card = this.card(this.meta.title || 'Fillwright');
    const body = this.body(card);

    body.appendChild(this.profileLine());

    if (this.meta.notice) {
      const notice = el('p', 'fw-note fw-note--warn', this.meta.notice);
      notice.setAttribute('role', 'status');
      body.appendChild(notice);
    }

    if (this.stale) {
      const banner = el('div', 'fw-banner');
      banner.appendChild(el('span', '', 'This page changed since Fillwright read it.'));
      banner.appendChild(this.link('Refresh', () => this.callbacks.onRescan()));
      body.appendChild(banner);
    }

    if (plan.entries.length === 0) {
      body.appendChild(el('p', 'fw-muted', 'No application fields on this part of the page.'));
      body.appendChild(
        el(
          'p',
          'fw-note',
          'If the form appears later — on the next step, or after a click — Fillwright will notice.',
        ),
      );
      const actions = el('div', 'fw-actions');
      actions.appendChild(this.button('Close', 'ghost', () => this.callbacks.onClose()));
      actions.appendChild(this.button('Scan again', 'primary', () => this.callbacks.onRescan()));
      body.appendChild(actions);
      return;
    }

    const counts = countsFor(plan);
    const headline = el(
      'p',
      'fw-lead',
      `${plan.entries.length} application field${plan.entries.length === 1 ? '' : 's'} found`,
    );
    body.appendChild(headline);

    const summary = el('div', 'fw-tally');
    summary.appendChild(this.tally('✓', `${counts.ready} ready`, 'ok'));
    if (counts.review > 0)
      summary.appendChild(this.tally('!', `${counts.review} to review`, 'caution'));
    if (counts.needsYou > 0)
      summary.appendChild(this.tally('•', `${counts.needsYou} need you`, 'caution'));
    if (counts.filled > 0)
      summary.appendChild(this.tally('–', `${counts.filled} already filled`, 'muted'));
    body.appendChild(summary);

    if (this.meta.progress && this.meta.progress.filled > 0) {
      body.appendChild(
        el(
          'p',
          'fw-note',
          `Earlier steps of this application: ${this.meta.progress.filled} field${
            this.meta.progress.filled === 1 ? '' : 's'
          } filled.`,
        ),
      );
    }

    for (const offer of this.meta.addOffers) {
      const notice = el('div', 'fw-banner');
      notice.appendChild(
        el(
          'span',
          '',
          `Your profile has ${offer.missing} more ${offer.kind} ${offer.missing === 1 ? 'entry' : 'entries'} than this form shows.`,
        ),
      );
      notice.appendChild(
        this.link(`Add ${offer.missing === 1 ? 'it' : 'them'}`, () =>
          this.callbacks.onAddEntries(offer),
        ),
      );
      body.appendChild(notice);
    }

    if (this.meta.jobMatch) body.appendChild(this.jobMatch(this.meta.jobMatch));

    if (reviewing) {
      body.appendChild(
        renderReviewList(plan.entries, this.selection, this.explanations, this.teaching, {
          diagnostics: this.diagnostics ? this.signals : null,
          drafts: this.drafts,
          canDraft: (entry) => this.callbacks.canDraft(entry),
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
          onDraftStart: (entry) => this.callbacks.onDraftStart(entry),
          onDraftGenerate: (entry, facts) => this.callbacks.onDraftGenerate(entry, facts),
          onDraftUse: (entry, text) => this.callbacks.onDraftUse(entry, text),
          onDraftCancel: (entry) => {
            this.drafts.delete(entry.fieldId);
            this.callbacks.onDraftStop?.(entry);
            this.draw();
          },
        }),
      );
    }

    const actions = el('div', 'fw-actions');
    const toggle = this.button(reviewing ? 'Hide list' : 'Review', 'ghost', () => {
      this.go(reviewing ? 'ready' : 'review');
    });
    toggle.setAttribute('aria-expanded', String(reviewing));
    actions.appendChild(toggle);

    const count = this.selection.size;
    const fill = this.button(
      count === 0
        ? 'Nothing selected'
        : reviewing
          ? `Fill ${count} field${count === 1 ? '' : 's'}`
          : `Fill ${count} ready`,
      'primary',
      () => {
        const entries = plan.entries.map((entry) => ({
          ...entry,
          selected: this.selection.has(entry.fieldId),
        }));
        this.callbacks.onFill(entries);
      },
    );
    if (count === 0) fill.disabled = true;
    actions.appendChild(fill);
    body.appendChild(actions);

    body.appendChild(
      el('p', 'fw-note', 'Fillwright never submits an application. That is always your click.'),
    );
  }

  private drawFilled(): void {
    const summary = this.lastSummary!;
    const complete = this.state === 'success';
    const card = this.card(complete ? 'Application form filled' : 'Form partly filled');
    const body = this.body(card);

    body.appendChild(
      el(
        'p',
        complete ? 'fw-done' : 'fw-lead',
        summary.filled > 0
          ? `${summary.filled} field${summary.filled === 1 ? '' : 's'} updated`
          : 'No fields were changed',
      ),
    );

    // A partial fill is a normal outcome, not an error state. The counts stay
    // visible so the user knows exactly what is left.
    const tally = el('div', 'fw-tally');
    if (summary.failures.length > 0) {
      tally.appendChild(this.tally('!', `${summary.failures.length} did not take`, 'caution'));
    }
    const review = summary.remaining - summary.manual;
    if (review > 0) tally.appendChild(this.tally('•', `${review} left for review`, 'caution'));
    if (summary.manual > 0)
      tally.appendChild(this.tally('✎', `${summary.manual} need your input`, 'muted'));
    if (tally.childElementCount > 0) body.appendChild(tally);

    // When the page refused every single value, one sentence explains it
    // better than a list of identical failures.
    const allRejected = summary.filled === 0 && summary.failures.length >= 3;
    if (allRejected) {
      const note = el(
        'p',
        'fw-error',
        `This form didn’t accept any of the ${summary.failures.length} values — its own code rejected them. Nothing on the form was changed. You can still fill it in by hand.`,
      );
      note.setAttribute('role', 'alert');
      body.appendChild(note);
    } else if (summary.failures.length > 0) {
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
        'Check the form, then submit it yourself. Fillwright never submits an application.',
      ),
    );

    const actions = el('div', 'fw-actions');
    const retryable = allRejected ? [] : summary.failures.filter((failure) => failure.retryable);
    if (retryable.length > 0) {
      actions.appendChild(
        this.button('Try again', 'ghost', () => {
          this.callbacks.onFill(retryable.map((failure) => ({ ...failure.entry, selected: true })));
        }),
      );
    }
    if (this.canUndo)
      actions.appendChild(this.button('Undo', 'ghost', () => this.callbacks.onUndo()));
    if (!complete && this.plan) {
      actions.appendChild(this.button('Review the rest', 'ghost', () => this.callbacks.onRescan()));
    }
    actions.appendChild(this.button('Done', 'primary', () => this.minimize()));
    body.appendChild(actions);
  }

  private drawUndone(): void {
    const card = this.card('Changes undone');
    const body = this.body(card);
    const restored = this.lastSummary?.filled ?? 0;
    body.appendChild(
      el(
        'p',
        'fw-lead',
        `Restored ${restored} field${restored === 1 ? '' : 's'} to how they were.`,
      ),
    );
    const actions = el('div', 'fw-actions');
    actions.appendChild(this.button('Close', 'ghost', () => this.callbacks.onClose()));
    actions.appendChild(this.button('Scan again', 'primary', () => this.callbacks.onRescan()));
    body.appendChild(actions);
  }

  /* ------------------------------------------------------------ sections */

  private profileLine(): HTMLElement {
    const line = el('div', 'fw-profile');
    line.appendChild(el('span', 'fw-note', 'Profile'));
    line.appendChild(el('span', 'fw-profile__name', this.meta.profileName || 'Active profile'));
    const toggle = this.link(this.showProfiles ? 'Cancel' : 'Switch', () => {
      this.showProfiles = !this.showProfiles;
      if (this.showProfiles && this.profiles === null) {
        void this.callbacks.onListProfiles().then((profiles) => {
          this.profiles = profiles;
          this.draw();
        });
      }
      this.draw();
    });
    toggle.setAttribute('aria-expanded', String(this.showProfiles));
    line.appendChild(toggle);

    if (!this.showProfiles) return line;

    const wrap = el('div', 'fw-stack');
    wrap.appendChild(line);
    if (this.profiles === null) {
      wrap.appendChild(el('p', 'fw-note', 'Loading profiles…'));
      return wrap;
    }
    const list = el('div', 'fw-choices');
    list.setAttribute('role', 'group');
    list.setAttribute('aria-label', 'Choose a profile');
    for (const profile of this.profiles) {
      const choice = this.button(profile.name, profile.active ? 'primary' : 'ghost', () => {
        this.showProfiles = false;
        this.profiles = null;
        if (!profile.active) this.callbacks.onSwitchProfile(profile.id);
        else this.draw();
      });
      choice.classList.add('fw-btn--sm');
      choice.setAttribute('aria-pressed', String(profile.active));
      list.appendChild(choice);
    }
    wrap.appendChild(list);
    return wrap;
  }

  private jobMatch(match: JobMatch): HTMLElement {
    const section = el('div', 'fw-match');
    const toggle = this.link(
      `${this.showMatch ? '▾' : '▸'} Posting mentions ${match.present.length + match.missing.length} skills`,
      () => {
        this.showMatch = !this.showMatch;
        this.draw();
      },
    );
    toggle.setAttribute('aria-expanded', String(this.showMatch));
    section.appendChild(toggle);
    if (!this.showMatch) return section;

    if (match.present.length) {
      section.appendChild(el('p', 'fw-match__head', 'In your profile'));
      section.appendChild(chips(match.present, 'ok'));
    }
    if (match.missing.length) {
      section.appendChild(el('p', 'fw-match__head', 'Not in your profile'));
      section.appendChild(chips(match.missing, 'muted'));
    }
    if (match.yearsRequired) {
      section.appendChild(
        el(
          'p',
          'fw-note',
          `The posting asks for about ${match.yearsRequired}+ years of experience.`,
        ),
      );
    }
    section.appendChild(
      el(
        'p',
        'fw-note',
        'A comparison of words only — Fillwright never adds skills to your profile or your answers.',
      ),
    );
    return section;
  }

  /* ------------------------------------------------------------ keyboard */

  private onKeyDown(event: KeyboardEvent): void {
    // Keys handled here never reach the page's own shortcuts.
    if (event.key === 'Escape') {
      event.stopPropagation();
      this.minimize();
      return;
    }
    // While the panel is open, Tab cycles inside it. Esc is the way out, and
    // returns focus to wherever the user was on the page.
    if (event.key === 'Tab' && !this.minimized) {
      const focusable = this.focusables();
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = this.root.activeElement;
      if (first && last) {
        if (event.shiftKey && (active === first || !active)) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && (active === last || !active)) {
          event.preventDefault();
          first.focus();
        }
      }
      event.stopPropagation();
      return;
    }
    const target = event.composedPath()[0];
    if (target instanceof HTMLElement && target.classList.contains('fw-grip')) {
      const step = event.shiftKey ? 48 : 16;
      const moves: Record<string, [number, number]> = {
        ArrowLeft: [-step, 0],
        ArrowRight: [step, 0],
        ArrowUp: [0, -step],
        ArrowDown: [0, step],
      };
      const move = moves[event.key];
      if (move) {
        event.preventDefault();
        event.stopPropagation();
        const rect = this.panel.getBoundingClientRect();
        this.moveTo(rect.left + move[0], rect.top + move[1]);
      }
    }
  }

  minimize(): void {
    if (this.state === 'filling' || this.state === 'analyzing') return;
    const hadFocus = this.root.activeElement !== null;
    this.minimized = true;
    this.suppressFocus = true;
    this.draw();
    this.suppressFocus = false;
    if (hadFocus) this.restoreFocus();
  }

  private focusables(): HTMLElement[] {
    return Array.from(
      this.panel.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex="0"]',
      ),
    );
  }

  /** Hands focus back to the page element the user was on before opening. */
  private restoreFocus(): void {
    const target = this.returnFocus;
    this.returnFocus = null;
    if (target?.isConnected) target.focus({ preventScroll: true });
  }

  private focusFirst(): void {
    const target =
      this.panel.querySelector<HTMLElement>('.fw-pill') ??
      this.panel.querySelector<HTMLElement>('.fw-btn--primary:not([disabled])') ??
      this.panel.querySelector<HTMLElement>('button');
    target?.focus({ preventScroll: true });
  }

  /** Called once when the user explicitly opened the panel. */
  focus(): void {
    const active = document.activeElement;
    if (active instanceof HTMLElement && active !== this.host && active !== document.body) {
      this.returnFocus = active;
    }
    this.minimized = false;
    this.draw();
    this.focusFirst();
  }

  /* ------------------------------------------------------------ dragging */

  private startDrag(event: PointerEvent, grip: HTMLElement): void {
    if (event.button !== 0) return;
    const rect = this.panel.getBoundingClientRect();
    const offsetX = event.clientX - rect.left;
    const offsetY = event.clientY - rect.top;
    grip.setPointerCapture?.(event.pointerId);

    const move = (e: PointerEvent) => this.moveTo(e.clientX - offsetX, e.clientY - offsetY, false);
    const end = () => {
      grip.removeEventListener('pointermove', move);
      grip.removeEventListener('pointerup', end);
      grip.removeEventListener('pointercancel', end);
      this.savePosition();
    };
    grip.addEventListener('pointermove', move);
    grip.addEventListener('pointerup', end);
    grip.addEventListener('pointercancel', end);
  }

  private moveTo(left: number, top: number, save = true): void {
    const rect = this.panel.getBoundingClientRect();
    const maxLeft = Math.max(8, window.innerWidth - rect.width - 8);
    const maxTop = Math.max(8, window.innerHeight - Math.min(rect.height, 120) - 8);
    const x = Math.round(Math.min(maxLeft, Math.max(8, left)));
    const y = Math.round(Math.min(maxTop, Math.max(8, top)));
    this.panel.style.left = `${x}px`;
    this.panel.style.top = `${y}px`;
    this.panel.style.right = 'auto';
    this.panel.style.bottom = 'auto';
    if (save) this.savePosition();
  }

  /**
   * The position is remembered for this tab only, in the content script's own
   * world — the page cannot read it, and it is not persisted anywhere.
   */
  private savePosition(): void {
    const scope = globalThis as unknown as Record<string, unknown>;
    scope[POSITION_KEY] = { left: this.panel.style.left, top: this.panel.style.top };
  }

  private restorePosition(): void {
    const saved = (
      globalThis as unknown as Record<string, { left: string; top: string } | undefined>
    )[POSITION_KEY];
    if (!saved?.left || !saved.top) return;
    Object.assign(this.panel.style, {
      left: saved.left,
      top: saved.top,
      right: 'auto',
      bottom: 'auto',
    });
  }

  /* --------------------------------------------------------------- pieces */

  private card(title: string): HTMLElement {
    const card = el('section', 'fw-card');
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-modal', 'false');
    card.setAttribute('aria-label', `Fillwright: ${title}`);
    card.appendChild(this.header(title));
    this.panel.appendChild(card);
    return card;
  }

  private body(card: HTMLElement): HTMLElement {
    const body = el('div', 'fw-body');
    card.appendChild(body);
    return body;
  }

  private header(title: string): HTMLElement {
    const header = el('div', 'fw-header');

    const grip = el('div', 'fw-grip');
    grip.tabIndex = 0;
    grip.setAttribute('role', 'button');
    grip.setAttribute('aria-label', 'Move panel. Use the arrow keys.');
    grip.addEventListener('pointerdown', (event) => this.startDrag(event, grip));
    grip.appendChild(el('span', 'fw-mark'));
    const titles = el('span', 'fw-titles');
    titles.appendChild(el('span', 'fw-eyebrow', 'Fillwright'));
    titles.appendChild(el('span', 'fw-title', title));
    grip.appendChild(titles);
    header.appendChild(grip);

    const tools = el('div', 'fw-header__tools');
    const minimize = document.createElement('button');
    minimize.className = 'fw-icon';
    minimize.type = 'button';
    minimize.setAttribute('aria-label', 'Minimise Fillwright');
    minimize.textContent = '–';
    minimize.addEventListener('click', () => this.minimize());
    tools.appendChild(minimize);

    const close = document.createElement('button');
    close.className = 'fw-icon';
    close.type = 'button';
    close.setAttribute('aria-label', 'Close Fillwright');
    close.textContent = '×';
    close.addEventListener('click', () => this.callbacks.onClose());
    tools.appendChild(close);
    header.appendChild(tools);
    return header;
  }

  private tally(icon: string, label: string, tone: 'ok' | 'caution' | 'muted'): HTMLElement {
    const item = el('span', `fw-tally__item fw-tally__item--${tone}`);
    const glyph = el('span', 'fw-tally__icon', icon);
    glyph.setAttribute('aria-hidden', 'true');
    item.appendChild(glyph);
    item.appendChild(el('span', '', label));
    return item;
  }

  private button(
    label: string,
    variant: 'primary' | 'ghost',
    onClick: () => void,
  ): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `fw-btn fw-btn--${variant}`;
    button.textContent = label;
    button.addEventListener('click', onClick);
    return button;
  }

  private link(label: string, onClick: () => void): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'fw-link';
    button.textContent = label;
    button.addEventListener('click', onClick);
    return button;
  }
}

/** Groups plan entries into the four numbers the panel leads with. */
export function countsFor(plan: FillPlan): {
  ready: number;
  review: number;
  needsYou: number;
  filled: number;
} {
  let ready = 0;
  let review = 0;
  let needsYou = 0;
  let filled = 0;
  for (const entry of plan.entries) {
    switch (entry.status) {
      case 'ready':
        ready += 1;
        break;
      case 'review':
        review += 1;
        break;
      case 'needs-consent':
      case 'missing-value':
      case 'manual-required':
        needsYou += 1;
        break;
      case 'skipped-existing':
        filled += 1;
        break;
      default:
        break;
    }
  }
  return { ready, review, needsYou, filled };
}

function chips(items: string[], tone: string): HTMLElement {
  const wrap = el('div', 'fw-chips');
  for (const item of items) wrap.appendChild(el('span', `fw-tag fw-tag--${tone}`, item));
  return wrap;
}

function el(tag: string, className = '', text = ''): HTMLElement {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}
