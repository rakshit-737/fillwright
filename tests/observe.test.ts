import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { controlSignature, createThrottle, mutationsMayAffectForm } from '@/content/observe';

const observe = (mutate: () => void) =>
  new Promise<MutationRecord[]>((resolve) => {
    const observer = new MutationObserver((records) => {
      observer.disconnect();
      resolve(records);
    });
    observer.observe(document.body, { childList: true, subtree: true });
    mutate();
  });

describe('mutation pre-filter', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('flags added or removed controls and containers', async () => {
    expect(
      await observe(() => document.body.appendChild(document.createElement('input'))),
    ).toSatisfy(mutationsMayAffectForm);
    const wrapper = document.createElement('div');
    wrapper.appendChild(document.createElement('span'));
    expect(await observe(() => document.body.appendChild(wrapper))).toSatisfy(
      mutationsMayAffectForm,
    );
    expect(await observe(() => wrapper.remove())).toSatisfy(mutationsMayAffectForm);
  });

  it('ignores text, leaf elements and Fillwright’s own nodes', async () => {
    expect(mutationsMayAffectForm(await observe(() => document.body.append('just text')))).toBe(
      false,
    );
    expect(
      mutationsMayAffectForm(
        await observe(() => document.body.appendChild(document.createElement('span'))),
      ),
    ).toBe(false);
    const ui = document.createElement('div');
    ui.setAttribute('data-fillwright-ui', '');
    ui.appendChild(document.createElement('input'));
    expect(mutationsMayAffectForm(await observe(() => document.body.appendChild(ui)))).toBe(false);
  });

  it('fingerprints the form so unrelated renders are not changes', () => {
    document.body.innerHTML = '<input id="a"><select name="s"></select>';
    const before = controlSignature(document);
    document.body.appendChild(document.createElement('div'));
    expect(controlSignature(document)).toBe(before);
    document.body.appendChild(document.createElement('textarea'));
    expect(controlSignature(document)).not.toBe(before);
  });
});

describe('passive throttle', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('runs at most once per interval, coalescing bursts', async () => {
    let clock = 0;
    const task = vi.fn();
    const throttle = createThrottle(task, {
      intervalMs: 1_500,
      scrollQuietMs: 400,
      now: () => clock,
    });
    for (let i = 0; i < 20; i++) {
      throttle.schedule();
      clock += 100;
      await vi.advanceTimersByTimeAsync(100);
    }
    // 2 s elapsed: one immediate run and one trailing run at most.
    expect(task.mock.calls.length).toBeLessThanOrEqual(2);
    clock += 1_500;
    await vi.advanceTimersByTimeAsync(1_500);
    expect(task.mock.calls.length).toBeLessThanOrEqual(3);
  });

  it('waits for scrolling to stop', async () => {
    let clock = 10_000;
    const task = vi.fn();
    const throttle = createThrottle(task, {
      intervalMs: 1_500,
      scrollQuietMs: 400,
      now: () => clock,
    });
    throttle.noteScroll();
    throttle.schedule();
    await vi.advanceTimersByTimeAsync(0);
    expect(task).not.toHaveBeenCalled();
    clock += 200;
    throttle.noteScroll();
    await vi.advanceTimersByTimeAsync(200);
    expect(task).not.toHaveBeenCalled();
    clock += 400;
    await vi.advanceTimersByTimeAsync(400);
    expect(task).toHaveBeenCalledTimes(1);
  });
});
