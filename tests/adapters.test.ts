import { beforeEach, describe, expect, it } from 'vitest';
import {
  ADAPTERS,
  applyAdapter,
  detectAdapter,
  isSafeToExpand,
  resetAdapterPresses,
} from '@/adapters';
import { validateScan } from '@/security/scan-guard';

beforeEach(() => {
  document.body.innerHTML = '';
  resetAdapterPresses();
});

describe('adapter selection', () => {
  it('matches the known application systems', () => {
    expect(detectAdapter('https://boards.greenhouse.io/acme/jobs/1')?.id).toBe('greenhouse');
    expect(detectAdapter('https://jobs.lever.co/acme/123')?.id).toBe('lever');
    expect(detectAdapter('https://acme.wd5.myworkdayjobs.com/en-US/careers')?.id).toBe('workday');
    expect(detectAdapter('https://jobs.ashbyhq.com/acme')?.id).toBe('ashby');
  });

  it('falls back to the generic detector for everything else', () => {
    expect(detectAdapter('https://careers.example.com/apply')).toBeNull();
    expect(detectAdapter('not a url')).toBeNull();
  });

  it('does not match a lookalike domain', () => {
    // "greenhouse.io.evil.com" must not be treated as Greenhouse.
    expect(detectAdapter('https://greenhouse.io.evil.example/apply')).toBeNull();
  });
});

describe('adapters can never submit an application', () => {
  const expander = ADAPTERS.find((adapter) => adapter.id === 'workday')!;

  it('clicks a collapsed expander', async () => {
    document.body.innerHTML = `
      <button id="x" aria-expanded="false" aria-controls="work" data-automation-id="addButton">Work Experience</button>
      <div id="work"></div>
    `;
    const button = document.getElementById('x')!;
    let clicked = false;
    button.addEventListener('click', () => (clicked = true));
    // jsdom reports no layout boxes, so the visibility guard is stubbed here.
    button.getClientRects = () => [{}] as unknown as DOMRectList;

    await applyAdapter(expander);
    expect(clicked).toBe(true);
  });

  it('refuses to click anything that reads as submit or apply', async () => {
    document.body.innerHTML = `
      <button id="s" aria-expanded="false" data-automation-id="addButton">Submit Application</button>
      <button id="a" aria-expanded="false" data-automation-id="addButton">Apply Now</button>
      <button id="d" aria-expanded="false" data-automation-id="addButton">Delete</button>
    `;
    const clicks: string[] = [];
    for (const id of ['s', 'a', 'd']) {
      const button = document.getElementById(id)!;
      button.getClientRects = () => [{}] as unknown as DOMRectList;
      button.addEventListener('click', () => clicks.push(id));
    }

    await applyAdapter(expander);
    expect(clicks).toEqual([]);
  });

  it('refuses to click a submit-type button whatever it says', async () => {
    document.body.innerHTML = `
      <form><button id="s" type="submit" aria-expanded="false" data-automation-id="addButton">Add more</button></form>
    `;
    const button = document.getElementById('s')!;
    button.getClientRects = () => [{}] as unknown as DOMRectList;
    let clicked = false;
    button.addEventListener('click', () => (clicked = true));

    await applyAdapter(expander);
    expect(clicked).toBe(false);
  });

  it('never touches Fillwright’s own UI', async () => {
    document.body.innerHTML = `
      <div data-fillwright-ui>
        <button id="x" aria-expanded="false" data-automation-id="addButton">Expand</button>
      </div>
    `;
    const button = document.getElementById('x')!;
    button.getClientRects = () => [{}] as unknown as DOMRectList;
    let clicked = false;
    button.addEventListener('click', () => (clicked = true));

    await applyAdapter(expander);
    expect(clicked).toBe(false);
  });
});

/**
 * A content script runs inside a page that may be hostile, so anything it sends
 * the service worker is treated as untrusted input from an untrusted process.
 */
describe('scans arriving from a page are untrusted input', () => {
  const validField = {
    id: 'fw-0',
    kind: 'text',
    signals: {
      labelText: 'First Name',
      ariaLabel: '',
      ariaDescription: '',
      placeholder: '',
      name: 'first_name',
      id: 'first_name',
      autocomplete: '',
      inputType: 'text',
      title: '',
      sectionHeading: '',
      precedingText: '',
      optionLabels: [],
      required: true,
      maxLength: null,
    },
    options: [],
    currentValue: '',
    hasExistingValue: false,
    visible: true,
    disabled: false,
    readOnly: false,
    order: 0,
    selectorHint: 'input[name="first_name"]',
  };

  it('accepts a well-formed scan', () => {
    const result = validateScan({ fields: [validField] });
    expect(result.ok).toBe(true);
  });

  it('rejects junk', () => {
    expect(validateScan(null).ok).toBe(false);
    expect(validateScan({}).ok).toBe(false);
    expect(validateScan({ fields: 'lots' }).ok).toBe(false);
    expect(validateScan({ fields: [] }).ok).toBe(false);
  });

  it('refuses an absurd number of fields rather than processing them', () => {
    const many = Array.from({ length: 5000 }, (_, index) => ({ ...validField, id: `fw-${index}` }));
    const result = validateScan({ fields: many });
    expect(result.ok).toBe(false);
  });

  it('caps oversized strings instead of storing them', () => {
    const result = validateScan({
      fields: [
        { ...validField, signals: { ...validField.signals, labelText: 'x'.repeat(100_000) } },
      ],
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.scan.fields[0]!.signals.labelText.length).toBeLessThanOrEqual(600);
    }
  });

  it('drops duplicate ids so they cannot collide when filling', () => {
    const result = validateScan({ fields: [validField, { ...validField }] });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.scan.fields).toHaveLength(1);
  });

  it('discards unexpected properties rather than passing them through', () => {
    const result = validateScan({
      fields: [{ ...validField, __proto__: { polluted: true }, evil: 'payload' }],
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect('evil' in result.scan.fields[0]!).toBe(false);
      expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    }
  });

  it('never trusts a page-supplied URL', () => {
    const result = validateScan({
      fields: [validField],
      url: 'https://bank.example.com/transfer',
      pageKey: 'https://bank.example.com/transfer',
    });
    expect(result.ok).toBe(true);
    // The caller substitutes the sender's real URL; the claimed one is dropped.
    if (result.ok) {
      expect(result.scan.url).toBe('');
      expect(result.scan.pageKey).toBe('');
    }
  });

  it('normalises an unknown control kind instead of trusting it', () => {
    const result = validateScan({ fields: [{ ...validField, kind: 'javascript:alert(1)' }] });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.scan.fields[0]!.kind).toBe('unsupported');
  });
});

/**
 * Adapters may only open accordions. A dropdown, a menu or a navigation
 * button also reports aria-expanded="false", and pressing those on a page the
 * user never asked about is exactly what the product promises not to do.
 */
const workday = ADAPTERS.find((adapter) => adapter.id === 'workday')!;

function visible(...elements: HTMLElement[]): void {
  for (const element of elements) element.getClientRects = () => [{}] as unknown as DOMRectList;
}

function counter(ids: string[]): string[] {
  const clicks: string[] = [];
  for (const id of ids) {
    const element = document.getElementById(id)!;
    visible(element);
    element.addEventListener('click', () => clicks.push(id));
  }
  return clicks;
}

describe('what counts as an accordion', () => {
  it('accepts a button that controls a region', () => {
    document.body.innerHTML = `<button id="b" aria-expanded="false" aria-controls="r">Education</button><div id="r" hidden></div>`;
    const button = document.getElementById('b')!;
    visible(button);
    expect(isSafeToExpand(button)).toBe(true);
  });

  it('accepts a heading-level disclosure', () => {
    document.body.innerHTML = `<h3><button id="b" aria-expanded="false">Work history</button></h3>`;
    const button = document.getElementById('b')!;
    visible(button);
    expect(isSafeToExpand(button)).toBe(true);
  });

  it('refuses a bare collapsed button with no accordion semantics', () => {
    document.body.innerHTML = `<button id="b" aria-expanded="false">More</button>`;
    const button = document.getElementById('b')!;
    visible(button);
    expect(isSafeToExpand(button)).toBe(false);
  });

  it('refuses aria-controls that points at nothing', () => {
    document.body.innerHTML = `<button id="b" aria-expanded="false" aria-controls="missing">More</button>`;
    const button = document.getElementById('b')!;
    visible(button);
    expect(isSafeToExpand(button)).toBe(false);
  });

  it.each([
    [
      'a dropdown',
      `<button id="b" aria-expanded="false" aria-haspopup="listbox" aria-controls="r">Country</button><div id="r"></div>`,
    ],
    [
      'a menu button',
      `<button id="b" aria-expanded="false" aria-haspopup="true" aria-controls="r">Account</button><div id="r"></div>`,
    ],
    [
      'a combobox',
      `<button id="b" role="combobox" aria-expanded="false" aria-controls="r">Pick</button><div id="r"></div>`,
    ],
    [
      'a nav button',
      `<nav><button id="b" aria-expanded="false" aria-controls="r">Careers</button></nav><div id="r"></div>`,
    ],
    [
      'a header button',
      `<header><h2><button id="b" aria-expanded="false">Menu</button></h2></header>`,
    ],
    [
      'a menubar item',
      `<div role="menubar"><button id="b" aria-expanded="false" aria-controls="r">File</button></div><div id="r"></div>`,
    ],
    [
      'a menu item',
      `<div role="menu"><button id="b" aria-expanded="false" aria-controls="r">Sub</button></div><div id="r"></div>`,
    ],
    [
      'a toolbar button',
      `<div role="toolbar"><button id="b" aria-expanded="false" aria-controls="r">Format</button></div><div id="r"></div>`,
    ],
  ])('refuses %s', (_name, html) => {
    document.body.innerHTML = html;
    const button = document.getElementById('b')!;
    visible(button);
    expect(isSafeToExpand(button)).toBe(false);
  });
});

describe('applyAdapter presses carefully', () => {
  it('never presses a dropdown or a nav menu button', async () => {
    document.body.innerHTML = `
      <nav><button id="nav" aria-expanded="false" aria-controls="navlist">Careers</button><ul id="navlist"></ul></nav>
      <button id="dd" aria-expanded="false" aria-haspopup="listbox" aria-controls="ddlist">Country</button><div id="ddlist"></div>
    `;
    const clicks = counter(['nav', 'dd']);
    await applyAdapter(workday);
    expect(clicks).toEqual([]);
  });

  it('presses an element at most once per page, even after it collapses again', async () => {
    document.body.innerHTML = `<button id="acc" aria-expanded="false" aria-controls="panel">Education</button><div id="panel"></div>`;
    const clicks = counter(['acc']);
    const button = document.getElementById('acc')!;
    button.addEventListener('click', () => {
      document.getElementById('panel')!.appendChild(document.createElement('input'));
    });
    await applyAdapter(workday);
    button.setAttribute('aria-expanded', 'false');
    await applyAdapter(workday);
    expect(clicks).toEqual(['acc']);
  });

  it('stops pressing siblings when a press revealed no form controls', async () => {
    document.body.innerHTML = `
      <button id="a" aria-expanded="false" aria-controls="pa">One</button><div id="pa"></div>
      <button id="b" aria-expanded="false" aria-controls="pb">Two</button><div id="pb"></div>
    `;
    const clicks = counter(['a', 'b']);
    await applyAdapter(workday);
    expect(clicks).toEqual(['a']);
  });

  it('keeps going while presses reveal fields', async () => {
    document.body.innerHTML = `
      <button id="a" aria-expanded="false" aria-controls="pa">One</button><div id="pa"></div>
      <button id="b" aria-expanded="false" aria-controls="pb">Two</button><div id="pb"></div>
    `;
    const clicks = counter(['a', 'b']);
    for (const [id, panel] of [
      ['a', 'pa'],
      ['b', 'pb'],
    ] as const) {
      document.getElementById(id)!.addEventListener('click', () => {
        document.getElementById(panel)!.appendChild(document.createElement('input'));
      });
    }
    await applyAdapter(workday);
    expect(clicks).toEqual(['a', 'b']);
  });
});
