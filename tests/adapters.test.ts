import { beforeEach, describe, expect, it } from 'vitest';
import { ADAPTERS, applyAdapter, detectAdapter } from '@/adapters';
import { validateScan } from '@/security/scan-guard';

beforeEach(() => {
  document.body.innerHTML = '';
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
      <button id="x" aria-expanded="false" data-automation-id="addButton">Add Work Experience</button>
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
      fields: [{ ...validField, signals: { ...validField.signals, labelText: 'x'.repeat(100_000) } }],
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
