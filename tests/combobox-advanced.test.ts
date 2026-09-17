import { beforeEach, describe, expect, it } from 'vitest';
import { MAX_PREFIX, pickOption, prefixesFor, selectInCombobox } from '@/autofill/combobox';
import { aliasKey, sameByAlias } from '@/autofill/aliases';
import { matchOption } from '@/autofill/resolve';

const rects = () => [{}] as unknown as DOMRectList;

beforeEach(() => {
  document.body.innerHTML = '';
});

/** Workday-style prompt: options arrive only after 2+ characters, after a delay. */
function asyncPrompt(schools: string[]) {
  document.body.innerHTML = `
    <div class="box">
      <input id="q" role="combobox" aria-controls="list" aria-expanded="false" />
      <div class="chosen"></div>
    </div>`;
  const input = document.getElementById('q') as HTMLInputElement;
  const box = input.parentElement!;
  const typed: string[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  input.addEventListener('input', () => {
    typed.push(input.value);
    clearTimeout(timer);
    const query = input.value;
    timer = setTimeout(() => {
      document.getElementById('list')?.remove();
      if (query.length < 2) return;
      const list = document.createElement('div');
      list.id = 'list';
      list.setAttribute('role', 'listbox');
      for (const school of schools.filter((s) => s.toLowerCase().includes(query.toLowerCase()))) {
        const option = document.createElement('div');
        option.setAttribute('role', 'option');
        option.textContent = school;
        option.addEventListener('click', () => {
          box.querySelector('.chosen')!.textContent = school;
          input.value = '';
          list.remove();
        });
        list.appendChild(option);
      }
      list.getClientRects = rects;
      box.appendChild(list);
    }, 120);
  });
  return { input, box, typed };
}

describe('async option lists', () => {
  it('types a short prefix, waits for results, and selects', async () => {
    const { input, box, typed } = asyncPrompt([
      'Vellore Institute of Technology',
      'Vellore Institute of Technology - Chennai',
      'Delhi University',
    ]);
    const result = await selectInCombobox(input, 'Vellore Institute of Technology');
    expect(result.ok).toBe(true);
    expect(box.querySelector('.chosen')!.textContent).toBe('Vellore Institute of Technology');
    // Privacy: never the whole value, never more than the bound.
    expect(typed.length).toBeGreaterThan(0);
    for (const value of typed) {
      expect(value.length).toBeLessThanOrEqual(MAX_PREFIX);
      expect(value).not.toBe('Vellore Institute of Technology');
    }
  });

  it('clears its prefix and reports when nothing matches', async () => {
    const { input, typed } = asyncPrompt(['Delhi University']);
    const result = await selectInCombobox(input, 'Stanford University');
    expect(result.ok).toBe(false);
    expect(input.value).toBe('');
    expect(Math.max(...typed.map((value) => value.length))).toBeLessThanOrEqual(MAX_PREFIX);
  }, 20_000);

  it('computes prefixes shortest first and bounded', () => {
    expect(prefixesFor('Vellore Institute')).toEqual(['Vel', 'Vell', 'Vello', 'Vellor']);
    expect(prefixesFor('MIT')).toEqual(['MIT']);
    expect(prefixesFor('IT')).toEqual(['IT']);
  });
});

/** A list that renders only the rows in its visible window. */
function virtualList(total: number, pick: (label: string) => void) {
  document.body.innerHTML = `
    <div class="control" role="combobox" aria-controls="vlist" aria-expanded="true"></div>
    <div id="vlist" role="listbox"></div>`;
  const control = document.querySelector<HTMLElement>('.control')!;
  const list = document.getElementById('vlist')!;
  const rowHeight = 20;
  const visibleRows = 10;
  let top = 0;
  Object.defineProperty(list, 'clientHeight', { get: () => rowHeight * visibleRows });
  Object.defineProperty(list, 'scrollHeight', { get: () => rowHeight * total });
  Object.defineProperty(list, 'scrollTop', {
    get: () => top,
    set: (value: number) => {
      top = Math.max(0, Math.min(value, rowHeight * (total - visibleRows)));
      render();
    },
  });
  const render = () => {
    list.replaceChildren();
    const first = Math.floor(top / rowHeight);
    for (let i = first; i < Math.min(total, first + visibleRows); i++) {
      const option = document.createElement('div');
      option.setAttribute('role', 'option');
      option.textContent = `Country ${String(i).padStart(3, '0')}`;
      option.addEventListener('click', () => pick(option.textContent!));
      list.appendChild(option);
    }
  };
  render();
  list.getClientRects = rects;
  return { control, list };
}

describe('virtualised lists', () => {
  it('scrolls to find an option that is not rendered yet', async () => {
    let chosen = '';
    const { control } = virtualList(200, (label) => (chosen = label));
    const result = await selectInCombobox(control, 'Country 150');
    expect(result.ok).toBe(true);
    expect(chosen).toBe('Country 150');
  });

  it('gives up within its bound on an endless list', async () => {
    let chosen = '';
    const { control } = virtualList(100_000, (label) => (chosen = label));
    const result = await selectInCombobox(control, 'Country 99999');
    expect(result.ok).toBe(false);
    expect(chosen).toBe('');
  }, 20_000);
});

describe('multi-select', () => {
  function skills(existing: string[]) {
    document.body.innerHTML = `
      <div class="wrap">
        <div class="chips">${existing.map((e) => `<span class="multi-value">${e}</span>`).join('')}</div>
        <div class="control" role="combobox" aria-multiselectable="true" aria-controls="sl"></div>
      </div>`;
    const control = document.querySelector<HTMLElement>('.control')!;
    const chips = document.querySelector<HTMLElement>('.chips')!;
    const removed: string[] = [];
    chips.addEventListener('click', (event) =>
      removed.push((event.target as HTMLElement).textContent ?? ''),
    );
    control.addEventListener('click', () => {
      if (document.getElementById('sl')) return;
      const list = document.createElement('div');
      list.id = 'sl';
      list.setAttribute('role', 'listbox');
      for (const skill of ['Python', 'React', 'Rust', 'Go']) {
        const option = document.createElement('div');
        option.setAttribute('role', 'option');
        option.textContent = skill;
        option.addEventListener('click', () => {
          const chip = document.createElement('span');
          chip.className = 'multi-value';
          chip.textContent = skill;
          chips.appendChild(chip);
          list.remove();
        });
        list.appendChild(option);
      }
      list.getClientRects = rects;
      document.body.appendChild(list);
    });
    return { control, chips, removed };
  }

  it('adds each matching value and keeps existing selections', async () => {
    const { control, chips, removed } = skills(['Go']);
    const result = await selectInCombobox(control, 'Python, Go, React');
    expect(result.ok).toBe(true);
    const labels = Array.from(chips.children).map((chip) => chip.textContent);
    expect(labels).toEqual(['Go', 'Python', 'React']);
    expect(removed).toEqual([]);
  });

  it('reports values the list does not offer, without failing the rest', async () => {
    const { control } = skills([]);
    const result = await selectInCombobox(control, 'Python, Haskell');
    expect(result.ok).toBe(true);
    expect(result.selected).toEqual(['Python']);
    expect(result.reason).toMatch(/Haskell/);
  });
});

describe('aliases', () => {
  const opts = (labels: string[]) => labels.map((label) => ({ element: document.body, label }));

  it('matches countries, degrees and months by known spelling', () => {
    expect(pickOption(opts(['India', 'United States of America']), 'USA').option?.label).toBe(
      'United States of America',
    );
    expect(
      pickOption(opts(['Bachelor of Technology', 'Master of Technology']), 'B.Tech').option?.label,
    ).toBe('Bachelor of Technology');
    expect(pickOption(opts(['Jan', 'Feb', 'Sep']), 'September').option?.label).toBe('Sep');
    expect(sameByAlias('U.K.', 'Great Britain')).toBe(true);
  });

  it('matches contained options only as whole words', () => {
    expect(pickOption(opts(['India', 'Indonesia']), 'Indiana').option).toBeNull();
    expect(pickOption(opts(['India (IN)', 'Indonesia (ID)']), 'India').option?.label).toBe(
      'India (IN)',
    );
    expect(matchOption('Indiana', [{ value: 'IN', label: 'India' }])).toBeNull();
  });

  it('leaves everything outside the table ambiguous', () => {
    expect(aliasKey('Software Engineer')).toBeNull();
    expect(
      pickOption(opts(['Bachelor of Arts', 'Bachelor of Science']), 'Bachelor').option,
    ).toBeNull();
    expect(
      pickOption(opts(['United States', 'United States of America']), 'USA').option,
    ).toBeNull();
  });

  it('applies to native selects through the resolver', () => {
    const match = matchOption('USA', [
      { value: 'IN', label: 'India' },
      { value: 'US', label: 'United States of America' },
    ]);
    expect(match?.option.value).toBe('US');
  });
});
