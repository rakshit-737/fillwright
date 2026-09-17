import { beforeEach, describe, expect, it } from 'vitest';
import { isPressSafe } from '@/autofill/press-guard';
import { selectInCombobox } from '@/autofill/combobox';
import { fillFields } from '@/autofill/fill';
import { harvestFields } from '@/field-detection/harvest';

const rects = () => [{}] as unknown as DOMRectList;

let submitted = 0;
let navigated = 0;

beforeEach(() => {
  submitted = 0;
  navigated = 0;
  document.body.innerHTML = '';
});

function trap() {
  document.querySelectorAll('form').forEach((form) =>
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      submitted += 1;
    }),
  );
  document.querySelectorAll('a').forEach((link) =>
    link.addEventListener('click', (event) => {
      event.preventDefault();
      navigated += 1;
    }),
  );
  document.querySelectorAll<HTMLElement>('*').forEach((node) => (node.getClientRects = rects));
}

describe('press guard', () => {
  it('refuses submit controls whatever role they claim', () => {
    document.body.innerHTML = `
      <form>
        <button id="a" role="option">Yes</button>
        <button id="b" type="submit" role="radio">Yes</button>
        <input id="c" type="submit" role="option" value="Yes">
        <button id="d" role="combobox"><span id="e">Pick</span></button>
        <div id="f" role="option" formaction="/x">Yes</div>
        <button id="ok1" type="button" role="option">Yes</button>
      </form>
      <a href="/next"><span id="g" role="option">Yes</span></a>
      <div id="ok2" role="option">Yes</div>`;
    for (const id of ['a', 'b', 'c', 'd', 'e', 'f', 'g']) {
      expect(isPressSafe(document.getElementById(id)!), id).toBe(false);
    }
    expect(isPressSafe(document.getElementById('ok1')!)).toBe(true);
    expect(isPressSafe(document.getElementById('ok2')!)).toBe(true);
  });

  it('a hostile dropdown whose option is a submit button is not pressed', async () => {
    document.body.innerHTML = `
      <form>
        <div role="combobox" aria-controls="l" aria-expanded="true" id="cb">Country</div>
        <div role="listbox" id="l"><button role="option">India</button></div>
      </form>`;
    trap();
    const result = await selectInCombobox(document.getElementById('cb')!, 'India');
    expect(result.ok).toBe(false);
    expect(submitted).toBe(0);
  });

  it('a hostile combobox that is itself a submit button is not pressed', async () => {
    document.body.innerHTML = `
      <form><button role="combobox" id="cb">Open</button></form>`;
    trap();
    const result = await selectInCombobox(document.getElementById('cb')!, 'India');
    expect(result.ok).toBe(false);
    expect(submitted).toBe(0);
  }, 10_000);

  it('a hostile radio group made of submit buttons and links is not pressed', async () => {
    document.body.innerHTML = `
      <form>
        <span id="q">Preferred work setting</span>
        <div role="radiogroup" aria-labelledby="q">
          <button role="radio" aria-checked="false">Remote</button>
          <a href="/go" role="radio" aria-checked="false">Hybrid</a>
        </div>
      </form>`;
    trap();
    const { fields, elements } = harvestFields(document);
    const id = fields.find((field) => field.kind === 'radio-group')!.id;
    const entry = (value: string) => ({
      fieldId: id,
      label: '',
      canonical: 'preferences.workMode' as const,
      currentValue: '',
      newValue: value,
      status: 'ready' as const,
      confidence: 1,
      rationale: '',
      selected: true,
      fingerprint: '',
      remembered: false,
    });
    await fillFields([entry('Remote')], { elements, highlight: false });
    await fillFields([entry('Hybrid')], { elements, highlight: false });
    expect(submitted).toBe(0);
    expect(navigated).toBe(0);
  });
});
