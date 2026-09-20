import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FillwrightWidget, ARM_DELAY_MS, type WidgetCallbacks } from '@/content/widget';
import { withoutValues } from '@/autofill/plan';
import type { FillPlan } from '@/types/fields';

/**
 * Click-jacking defences for the on-page panel (SECURITY.md §panel):
 * untrusted events are ignored, Fill arms only after the panel has been
 * visible and unobscured for a moment, the host lives in the top layer, and a
 * Smart-mode plan prepared before the user engaged carries no values.
 */

const plan: FillPlan = {
  scanId: 's',
  entries: [
    {
      fieldId: 'a',
      label: 'Email',
      canonical: 'personal.email',
      currentValue: '',
      newValue: 'me@example.com',
      status: 'ready',
      confidence: 0.99,
      rationale: 'Matched your email me@example.com',
      selected: true,
      fingerprint: 'fp-a',
      remembered: false,
    },
  ],
  readyCount: 1,
  reviewCount: 0,
  skippedCount: 0,
  blocks: { education: 0, experience: 0 },
  available: { education: 0, experience: 0 },
};

function callbacks(overrides: Partial<WidgetCallbacks> = {}): WidgetCallbacks {
  return {
    onFill: vi.fn(),
    onUndo: vi.fn(),
    onClose: vi.fn(),
    onRescan: vi.fn(),
    onOpen: vi.fn(),
    onTeach: vi.fn(),
    onListProfiles: async () => [],
    onSwitchProfile: vi.fn(),
    onAddEntries: vi.fn(),
    onUnlock: vi.fn(),
    onOpenPage: vi.fn(),
    onReload: vi.fn(),
    canDraft: () => false,
    onDraftStart: vi.fn(),
    onDraftGenerate: vi.fn(),
    onDraftUse: vi.fn(),
    ...overrides,
  };
}

function fillButton(widget: FillwrightWidget): HTMLButtonElement {
  return [...widget.shadow.querySelectorAll('button')].find((b) =>
    (b.textContent ?? '').startsWith('Fill'),
  ) as HTMLButtonElement;
}

const armed = (b: HTMLButtonElement) => !b.disabled && b.getAttribute('aria-disabled') !== 'true';

/** jsdom cannot create trusted events; this stands in for a real click. */
const trustAll = { trust: () => true };

type IoCallback = (entries: Array<{ isVisible: boolean; isIntersecting: boolean }>) => void;

describe('panel click-jacking defences', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    document.documentElement
      .querySelectorAll('[data-fillwright-widget]')
      .forEach((n) => n.remove());
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('ignores an untrusted click on Fill, even once armed', () => {
    const cb = callbacks();
    const widget = new FillwrightWidget(cb, true);
    widget.renderPlan(plan);
    vi.advanceTimersByTime(ARM_DELAY_MS + 50);
    const fill = fillButton(widget);
    expect(armed(fill)).toBe(true);
    fill.click();
    fill.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
    expect(cb.onFill).not.toHaveBeenCalled();
    widget.destroy();
  });

  it('ignores untrusted events on every other panel control', () => {
    const cb = callbacks();
    const widget = new FillwrightWidget(cb, true);
    widget.renderPlan(plan);
    const close = widget.shadow.querySelector<HTMLButtonElement>(
      '[aria-label="Close Fillwright"]',
    )!;
    close.click();
    expect(cb.onClose).not.toHaveBeenCalled();
    widget.shadow
      .querySelector('.fw-widget')!
      .dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(widget.shadow.querySelector('.fw-pill')).toBeNull();
    widget.destroy();
  });

  it('keeps Fill disarmed until the panel has been shown for the arming delay', () => {
    const cb = callbacks();
    const widget = new FillwrightWidget(cb, true, trustAll);
    widget.renderPlan(plan);
    expect(armed(fillButton(widget))).toBe(false);
    fillButton(widget).click();
    expect(cb.onFill).not.toHaveBeenCalled();
    vi.advanceTimersByTime(ARM_DELAY_MS + 50);
    expect(armed(fillButton(widget))).toBe(true);
    fillButton(widget).click();
    expect(cb.onFill).toHaveBeenCalledTimes(1);
    widget.destroy();
  });

  it('disarms when IntersectionObserver v2 reports the panel covered, and says why', () => {
    let fire: IoCallback = () => undefined;
    class FakeObserver {
      constructor(callback: IoCallback) {
        fire = callback;
      }
      observe() {}
      disconnect() {}
    }
    vi.stubGlobal('IntersectionObserver', FakeObserver);
    vi.stubGlobal(
      'IntersectionObserverEntry',
      class {
        get isVisible() {
          return true;
        }
      },
    );
    const cb = callbacks();
    const widget = new FillwrightWidget(cb, true, trustAll);
    widget.renderPlan(plan);
    // No report yet: never armed by time alone when v2 is available.
    vi.advanceTimersByTime(ARM_DELAY_MS * 3);
    expect(armed(fillButton(widget))).toBe(false);

    fire([{ isVisible: true, isIntersecting: true }]);
    vi.advanceTimersByTime(ARM_DELAY_MS + 50);
    expect(armed(fillButton(widget))).toBe(true);

    fire([{ isVisible: false, isIntersecting: true }]);
    expect(armed(fillButton(widget))).toBe(false);
    expect(widget.shadow.textContent).toContain('covering');
    fillButton(widget).click();
    expect(cb.onFill).not.toHaveBeenCalled();
    widget.destroy();
  });

  it('puts the host in the top layer as a manual popover', () => {
    const widget = new FillwrightWidget(callbacks(), true);
    const host = document.querySelector('[data-fillwright-widget]')!;
    expect(host.getAttribute('popover')).toBe('manual');
    widget.destroy();
  });

  it('a values-free plan keeps counts and statuses but no values', () => {
    const redacted = withoutValues(plan);
    expect(redacted.withheld).toBe(true);
    expect(redacted.readyCount).toBe(1);
    expect(redacted.entries[0]!.status).toBe('ready');
    expect(JSON.stringify(redacted)).not.toContain('me@example.com');
  });

  it('a values-free plan asks for values only when the user opens the panel', () => {
    const cb = callbacks();
    const widget = new FillwrightWidget(cb, true, trustAll);
    widget.renderPlan(withoutValues(plan));
    widget.minimize();
    expect(widget.shadow.querySelector('.fw-pill')?.textContent).toContain('1 ready');
    widget.shadow.querySelector<HTMLButtonElement>('.fw-pill')!.click();
    expect(cb.onOpen).toHaveBeenCalledTimes(1);
    expect(cb.onFill).not.toHaveBeenCalled();
    widget.destroy();
  });
});
