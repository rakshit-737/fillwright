import { beforeEach, describe, expect, it } from 'vitest';
import { fillFields, undoFill, verify, type UndoRecord } from '@/autofill/fill';
import { harvestFields } from '@/field-detection/harvest';
import { buildMappings } from '@/autofill/plan';
import { createEmptyProfile, tv } from '@/profile/factory';
import { DEFAULT_SETTINGS } from '@/types/settings';
import type { FillPlanEntry } from '@/types/fields';

/**
 * "Verified" has to mean the page holds the value the user asked for — not a
 * value that shares a prefix with it, and not a truncated copy of it.
 */

function input(type: string, value: string, attrs = ''): HTMLInputElement {
  document.body.innerHTML = `<input type="${type}" ${attrs}>`;
  const element = document.querySelector('input')!;
  element.value = value;
  return element;
}

function check(type: string, actual: string, intended: string, attrs = '') {
  return verify([input(type, actual, attrs)], intended);
}

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('verify: url', () => {
  it('rejects a different profile URL that shares a prefix (reproduction)', () => {
    expect(
      check(
        'url',
        'https://www.linkedin.com/in/someone-else',
        'https://www.linkedin.com/in/rakshit-r',
      ).ok,
    ).toBe(false);
  });
  it('accepts a case-different host and a trailing slash', () => {
    expect(
      check(
        'url',
        'https://WWW.LinkedIn.com/in/rakshit-r/',
        'https://www.linkedin.com/in/rakshit-r',
      ).ok,
    ).toBe(true);
  });
  it('treats a URL in a text box as a URL', () => {
    expect(check('text', 'https://github.com/other', 'https://github.com/aditir').ok).toBe(false);
  });
  it('is strict about the path case', () => {
    expect(check('url', 'https://github.com/ADITIR', 'https://github.com/aditir').ok).toBe(false);
  });
});

describe('verify: email', () => {
  it('rejects a truncated email (reproduction)', () => {
    const verdict = check('email', 'rakshit.r@gma', 'rakshit.r@gmail.com');
    expect(verdict.ok).toBe(false);
  });
  it('accepts a different case', () => {
    expect(check('email', 'Rakshit.R@Gmail.com', 'rakshit.r@gmail.com').ok).toBe(true);
  });
  it('rejects a different address', () => {
    expect(check('email', 'someone@gmail.com', 'rakshit.r@gmail.com').ok).toBe(false);
  });
});

describe('verify: tel', () => {
  it('accepts a masked number', () => {
    expect(check('tel', '(984) 501-2345', '9845012345').ok).toBe(true);
  });
  it('accepts a dropped or added country code', () => {
    expect(check('tel', '98450 12345', '+91 98450 12345').ok).toBe(true);
    expect(check('tel', '+91 98450 12345', '9845012345').ok).toBe(true);
  });
  it('rejects different digits', () => {
    expect(check('tel', '98450 12399', '+91 98450 12345').ok).toBe(false);
  });
  it('rejects a cut-short number', () => {
    expect(check('tel', '98450', '9845012345').ok).toBe(false);
  });
});

describe('verify: number', () => {
  it('compares numerically', () => {
    expect(check('number', '8.90', '8.9').ok).toBe(true);
    expect(check('number', '8', '8.94').ok).toBe(false);
  });
});

describe('verify: date', () => {
  it('accepts the same date in another format', () => {
    expect(check('text', '15/05/2026', '2026-05-15').ok).toBe(true);
    expect(check('date', '2026-05-15', '2026-05-15').ok).toBe(true);
  });
  it('rejects a different date', () => {
    expect(check('date', '2026-05-16', '2026-05-15').ok).toBe(false);
  });
});

describe('verify: free text', () => {
  it('accepts normalised equality', () => {
    expect(check('text', '  Aditi ', 'aditi').ok).toBe(true);
  });
  it('rejects a value that only shares the first six characters', () => {
    expect(check('text', 'Bengaluru North', 'Bengaluru').ok).toBe(false);
    expect(check('text', 'Ramachandra', 'Ramachandran').ok).toBe(false);
  });
});

describe('verify: truncation', () => {
  it('reports maxlength truncation as its own failure', () => {
    const verdict = check(
      'url',
      'https://github.com/a',
      'https://github.com/aditir',
      'maxlength="20"',
    );
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toMatch(/accepts 20 characters, so your value was cut/);
  });

  it('restores the previous value after a truncated write', async () => {
    document.body.innerHTML = `<label for="u">Website</label><input id="u" type="url" maxlength="20" value="old">`;
    const element = document.getElementById('u') as HTMLInputElement;
    // jsdom does not enforce maxlength on programmatic writes; a page does it here.
    element.addEventListener('input', () => {
      if (element.value.length > 20) element.value = element.value.slice(0, 20);
    });
    const entry = {
      fieldId: 'u',
      selected: true,
      newValue: 'https://github.com/aditir',
    } as FillPlanEntry;
    const { outcomes } = await fillFields([entry], {
      elements: new Map([['u', [element]]]),
      highlight: false,
    });
    expect(outcomes[0]!.ok).toBe(false);
    expect(outcomes[0]!.error).toMatch(/was cut/);
    expect(element.value).toBe('old');
  });
});

describe('plan: maxlength', () => {
  it('moves a value longer than maxlength to review before writing', () => {
    document.body.innerHTML = `<label for="g">GitHub</label><input id="g" name="github" maxlength="10">`;
    const profile = createEmptyProfile('Test');
    profile.links.github = tv('https://github.com/aditir', 'user', 1);
    const { fields } = harvestFields(document);
    const mapping = buildMappings(fields, profile, DEFAULT_SETTINGS).find(
      (item) => item.proposedValue === 'https://github.com/aditir',
    );
    expect(mapping?.status).toBe('review');
    expect(mapping?.rationale).toMatch(/accepts 10 characters/);
  });
});

describe('undo: custom dropdowns', () => {
  function combobox(shown: string): HTMLElement {
    document.body.innerHTML = `
      <div role="combobox" aria-expanded="false" tabindex="0">
        <div class="value">${shown}</div><input />
      </div>`;
    return document.querySelector<HTMLElement>('input')!;
  }

  it('lists a dropdown it cannot put back instead of claiming it', async () => {
    const element = combobox('');
    const record: UndoRecord = {
      fieldId: 'degree',
      elements: [element],
      previousValue: '',
      previousCheckedValue: null,
      previousShown: '',
    };
    const result = await undoFill([record]);
    expect(result.restored).toBe(0);
    expect(result.notRestored).toEqual(['degree']);
  });

  it('counts plain fields as restored', async () => {
    const element = input('text', 'new');
    const result = await undoFill([
      {
        fieldId: 'a',
        elements: [element],
        previousValue: 'old',
        previousCheckedValue: null,
        previousShown: null,
      },
    ]);
    expect(result).toEqual({ restored: 1, notRestored: [] });
    expect(element.value).toBe('old');
  });
});
