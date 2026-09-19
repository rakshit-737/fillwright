import { beforeEach, describe, expect, it } from 'vitest';
import { harvestFields } from '@/field-detection/harvest';
import { classifyField } from '@/field-detection/classify';
import { buildFillPlan, buildMappings } from '@/autofill/plan';
import { resolveForField, splitPhone } from '@/autofill/resolve';
import { monthNumber } from '@/autofill/aliases';
import { secondPassTargets } from '@/autofill/second-pass';
import { controlSignature, mutationsMayAffectForm } from '@/content/observe';
import { FIELD_CATALOG } from '@/field-detection/catalog';
import { createEmptyProfile, newId, provenance, tv } from '@/profile/factory';
import { DEFAULT_SETTINGS } from '@/types/settings';
import type { CanonicalField, DetectedField, FieldSignals, ScanResult } from '@/types/fields';
import type { Profile } from '@/types/profile';

function profileWithHistory(): Profile {
  const profile = createEmptyProfile('Shapes');
  profile.personal.phone = tv('+91 98450 12345', 'user', 1);
  profile.address.country = tv('India', 'user', 1);
  profile.address.state = tv('Karnataka', 'user', 1);
  profile.education = [
    {
      id: newId('edu'),
      institution: 'Vellore Institute of Technology',
      degree: 'B.Tech',
      major: 'Computer Science',
      minor: '',
      location: 'Vellore',
      startDate: '2022-08',
      endDate: '2026-05',
      graduationDate: '2026-05',
      gpa: '8.94',
      gpaScale: '10',
      honors: '',
      coursework: [],
      current: true,
      provenance: provenance('user', 1),
    },
  ];
  profile.experience = [
    {
      id: newId('exp'),
      company: 'Zeta Payments',
      title: 'Software Engineering Intern',
      employmentType: 'internship',
      location: 'Bengaluru',
      locationType: '',
      startDate: '2025-06',
      endDate: '2025-08',
      current: false,
      description: '',
      highlights: [],
      technologies: [],
      provenance: provenance('user', 1),
    },
  ];
  return profile;
}

function detected(
  partial: Partial<DetectedField> & { kind: DetectedField['kind'] },
): DetectedField {
  return {
    id: 'f1',
    signals: signals({}),
    options: [],
    currentValue: '',
    hasExistingValue: false,
    visible: true,
    disabled: false,
    readOnly: false,
    order: 0,
    selectorHint: 'input',
    groupSignature: null,
    groupOrdinal: null,
    ...partial,
  };
}

function signals(partial: Partial<FieldSignals>): FieldSignals {
  return {
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
    ...partial,
  };
}

const options = (labels: string[], values = labels) =>
  labels.map((label, i) => ({ label, value: values[i]! }));

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

beforeEach(() => {
  document.body.innerHTML = '';
});

/* ------------------------------------------------------------ months */

describe('month and year parts of a date', () => {
  it('reads month names, abbreviations and numbers', () => {
    expect(monthNumber('August')).toBe(8);
    expect(monthNumber('Sept')).toBe(9);
    expect(monthNumber('08')).toBe(8);
    expect(monthNumber('8')).toBe(8);
    expect(monthNumber('13')).toBeNull();
    expect(monthNumber('Marching')).toBeNull();
  });

  it('matches a month select by name, even when the option values are numbers', () => {
    const field = detected({
      kind: 'select',
      options: [
        { label: 'Month', value: '' },
        ...options(
          MONTH_NAMES,
          MONTH_NAMES.map((_, i) => String(i + 1)),
        ),
      ],
    });
    const start = resolveForField('education.startMonth', field, profileWithHistory());
    expect(start.value).toBe('August');
    expect(start.optionValue).toBe('8');
  });

  it('matches a month select by number and by abbreviation', () => {
    const numbered = detected({
      kind: 'select',
      options: options([
        'MM',
        '01',
        '02',
        '03',
        '04',
        '05',
        '06',
        '07',
        '08',
        '09',
        '10',
        '11',
        '12',
      ]),
    });
    expect(resolveForField('experience.startMonth', numbered, profileWithHistory()).value).toBe(
      '06',
    );
    const short = detected({
      kind: 'select',
      options: options([
        'Jan',
        'Feb',
        'Mar',
        'Apr',
        'May',
        'Jun',
        'Jul',
        'Aug',
        'Sep',
        'Oct',
        'Nov',
        'Dec',
      ]),
    });
    expect(resolveForField('experience.endMonth', short, profileWithHistory()).value).toBe('Aug');
  });

  it('writes MM and YYYY into plain text inputs', () => {
    const text = detected({ kind: 'text' });
    const profile = profileWithHistory();
    expect(resolveForField('education.startMonth', text, profile).value).toBe('08');
    expect(resolveForField('education.startYear', text, profile).value).toBe('2022');
    expect(resolveForField('education.endYear', text, profile).value).toBe('2026');
    expect(resolveForField('experience.endMonth', text, profile).value).toBe('08');
  });

  it('matches a year select', () => {
    const years = detected({ kind: 'select', options: options(['Year', '2027', '2026', '2025']) });
    expect(resolveForField('education.endYear', years, profileWithHistory()).value).toBe('2026');
  });

  it('never invents a month for a year-only date', () => {
    const profile = profileWithHistory();
    profile.experience[0]!.startDate = '2025';
    const text = detected({ kind: 'text' });
    expect(resolveForField('experience.startMonth', text, profile).value).toBe('');
    expect(resolveForField('experience.startYear', text, profile).value).toBe('2025');
  });
});

/* ---------------------------------------------------- current role */

describe('"I currently work here"', () => {
  it('ticks the box for a current role and leaves the end date empty', () => {
    const profile = profileWithHistory();
    profile.experience[0]!.current = true;
    profile.experience[0]!.endDate = '';
    const box = detected({ kind: 'checkbox', options: options(['I currently work here'], ['on']) });
    expect(resolveForField('experience.current', box, profile).value).toBe('Yes');
    const text = detected({ kind: 'text' });
    for (const field of [
      'experience.endMonth',
      'experience.endYear',
      'experience.endDate',
    ] as CanonicalField[]) {
      const resolved = resolveForField(field, text, profile);
      expect(resolved.value, field).toBe('');
      expect(resolved.note, field).toMatch(/currently work here/);
    }
  });

  it('leaves the box unticked for a past role', () => {
    const box = detected({ kind: 'checkbox', options: options(['I currently work here'], ['on']) });
    expect(resolveForField('experience.current', box, profileWithHistory()).value).toBe('No');
  });

  it('is recognised as its own field', () => {
    const result = classifyField(
      signals({
        labelText: 'I currently work here',
        inputType: 'checkbox',
        sectionHeading: 'Work Experience',
      }),
    );
    expect(result.field).toBe('experience.current');
  });
});

/* -------------------------------------------------------- location */

describe('location per entry', () => {
  it('resolves each entry’s own location', () => {
    const text = detected({ kind: 'text' });
    const profile = profileWithHistory();
    expect(resolveForField('experience.location', text, profile).value).toBe('Bengaluru');
    expect(resolveForField('education.location', text, profile).value).toBe('Vellore');
  });

  it('reads "Location" inside an experience block as that role’s location', () => {
    expect(
      classifyField(signals({ labelText: 'Location', sectionHeading: 'Work Experience 1' })).field,
    ).toBe('experience.location');
    expect(
      classifyField(signals({ labelText: 'Location', sectionHeading: 'Education' })).field,
    ).toBe('education.location');
    // Outside a block it is still the candidate's own location.
    expect(classifyField(signals({ labelText: 'Location' })).field).toBe('address.formatted');
  });
});

/* ------------------------------------------------------- classify */

describe('month / year labels', () => {
  const cases: Array<[string, string, CanonicalField]> = [
    ['Start Month', 'Education', 'education.startMonth'],
    ['Start Year', 'Education', 'education.startYear'],
    ['End Month', 'Education', 'education.endMonth'],
    ['Graduation Year', '', 'education.endYear'],
    ['From Month', 'Work Experience', 'experience.startMonth'],
    ['From Year', 'Work Experience', 'experience.startYear'],
    ['To Month', 'Work Experience', 'experience.endMonth'],
    ['To Year', 'Employment history', 'experience.endYear'],
  ];
  for (const [label, heading, field] of cases) {
    it(`"${label}" under "${heading}" → ${field}`, () => {
      const result = classifyField(signals({ labelText: label, sectionHeading: heading }));
      expect(result.field).toBe(field);
      expect(result.confidence).toBeGreaterThanOrEqual(0.7);
    });
  }

  it('declines a bare "Start Month" that belongs to no block', () => {
    expect(classifyField(signals({ labelText: 'Start Month' })).field).toBe('unknown');
  });

  it('keeps start dates and month parts apart', () => {
    expect(classifyField(signals({ labelText: 'Employment start month' })).field).toBe(
      'experience.startMonth',
    );
    expect(classifyField(signals({ labelText: 'Employment start date' })).field).toBe(
      'experience.startDate',
    );
  });
});

/* ----------------------------------------------------------- phone */

describe('phone country code and national number', () => {
  it('splits a stored +CC number', () => {
    expect(splitPhone('+91 98450 12345')).toEqual({ code: '91', national: '98450 12345' });
    expect(splitPhone('+1 (415) 555-0132')).toEqual({ code: '1', national: '(415) 555-0132' });
  });

  it('declines when the stored phone has no +CC prefix', () => {
    expect(splitPhone('98450 12345')).toBeNull();
    expect(splitPhone('+919845012345')).toBeNull();
    const profile = profileWithHistory();
    profile.personal.phone = tv('98450 12345', 'user', 1);
    const text = detected({ kind: 'text' });
    expect(resolveForField('personal.phoneCountryCode', text, profile).value).toBe('');
    expect(resolveForField('personal.phoneNational', text, profile).value).toBe('');
  });

  it('matches a country-code select by its dialling code', () => {
    const select = detected({
      kind: 'select',
      options: options(
        ['Select', 'United States (+1)', 'India (+91)', 'United Kingdom (+44)'],
        ['', 'US', 'IN', 'GB'],
      ),
    });
    const resolved = resolveForField('personal.phoneCountryCode', select, profileWithHistory());
    expect(resolved.optionValue).toBe('IN');
  });

  it('uses the saved country to choose between countries that share a code, else declines', () => {
    const profile = profileWithHistory();
    profile.personal.phone = tv('+1 415 555 0132', 'user', 1);
    profile.address.country = tv('Canada', 'user', 1);
    const select = detected({
      kind: 'select',
      options: options(['United States +1', 'Canada +1', 'India +91'], ['US', 'CA', 'IN']),
    });
    expect(resolveForField('personal.phoneCountryCode', select, profile).optionValue).toBe('CA');
    profile.address.country = tv('', 'user', 1);
    expect(resolveForField('personal.phoneCountryCode', select, profile).value).toBe('');
  });

  it('writes the national number next to a country-code select', () => {
    document.body.innerHTML = `
      <label for="cc">Country code</label>
      <select id="cc"><option value="">--</option><option value="+91">India (+91)</option></select>
      <label for="ph">Phone number</label><input id="ph" type="tel" />`;
    const { fields } = harvestFields(document);
    const mappings = buildMappings(fields, profileWithHistory(), DEFAULT_SETTINGS);
    const code = mappings.find((m) => m.fieldId === fields[0]!.id)!;
    const phone = mappings.find((m) => m.fieldId === fields[1]!.id)!;
    expect(code.canonical).toBe('personal.phoneCountryCode');
    expect(code.proposedOptionValue).toBe('+91');
    expect(phone.canonical).toBe('personal.phoneNational');
    expect(phone.proposedValue).toBe('98450 12345');
  });

  it('still writes the whole number when there is no country-code field', () => {
    document.body.innerHTML = `<label for="ph">Phone number</label><input id="ph" type="tel" />`;
    const { fields } = harvestFields(document);
    const [phone] = buildMappings(fields, profileWithHistory(), DEFAULT_SETTINGS);
    expect(phone!.canonical).toBe('personal.phone');
    expect(phone!.proposedValue).toBe('+91 98450 12345');
  });
});

/* --------------------------------------------------------- catalog */

describe('catalog', () => {
  it('lists every new field so a user can assign it by hand', () => {
    const listed = new Set(FIELD_CATALOG.map((entry) => entry.field));
    for (const field of [
      'personal.phoneCountryCode',
      'personal.phoneNational',
      'education.startMonth',
      'education.startYear',
      'education.endMonth',
      'education.endYear',
      'education.location',
      'experience.startMonth',
      'experience.startYear',
      'experience.endMonth',
      'experience.endYear',
      'experience.current',
      'experience.location',
    ] as CanonicalField[]) {
      expect(listed.has(field), field).toBe(true);
    }
  });
});

/* ------------------------------------------- dependent dropdowns */

describe('dependent dropdowns', () => {
  const FORM = `
    <label for="country">Country</label>
    <select id="country"><option value="">Select</option><option>India</option></select>
    <label for="state">State</label>
    <select id="state"><option value="">Select a country first</option></select>`;

  it('counts options in the control signature', () => {
    document.body.innerHTML = FORM;
    const before = controlSignature(document);
    const state = document.getElementById('state') as HTMLSelectElement;
    state.add(new Option('Karnataka', 'KA'));
    expect(controlSignature(document)).not.toBe(before);
  });

  it('notices options added to an existing select', async () => {
    document.body.innerHTML = FORM;
    const state = document.getElementById('state') as HTMLSelectElement;
    const records = await new Promise<MutationRecord[]>((resolve) => {
      const observer = new MutationObserver((list) => {
        observer.disconnect();
        resolve(list);
      });
      observer.observe(document.body, { childList: true, subtree: true });
      state.add(new Option('Karnataka', 'KA'));
    });
    expect(mutationsMayAffectForm(records)).toBe(true);
  });

  it('finds the select whose options arrived after the fill, and only that one', () => {
    document.body.innerHTML = FORM;
    const profile = profileWithHistory();
    const first = harvestFields(document).fields;
    const mappings = buildMappings(first, profile, DEFAULT_SETTINGS);
    const scan: ScanResult = {
      url: 'https://jobs.example.com/apply',
      pageKey: 'https://jobs.example.com/apply',
      adapterId: null,
      scannedAt: '',
      fields: first,
      mappings,
    };
    const plan = buildFillPlan(scan, 's1');
    const stateEntry = plan.entries.find((entry) => entry.canonical === 'address.state')!;
    expect(stateEntry.newValue).toBe('');

    // The fill picks the country; the page then loads that country's states.
    (document.getElementById('country') as HTMLSelectElement).value = 'India';
    const state = document.getElementById('state') as HTMLSelectElement;
    state.add(new Option('Kerala', 'KL'));
    state.add(new Option('Karnataka', 'KA'));

    const second = harvestFields(document).fields;
    const targets = secondPassTargets(first, second, plan);
    expect(targets.map((field) => field.signals.labelText)).toEqual(['State']);

    const again = buildMappings(second, profile, DEFAULT_SETTINGS);
    const now = again.find((m) => m.fieldId === targets[0]!.id)!;
    expect(now.status).toBe('ready');
    expect(now.proposedOptionValue).toBe('KA');
  });

  it('offers nothing when no option list changed', () => {
    document.body.innerHTML = FORM;
    const first = harvestFields(document).fields;
    const second = harvestFields(document).fields;
    expect(secondPassTargets(first, second, null)).toEqual([]);
  });
});

/* --------------------------------------------- fixture-shaped forms */

describe('Greenhouse-style education and employment blocks', () => {
  it('maps MM / YYYY inputs, month-name selects, location and the current-role box', () => {
    const months = MONTH_NAMES.map((name, i) => `<option value="${i + 1}">${name}</option>`).join(
      '',
    );
    const years = ['2026', '2025', '2024'].map((y) => `<option>${y}</option>`).join('');
    document.body.innerHTML = `
      <div id="education_section"><h3>Education</h3>
        <div class="field"><span class="label">Start Date</span>
          <input aria-label="Start date month" placeholder="MM" name="job_application[educations][][start_date][month]">
          <input aria-label="Start date year" placeholder="YYYY" name="job_application[educations][][start_date][year]">
        </div>
        <div class="field"><span class="label">End Date</span>
          <input aria-label="End date month" placeholder="MM" name="job_application[educations][][end_date][month]">
          <input aria-label="End date year" placeholder="YYYY" name="job_application[educations][][end_date][year]">
        </div>
      </div>
      <div id="employment_section"><h3>Employment</h3>
        <div class="field"><label for="loc">Location</label><input id="loc"></div>
        <div class="field">
          <label for="sm">Start Month</label><select id="sm"><option value="">Month</option>${months}</select>
          <label for="sy">Start Year</label><select id="sy"><option value="">Year</option>${years}</select>
        </div>
        <div class="field"><label><input type="checkbox" id="cur"> I currently work here</label></div>
      </div>`;
    const { fields } = harvestFields(document);
    const mappings = buildMappings(fields, profileWithHistory(), DEFAULT_SETTINGS);
    const got = mappings.map((m) => `${m.canonical}=${m.proposedOptionValue ?? m.proposedValue}`);
    expect(got).toEqual([
      'education.startMonth=08',
      'education.startYear=2022',
      'education.endMonth=05',
      'education.endYear=2026',
      'experience.location=Bengaluru',
      'experience.startMonth=6',
      'experience.startYear=2025',
      'experience.current=No',
    ]);
    expect(mappings.every((m) => m.status === 'ready')).toBe(true);
  });
});
