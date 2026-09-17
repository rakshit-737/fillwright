import { beforeEach, describe, expect, it } from 'vitest';
import { harvestFields } from '@/field-detection/harvest';
import { classifyField } from '@/field-detection/classify';
import { buildMappings } from '@/autofill/plan';
import { fillFields } from '@/autofill/fill';
import { createEmptyProfile, tv } from '@/profile/factory';
import { emptyEducation, emptyExperience } from '@/profile/entries';
import { DEFAULT_SETTINGS } from '@/types/settings';
import type { FieldSignals } from '@/types/fields';

const visible = () => {
  for (const node of document.querySelectorAll<HTMLElement>('*')) {
    node.getClientRects = () => [{}] as unknown as DOMRectList;
  }
};

function profile() {
  const p = createEmptyProfile('T');
  p.personal.firstName = tv('Aditi', 'user', 1);
  p.personal.lastName = tv('Rao', 'user', 1);
  p.personal.fullName = tv('Aditi Rao', 'user', 1);
  p.personal.email = tv('a@example.com', 'user', 1);
  p.preferences.workModePreference = 'remote';
  p.education = [
    { ...emptyEducation(), institution: 'VIT', degree: 'B.Tech' },
    { ...emptyEducation(), institution: 'DPS', degree: 'High School' },
  ];
  p.experience = [
    { ...emptyExperience(), company: 'Zeta', title: 'Intern' },
    { ...emptyExperience(), company: 'IISc', title: 'Researcher' },
  ];
  return p;
}

const mappingsFor = () => {
  const { fields } = harvestFields(document);
  return { fields, mappings: buildMappings(fields, profile(), DEFAULT_SETTINGS) };
};

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('real ATS layouts', () => {
  it('reads a Lever-style label from the wrapper’s sibling', () => {
    document.body.innerHTML = `
      <ul><li class="application-question">
        <div class="application-label">Current company</div>
        <div class="application-field"><input name="org"></div>
      </li></ul>`;
    const { fields } = harvestFields(document);
    expect(fields[0]!.signals.labelText).toBe('Current company');
  });

  it('does not borrow a label for a wrapper with two controls', () => {
    document.body.innerHTML = `
      <div class="application-label">Dates</div>
      <div><input name="a"><input name="b"></div>`;
    const { fields } = harvestFields(document);
    expect(fields.every((field) => field.signals.labelText === '')).toBe(true);
  });

  it('does not treat a per-field wrapper as repeated blocks', () => {
    document.body.innerHTML = `
      <ul>
        <li class="q"><label for="n">Email</label><input id="n" name="email"></li>
        <li class="q"><label for="c">Current company</label><input id="c" name="org"></li>
        <li class="q"><label for="t">Current title</label><input id="t" name="title"></li>
      </ul>`;
    const { mappings } = mappingsFor();
    const company = mappings.find((m) => m.canonical === 'experience.company')!;
    expect(company.entryIndex).toBe(0);
    expect(company.proposedValue).toBe('Zeta');
  });

  it('still reads genuinely repeated blocks by structure', () => {
    document.body.innerHTML = `
      <div class="edu"><label for="s1">School</label><input id="s1"><label for="d1">Degree</label><input id="d1"></div>
      <div class="edu"><label for="s2">School</label><input id="s2"><label for="d2">Degree</label><input id="d2"></div>`;
    const { mappings } = mappingsFor();
    const schools = mappings.filter((m) => m.canonical === 'education.institution');
    expect(schools.map((m) => m.proposedValue)).toEqual(['VIT', 'DPS']);
  });

  it('reads Greenhouse double-dash ids as positions, and ignores counter ids', () => {
    document.body.innerHTML = `
      <label for="school--1">School</label><input id="school--1">
      <label for="school-7">University</label><input id="school-7">`;
    const { mappings } = mappingsFor();
    expect(mappings[0]!.entryIndex).toBe(1);
    expect(mappings[1]!.entryIndex).toBe(0);
  });

  it('treats a lone "Name" as the candidate on an email form', () => {
    document.body.innerHTML = `
      <label for="n">Name</label><input id="n">
      <label for="e">Email</label><input id="e" type="email">`;
    const { mappings } = mappingsFor();
    expect(mappings[0]!.status).toBe('ready');
    expect(mappings[0]!.proposedValue).toBe('Aditi Rao');
  });

  it('keeps "Name" for review when the form also asks for first and last name', () => {
    document.body.innerHTML = `
      <label for="f">First name</label><input id="f">
      <label for="l">Last name</label><input id="l">
      <label for="n">Name</label><input id="n">
      <label for="e">Email</label><input id="e" type="email">`;
    const { mappings } = mappingsFor();
    expect(mappings[2]!.status).toBe('review');
  });
});

describe('ARIA radio groups', () => {
  const markup = `
    <span id="q">Preferred work setting</span>
    <div role="radiogroup" aria-labelledby="q">
      <button type="button" role="radio" aria-checked="false">Remote</button>
      <button type="button" role="radio" aria-checked="false">Hybrid</button>
    </div>`;

  it('harvests the group with its question and options', () => {
    document.body.innerHTML = markup;
    visible();
    const { fields } = harvestFields(document);
    const group = fields.find((field) => field.kind === 'radio-group')!;
    expect(group.signals.labelText).toBe('Preferred work setting');
    expect(group.options.map((option) => option.label)).toEqual(['Remote', 'Hybrid']);
    expect(group.hasExistingValue).toBe(false);
  });

  it('answers it by pressing the matching option, and verifies the result', async () => {
    document.body.innerHTML = markup;
    document.querySelectorAll('[role=radio]').forEach((button) =>
      button.addEventListener('click', () => {
        document
          .querySelectorAll('[role=radio]')
          .forEach((other) => other.setAttribute('aria-checked', String(other === button)));
      }),
    );
    visible();
    const { fields, elements } = harvestFields(document);
    const mappings = buildMappings(fields, profile(), DEFAULT_SETTINGS);
    const mapping = mappings.find((m) => m.canonical === 'preferences.workMode')!;
    expect(mapping.proposedValue.toLowerCase()).toBe('remote');
    const { outcomes } = await fillFields(
      [
        {
          fieldId: mapping.fieldId,
          label: '',
          canonical: mapping.canonical,
          currentValue: '',
          newValue: mapping.proposedOptionValue ?? mapping.proposedValue,
          status: 'ready',
          confidence: 1,
          rationale: '',
          selected: true,
          fingerprint: '',
          remembered: false,
        },
      ],
      { elements, highlight: false },
    );
    expect(outcomes[0]!.ok).toBe(true);
    expect(document.querySelector('[aria-checked=true]')?.textContent).toBe('Remote');
  });

  it('reports a page that ignores the press', async () => {
    document.body.innerHTML = markup;
    visible();
    const { fields, elements } = harvestFields(document);
    const id = fields.find((field) => field.kind === 'radio-group')!.id;
    const { outcomes } = await fillFields(
      [
        {
          fieldId: id,
          label: '',
          canonical: 'preferences.workMode',
          currentValue: '',
          newValue: 'Remote',
          status: 'ready',
          confidence: 1,
          rationale: '',
          selected: true,
          fingerprint: '',
          remembered: false,
        },
      ],
      { elements, highlight: false },
    );
    expect(outcomes[0]!.ok).toBe(false);
  });
});

describe('years of experience', () => {
  const base: FieldSignals = {
    labelText: '',
    ariaLabel: '',
    ariaDescription: '',
    placeholder: '',
    name: '',
    id: '',
    autocomplete: '',
    inputType: 'text',
    title: '',
    sectionHeading: '',
    precedingText: '',
    optionLabels: [],
    required: false,
    maxLength: null,
  };
  const kind = (labelText: string) => classifyField({ ...base, labelText }).field;

  it('answers total experience', () => {
    expect(kind('Years of experience')).toBe('experience.yearsOfExperience');
    expect(kind('Total years of experience')).toBe('experience.yearsOfExperience');
    expect(kind('Experience in years')).toBe('experience.yearsOfExperience');
  });

  it('does not answer a skill-specific question from the total', () => {
    expect(kind('How many years of work experience do you have with Python?')).not.toBe(
      'experience.yearsOfExperience',
    );
    expect(kind('Years of experience using Kubernetes')).not.toBe('experience.yearsOfExperience');
    expect(kind('Years of experience in React')).not.toBe('experience.yearsOfExperience');
  });
});
