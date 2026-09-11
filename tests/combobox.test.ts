import { beforeEach, describe, expect, it } from 'vitest';
import { isCombobox, pickOption, selectInCombobox } from '@/autofill/combobox';

/**
 * Custom dropdowns are where naive autofill quietly gets things wrong: there is
 * no `.value` to set, so an implementation that assigns one appears to succeed
 * while the control still shows "Select…". These tests drive the widget the way
 * a person does, and check the refusals as carefully as the successes.
 */

/** Builds a React-Select-shaped combobox whose options only exist when open. */
function renderCombobox(options: string[], { portal = false } = {}) {
  document.body.innerHTML = `
    <div class="field">
      <label id="lbl">Degree</label>
      <div class="select__control" role="combobox" aria-expanded="false" aria-labelledby="lbl" tabindex="0">
        <div class="select__value">Select…</div>
        <input class="select__input" />
      </div>
    </div>
  `;

  const control = document.querySelector<HTMLElement>('.select__control')!;
  const value = document.querySelector<HTMLElement>('.select__value')!;

  const open = () => {
    if (control.getAttribute('aria-expanded') === 'true') return;
    control.setAttribute('aria-expanded', 'true');

    const menu = document.createElement('div');
    menu.className = 'select__menu';
    menu.setAttribute('role', 'listbox');

    for (const label of options) {
      const option = document.createElement('div');
      option.className = 'select__option';
      option.setAttribute('role', 'option');
      option.textContent = label;
      option.addEventListener('click', () => {
        value.textContent = label;
        control.setAttribute('aria-expanded', 'false');
        menu.remove();
      });
      menu.appendChild(option);
    }

    // Portal-rendered menus attach to <body>, far from the control.
    (portal ? document.body : control.parentElement!).appendChild(menu);
  };

  control.addEventListener('click', open);
  control.addEventListener('keydown', (event) => {
    if ((event as KeyboardEvent).key === 'ArrowDown') open();
  });

  // jsdom reports no layout boxes, which the portal lookup filters on.
  const rects = () => [{}] as unknown as DOMRectList;
  control.getClientRects = rects;
  const originalAppend = document.body.appendChild.bind(document.body);
  document.body.appendChild = ((node: Node) => {
    const appended = originalAppend(node);
    if (node instanceof HTMLElement) node.getClientRects = rects;
    return appended;
  }) as typeof document.body.appendChild;

  return { control, value };
}

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('recognising a custom dropdown', () => {
  it('spots the common library shapes', () => {
    document.body.innerHTML = `
      <div id="a" role="combobox"></div>
      <div id="b" aria-haspopup="listbox"></div>
      <div id="c" class="select__control"><input id="d" /></div>
      <input id="e" />
      <select id="f"></select>
    `;
    const byId = (id: string) => document.getElementById(id)!;
    expect(isCombobox(byId('a'))).toBe(true);
    expect(isCombobox(byId('b'))).toBe(true);
    expect(isCombobox(byId('c'))).toBe(true);
    // An input inside a combobox wrapper belongs to the combobox.
    expect(isCombobox(byId('d'))).toBe(true);
    expect(isCombobox(byId('e'))).toBe(false);
    // A native select is handled by the ordinary path, not this one.
    expect(isCombobox(byId('f'))).toBe(false);
  });
});

describe('choosing an option', () => {
  const options = (labels: string[]) =>
    labels.map((label) => ({ element: document.createElement('div'), label }));

  it('takes an exact match', () => {
    const result = pickOption(options(['B.Tech', 'B.Sc', 'M.Tech']), 'B.Sc');
    expect(result.option?.label).toBe('B.Sc');
  });

  it('matches yes and no across wordings', () => {
    expect(pickOption(options(['Yes', 'No']), 'yes').option?.label).toBe('Yes');
    expect(pickOption(options(['I do', 'I do not']), 'No').option?.label).toBe('I do not');
  });

  it('refuses an ambiguous match rather than guessing', () => {
    const result = pickOption(options(['Bachelor of Arts', 'Bachelor of Science']), 'Bachelor');
    expect(result.option).toBeNull();
    expect(result.reason).toMatch(/several options/i);
  });

  it('refuses when nothing matches, and says so in plain language', () => {
    const result = pickOption(options(['India', 'United States']), 'Atlantis');
    expect(result.option).toBeNull();
    expect(result.reason).toContain('Atlantis');
  });
});

describe('driving a real custom dropdown', () => {
  it('opens it, selects the right option and closes it', async () => {
    const { control, value } = renderCombobox(['B.Tech', 'Bachelor of Science', 'PhD']);

    const result = await selectInCombobox(control, 'PhD');

    expect(result.ok).toBe(true);
    expect(value.textContent).toBe('PhD');
    expect(control.getAttribute('aria-expanded')).toBe('false');
  });

  it('finds a menu rendered into a portal', async () => {
    const { control, value } = renderCombobox(['India', 'United States'], { portal: true });
    const result = await selectInCombobox(control, 'India');
    expect(result.ok).toBe(true);
    expect(value.textContent).toBe('India');
  });

  it('opens via the keyboard when a click does not', async () => {
    renderCombobox(['Yes', 'No']);
    const control = document.querySelector<HTMLElement>('.select__control')!;
    // Neutralise the click handler, leaving only the keydown path.
    const clone = control.cloneNode(true) as HTMLElement;
    control.replaceWith(clone);
    clone.getClientRects = () => [{}] as unknown as DOMRectList;

    const menu = document.createElement('div');
    menu.setAttribute('role', 'listbox');
    const option = document.createElement('div');
    option.setAttribute('role', 'option');
    option.textContent = 'Yes';
    menu.appendChild(option);

    clone.addEventListener('keydown', (event) => {
      if ((event as KeyboardEvent).key === 'ArrowDown') clone.appendChild(menu);
    });

    const result = await selectInCombobox(clone, 'Yes');
    expect(result.ok).toBe(true);
  });

  it('leaves the control alone when no option matches', async () => {
    const { control, value } = renderCombobox(['India', 'United States']);
    const result = await selectInCombobox(control, 'Atlantis');

    expect(result.ok).toBe(false);
    expect(result.reason).toContain('Atlantis');
    // The placeholder must survive: a failed match writes nothing.
    expect(value.textContent).toBe('Select…');
  });

  it('refuses an ambiguous option instead of picking one', async () => {
    const { value } = renderCombobox(['Bachelor of Arts', 'Bachelor of Science']);
    const control = document.querySelector<HTMLElement>('.select__control')!;

    const result = await selectInCombobox(control, 'Bachelor');
    expect(result.ok).toBe(false);
    expect(value.textContent).toBe('Select…');
  });

  it('reports a dropdown it cannot open, rather than failing silently', async () => {
    document.body.innerHTML = '<div id="dead" role="combobox"></div>';
    const dead = document.getElementById('dead')!;
    dead.getClientRects = () => [] as unknown as DOMRectList;

    const result = await selectInCombobox(dead, 'Anything');
    expect(result.ok).toBe(false);
    expect(result.reason.length).toBeGreaterThan(0);
  });
});
