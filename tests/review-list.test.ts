import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FillwrightWidget, type WidgetCallbacks } from '@/content/widget';
import { isOpenableProfileField } from '@/field-detection/catalog';
import { openPagePath } from '@/background/open-page';
import { focusProfileField, requestedField } from '@/options/focusField';
import type { CanonicalField, FillPlan, FillPlanEntry, MappingStatus } from '@/types/fields';

const FIELDS: CanonicalField[] = [
  'personal.firstName',
  'personal.lastName',
  'personal.email',
  'personal.phone',
  'address.city',
  'address.state',
  'address.postalCode',
  'address.country',
  'links.linkedin',
  'links.github',
];

function entry(
  i: number,
  status: MappingStatus = 'ready',
  canonical?: CanonicalField,
): FillPlanEntry {
  const field = canonical ?? FIELDS[i % FIELDS.length]!;
  return {
    fieldId: `f${i}`,
    label: `Field ${i}`,
    canonical: field,
    currentValue: '',
    newValue: status === 'missing-value' ? '' : `value ${i}`,
    status,
    confidence: 0.95,
    rationale: `Matched field ${i}.`,
    selected: status === 'ready',
    fingerprint: `field ${i}`,
    remembered: false,
  };
}

function planOf(entries: FillPlanEntry[]): FillPlan {
  return {
    scanId: 's1',
    entries,
    readyCount: entries.filter((e) => e.status === 'ready').length,
    reviewCount: 0,
    skippedCount: 0,
  } as FillPlan;
}

function callbacks(patch: Partial<WidgetCallbacks> = {}): WidgetCallbacks {
  return {
    onFill: () => undefined,
    onUndo: () => undefined,
    onClose: () => undefined,
    onRescan: () => undefined,
    onOpen: () => undefined,
    onTeach: () => undefined,
    onListProfiles: async () => [],
    onSwitchProfile: () => undefined,
    onAddEntries: () => undefined,
    onOpenPage: () => undefined,
    onReload: () => undefined,
    onUnlock: () => undefined,
    canDraft: () => false,
    onDraftStart: () => undefined,
    onDraftGenerate: () => undefined,
    onDraftUse: () => undefined,
    ...patch,
  };
}

function open(widget: FillwrightWidget, plan: FillPlan): ShadowRoot {
  widget.renderPlan(plan);
  widget.focus();
  const review = [...widget.shadow.querySelectorAll('button')].find(
    (b) => b.textContent === 'Review',
  )!;
  review.click();
  return widget.shadow;
}

const buttonNamed = (root: ShadowRoot | HTMLElement, text: string) =>
  [...root.querySelectorAll('button')].find((b) => b.textContent === text);

describe('review list keeps your place', () => {
  beforeEach(() => {
    document.querySelectorAll('[data-fillwright-widget]').forEach((node) => node.remove());
  });

  it('keeps focus on the toggled checkbox and the list scroll position', () => {
    const widget = new FillwrightWidget(callbacks(), true, { trust: () => true });
    const root = open(widget, planOf(Array.from({ length: 30 }, (_, i) => entry(i))));
    const boxes = [...root.querySelectorAll<HTMLInputElement>('input.fw-check')];
    const fifteenth = boxes[14]!;
    const list = root.querySelector<HTMLElement>('.fw-list')!;
    list.scrollTop = 420;
    const before = list.scrollTop;
    fifteenth.focus();
    fifteenth.click();

    const active = root.activeElement as HTMLInputElement;
    expect(active).not.toBeNull();
    expect(active.getAttribute('data-fw-key')).toBe(fifteenth.getAttribute('data-fw-key'));
    expect(active.checked).toBe(false);
    expect(root.querySelector<HTMLElement>('.fw-list')!.scrollTop).toBe(before);
    widget.destroy();
  });

  it('keeps focus on "Why?" after it opens', () => {
    const widget = new FillwrightWidget(callbacks(), true, { trust: () => true });
    const root = open(widget, planOf([entry(0), entry(1), entry(2)]));
    const whys = [...root.querySelectorAll('button')].filter((b) => b.textContent === 'Why?');
    whys[1]!.focus();
    whys[1]!.click();
    expect((root.activeElement as HTMLElement).textContent).toBe('Hide reason');
    widget.destroy();
  });

  it('does not offer "Edit for this form" on a file upload', () => {
    const widget = new FillwrightWidget(callbacks(), true, { trust: () => true });
    const upload = { ...entry(0, 'manual-required', 'documents.resume'), newValue: '' };
    const root = open(widget, planOf([upload, entry(1)]));
    expect(
      buttonNamed(root.querySelector('[data-fw-row="f0"]') as HTMLElement, 'Edit for this form'),
    ).toBeFalsy();
    expect(
      buttonNamed(root.querySelector('[data-fw-row="f1"]') as HTMLElement, 'Edit for this form'),
    ).toBeTruthy();
    widget.destroy();
  });

  it('lets you edit a proposed value for this form only, marked as yours', () => {
    const onFill = vi.fn();
    vi.useFakeTimers();
    const widget = new FillwrightWidget(callbacks({ onFill }), true, { trust: () => true });
    const root = open(widget, planOf([entry(0), entry(1)]));
    const rows = root.querySelectorAll('.fw-item');
    buttonNamed(rows[1] as HTMLElement, 'Edit for this form')!.click();
    const input = root.querySelector<HTMLInputElement>('input.fw-edit__input')!;
    expect(input).not.toBeNull();
    expect(input.value).toBe('value 1');
    expect(root.activeElement).toBe(input);
    input.value = 'my own value';
    buttonNamed(root, 'Save')!.click();

    const row = root.querySelectorAll('.fw-item')[1]!;
    expect(row.querySelector('.fw-item__new')!.textContent).toBe('my own value');
    expect(row.textContent).toContain('your edit');

    // The click-jacking guard arms Fill only after the panel has been shown.
    vi.advanceTimersByTime(2_000);
    buttonNamed(root, 'Fill 2 fields')!.click();
    const sent = onFill.mock.calls[0]![0] as FillPlanEntry[];
    expect(sent.find((e) => e.fieldId === 'f1')!.newValue).toBe('my own value');
    expect(sent.find((e) => e.fieldId === 'f1')!.selected).toBe(true);
    widget.destroy();
    vi.useRealTimers();
  });

  it('offers "Add it in your profile" on a missing value', () => {
    const onOpenPage = vi.fn();
    const widget = new FillwrightWidget(callbacks({ onOpenPage }), true, { trust: () => true });
    const root = open(widget, planOf([entry(0), entry(1, 'missing-value', 'links.github')]));
    buttonNamed(root, 'Add it in your profile')!.click();
    expect(onOpenPage).toHaveBeenCalledWith('profile', 'links.github');
    widget.destroy();
  });

  it('groups rows by section with select all and none per group', () => {
    const widget = new FillwrightWidget(callbacks(), true, { trust: () => true });
    const root = open(
      widget,
      planOf([
        entry(0, 'review', 'personal.firstName'),
        entry(1, 'review', 'personal.lastName'),
        entry(2, 'ready', 'address.city'),
      ]),
    );
    const groups = [...root.querySelectorAll('.fw-group')];
    expect(groups.map((g) => g.querySelector('.fw-group__title')!.textContent)).toEqual([
      'About you',
      'Address',
    ]);
    const all = groups[0]!.querySelector<HTMLButtonElement>('[data-fw-key="group:About you:all"]')!;
    all.click();
    const boxes = [...root.querySelectorAll<HTMLInputElement>('input.fw-check')];
    expect(boxes.map((b) => b.checked)).toEqual([true, true, true]);
    root.querySelector<HTMLButtonElement>('[data-fw-key="group:Address:none"]')!.click();
    expect(
      [...root.querySelectorAll<HTMLInputElement>('input.fw-check')].map((b) => b.checked),
    ).toEqual([true, true, false]);
    widget.destroy();
  });

  it('filters rows by status', () => {
    const widget = new FillwrightWidget(callbacks(), true, { trust: () => true });
    const root = open(
      widget,
      planOf([entry(0), entry(1, 'missing-value'), entry(2, 'review'), entry(3)]),
    );
    const select = root.querySelector<HTMLSelectElement>('select.fw-filter')!;
    select.value = 'missing-value';
    select.dispatchEvent(new Event('change'));
    const labels = [...root.querySelectorAll('.fw-item .fw-item__label')].map((l) => l.textContent);
    expect(labels).toEqual(['Field 1']);
    // Filtering never changes what is selected.
    expect(buttonNamed(root, 'Fill 2 fields')).toBeDefined();
    widget.destroy();
  });
});

describe('opening the profile from the panel', () => {
  it('builds a path only for listed routes and catalog fields', () => {
    expect(openPagePath('profile', 'links.github')).toBe(
      'options.html#/profile?field=links.github',
    );
    expect(openPagePath('profile')).toBe('options.html#/profile');
    expect(openPagePath('privacy')).toBe('options.html#/privacy');
    expect(openPagePath('privacy', 'links.github')).toBeNull();
    expect(openPagePath('profile', 'x&y=1')).toBeNull();
    expect(openPagePath('learned')).toBeNull();
    expect(openPagePath({})).toBeNull();
  });

  it('reads the field back and focuses its control by label', () => {
    expect(requestedField('#/profile?field=links.github')).toBe('links.github');
    expect(requestedField('#/profile?field=nope')).toBeNull();
    document.body.innerHTML =
      '<label for="a">City</label><input id="a"><label for="b">GitHub</label><input id="b">';
    expect(focusProfileField('links.github')).toBe(true);
    expect(document.activeElement?.id).toBe('b');
    expect(focusProfileField('sensitive.visaStatus')).toBe(false);
    document.body.innerHTML = '';
  });
});

describe('profile deep links', () => {
  it('accepts only catalog fields', () => {
    expect(isOpenableProfileField('links.github')).toBe(true);
    expect(isOpenableProfileField('unknown')).toBe(false);
    expect(isOpenableProfileField('javascript:alert(1)')).toBe(false);
    expect(isOpenableProfileField('../security')).toBe(false);
  });
});
