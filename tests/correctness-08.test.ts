import { beforeEach, describe, expect, it } from 'vitest';
import { harvestFields } from '@/field-detection/harvest';
import { containsPhrase } from '@/field-detection/normalize';
import { resolveValue } from '@/autofill/resolve';
import { createEmptyProfile } from '@/profile/factory';
import { emptyExperience } from '@/profile/entries';

beforeEach(() => {
  document.body.innerHTML = '';
});

function shadowHost(html: string, hostAttrs = ''): void {
  document.body.innerHTML = `<div id="host" ${hostAttrs}></div>`;
  const shadow = document.getElementById('host')!.attachShadow({ mode: 'open' });
  shadow.innerHTML = html;
}

const labels = (): string[] => harvestFields(document).fields.map((f) => f.signals.labelText);

describe('shadow-root labels', () => {
  it('resolves label[for] nested away from the input inside a shadow root', () => {
    shadowHost('<div><label for="gh">GitHub</label></div><div><input id="gh"></div>');
    expect(labels()).toContain('GitHub');
  });

  it('resolves aria-labelledby inside a shadow root', () => {
    shadowHost('<span id="lbl">Portfolio URL</span><div><input aria-labelledby="lbl"></div>');
    expect(labels()).toContain('Portfolio URL');
  });

  it('does not resolve ids from the document into a shadow root', () => {
    document.body.innerHTML = '<span id="lbl">Outside</span><div id="host"></div>';
    const shadow = document.getElementById('host')!.attachShadow({ mode: 'open' });
    shadow.innerHTML = '<div><input aria-labelledby="lbl"></div>';
    expect(labels()).not.toContain('Outside');
  });

  it('falls back to the host element aria-label', () => {
    shadowHost('<div><input></div>', 'aria-label="Phone number"');
    expect(labels()).toContain('Phone number');
  });

  it('falls back to the host element label attribute', () => {
    shadowHost('<div><input></div>', 'label="LinkedIn"');
    expect(labels()).toContain('LinkedIn');
  });

  it('falls back to a document label pointing at the host', () => {
    document.body.innerHTML =
      '<label for="host">City</label><div><x-field id="host"></x-field></div>';
    const shadow = document.getElementById('host')!.attachShadow({ mode: 'open' });
    shadow.innerHTML = '<div><input></div>';
    expect(labels()).toContain('City');
  });
});

describe('containsPhrase', () => {
  it('checks every occurrence (reproduction)', () => {
    expect(containsPhrase('username or first name', 'name')).toBe(true);
    expect(containsPhrase('username or surname', 'name')).toBe(false);
    expect(containsPhrase('nameless name', 'name')).toBe(true);
  });
});

describe('years of experience', () => {
  const withRoles = (...roles: [string, string][]) => {
    const p = createEmptyProfile('T');
    p.experience = roles.map(([startDate, endDate]) => ({
      ...emptyExperience(),
      startDate,
      endDate,
    }));
    return p;
  };
  const years = (...roles: [string, string][]) =>
    resolveValue('experience.yearsOfExperience', withRoles(...roles));

  it('does not double-count overlapping roles', () => {
    expect(years(['2020-01', '2022-01'], ['2021-01', '2023-01']).value).toBe('3');
  });

  it('uses whole years completed, never rounding up', () => {
    expect(years(['2020-01', '2021-11']).value).toBe('1');
  });

  it('adds disjoint roles', () => {
    expect(years(['2018-01', '2019-01'], ['2020-01', '2021-06']).value).toBe('2');
  });

  it('sends under a year to review instead of inventing "1"', () => {
    const r = years(['2024-01', '2024-04'], ['2024-02', '2024-06']);
    expect(r.value).toBe('');
    expect(r.needsConsent).toBe(true);
  });
});
