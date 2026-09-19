import { beforeEach, describe, expect, it } from 'vitest';
import { harvestFields } from '@/field-detection/harvest';
import { buildMappings, buildFillPlan, fingerprintOf } from '@/autofill/plan';
import { fillFields, undoFill } from '@/autofill/fill';
import {
  matchOption,
  resolveValue,
  detectCountry,
  detectCountries,
  formatForDateInput,
} from '@/autofill/resolve';
import { createEmptyProfile, newId, provenance, tv } from '@/profile/factory';
import { DEFAULT_SETTINGS } from '@/types/settings';
import type { Profile } from '@/types/profile';
import type { ScanResult } from '@/types/fields';

function testProfile(): Profile {
  const profile = createEmptyProfile('Test');
  profile.personal.firstName = tv('Aditi', 'user', 1);
  profile.personal.lastName = tv('Ramachandran', 'user', 1);
  profile.personal.email = tv('aditi@example.com', 'user', 1);
  profile.personal.phone = tv('+91 98450 12345', 'user', 1);
  profile.address.city = tv('Bengaluru', 'user', 1);
  profile.address.country = tv('India', 'user', 1);
  profile.links.github = tv('https://github.com/aditir', 'user', 1);
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
  return profile;
}

function scanOf(profile: Profile, settings = DEFAULT_SETTINGS) {
  const { fields, elements } = harvestFields(document);
  const mappings = buildMappings(fields, profile, settings);
  const scan: ScanResult = {
    url: 'https://jobs.example.com/apply',
    pageKey: 'https://jobs.example.com/apply',
    adapterId: null,
    scannedAt: new Date().toISOString(),
    fields,
    mappings,
  };
  return { scan, elements, plan: buildFillPlan(scan, 'scan-1') };
}

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('value resolution', () => {
  it('resolves stored profile values', () => {
    const profile = testProfile();
    expect(resolveValue('personal.firstName', profile).value).toBe('Aditi');
    expect(resolveValue('education.institution', profile).value).toBe(
      'Vellore Institute of Technology',
    );
    expect(resolveValue('education.graduationDate', profile).value).toBe('2026-05');
  });

  it('composes a full name but says that it did', () => {
    const resolved = resolveValue('personal.fullName', testProfile());
    expect(resolved.value).toBe('Aditi Ramachandran');
    expect(resolved.note).toMatch(/built from/);
    expect(resolved.confidence).toBeLessThan(1);
  });

  it('returns nothing for a field with no stored value', () => {
    const resolved = resolveValue('links.linkedin', testProfile());
    expect(resolved.value).toBe('');
    expect(resolved.note).toMatch(/not stored/);
  });

  it('never turns an unanswered sensitive question into "No"', () => {
    const profile = testProfile();
    for (const field of [
      'sensitive.criminalHistory',
      'sensitive.willingToRelocate',
      'sensitive.drugTestConsent',
    ] as const) {
      const resolved = resolveValue(field, profile);
      expect(resolved.value).toBe('');
      expect(resolved.needsConsent).toBe(true);
    }
  });

  it('withholds demographics unless the master switch is on', () => {
    const profile = testProfile();
    profile.sensitive.demographics.gender = 'Female';
    expect(resolveValue('sensitive.gender', profile).value).toBe('');

    profile.sensitive.demographics.shareDemographics = true;
    expect(resolveValue('sensitive.gender', profile).value).toBe('Female');
  });

  it('withholds salary unless the master switch is on', () => {
    const profile = testProfile();
    profile.sensitive.compensation.expectedSalary = '2000000';
    expect(resolveValue('preferences.desiredSalary', profile).value).toBe('');

    profile.sensitive.compensation.shareCompensation = true;
    expect(resolveValue('preferences.desiredSalary', profile).value).toBe('2000000');
  });
});

describe('work authorisation is answered per country', () => {
  it('reads the country out of the question', () => {
    expect(detectCountry('Are you legally authorized to work in the United States?')).toBe('US');
    expect(detectCountry('Do you have the right to work in the UK?')).toBe('GB');
    expect(detectCountry('Are you authorised to work?')).toBeNull();
  });

  // Real phrasings from application forms. The pronoun "us" is not a country.
  const PHRASINGS: Array<[string, string | null]> = [
    ['Let us know if you are authorised to work in India', 'IN'],
    ['Please tell us whether you have the right to work in the UK', 'GB'],
    ['Will you now or in the future require sponsorship to work for us in Canada?', 'CA'],
    ['Are you legally authorized to work in the U.S.?', 'US'],
    ['Are you legally authorized to work in the US?', 'US'],
    ['Are you legally eligible to work in the USA?', 'US'],
    ['Are you a U.S. citizen or permanent resident?', 'US'],
    ['Are you an American citizen?', 'US'],
    ['Are you authorized to work in the United States of America?', 'US'],
    ['Do you have the right to work in the United Kingdom?', 'GB'],
    ['Do you have the right to work in Great Britain?', 'GB'],
    ['Do you have the right to work in the U.K.?', 'GB'],
    ['Are you eligible to work in England without sponsorship?', 'GB'],
    ['Are you an Indian citizen?', 'IN'],
    ['Are you a Canadian citizen or permanent resident?', 'CA'],
    ['Do you hold full working rights in Australia?', 'AU'],
    ['Are you an Australian citizen or permanent resident?', 'AU'],
    ['Do you have unrestricted work rights in New Zealand?', 'NZ'],
    ['Do you have a valid work permit for Germany?', 'DE'],
    ['Are you allowed to work in Ireland (Stamp 4 or EU citizen)?', 'IE'],
    ['Do you require a visa to work in the Netherlands?', 'NL'],
    ['Are you a Singapore Citizen or PR?', 'SG'],
    ['Are you eligible to work in the UAE?', 'AE'],
    ['Do you have the right to work in the United Arab Emirates?', 'AE'],
    ['Are you authorised to work in France?', 'FR'],
    ['Do you need sponsorship to work in Japan?', 'JP'],
    ['Can you legally work in Switzerland?', 'CH'],
    ['Are you legally allowed to work in Poland?', 'PL'],
    ['Do you have the right to work in Sweden?', 'SE'],
    ['Would you need a visa to work in Spain?', 'ES'],
    ['Do you have work authorization for Brazil?', 'BR'],
    ['Are you legally authorized to work in Mexico?', 'MX'],
    ['Are you legally authorized to work in New Mexico?', 'US'],
    ['Are you authorized to work in Indiana?', null],
    ['Are you authorised to work?', null],
    ['Please let us know about your work authorization.', null],
    ['Do you require visa sponsorship to join us?', null],
    ['ARE YOU AUTHORIZED TO WORK FOR US?', null],
    ['LET US KNOW Right to work', null],
    ['PLEASE TELL US: Are you authorized to work in India?', 'IN'],
    ['Have you worked in Latin America or South America before?', null],
  ];

  it.each(PHRASINGS)('reads %j as %s', (text, expected) => {
    expect(detectCountry(text)).toBe(expected);
  });

  it('returns every country a question names', () => {
    expect(detectCountries('Are you authorized to work in the United States or Canada?')).toEqual([
      'US',
      'CA',
    ]);
    expect(detectCountries('Are you eligible to work in the UK, Ireland or the EU?')).toEqual([
      'GB',
      'IE',
    ]);
    expect(detectCountry('Are you authorized to work in the United States or Canada?')).toBeNull();
    expect(detectCountries('Are you authorised to work?')).toEqual([]);
  });

  it('declines a question that names two countries and says which', () => {
    document.body.innerHTML = `
      <label for="a">Are you authorized to work in the United States or Canada?</label>
      <input id="a">
    `;
    const profile = testProfile();
    profile.sensitive.workAuthorization.authorizedIn = { US: 'yes', CA: 'no' };

    const { plan } = scanOf(profile);
    const entry = plan.entries[0]!;
    expect(entry.status).toBe('needs-consent');
    expect(entry.newValue).toBe('');
    expect(entry.rationale).toContain('the United States and Canada');
  });

  it('does not read "let us know" as the United States', () => {
    document.body.innerHTML = `
      <p>Please tell us whether you have the right to work in the UK.</p>
      <label for="a">Right to work</label>
      <select id="a"><option value="">Select</option><option>Yes</option><option>No</option></select>
    `;
    const profile = testProfile();
    profile.sensitive.workAuthorization.authorizedIn = { US: 'yes' };

    const { plan } = scanOf(profile);
    const entry = plan.entries.find((e) => e.canonical === 'sensitive.workAuthorization');
    expect(entry?.newValue ?? '').toBe('');
  });

  it('does not assume the single saved country when the question names none', () => {
    document.body.innerHTML = `
      <label for="a">Are you authorised to work?</label>
      <input id="a">
    `;
    const profile = testProfile();
    profile.sensitive.workAuthorization.authorizedIn = { US: 'yes' };

    const { plan } = scanOf(profile);
    expect(plan.entries[0]?.status).toBe('needs-consent');
    expect(plan.entries[0]?.newValue).toBe('');
  });

  it('does not apply a US answer to a UK question', () => {
    document.body.innerHTML = `
      <label for="a">Are you legally authorized to work in the United Kingdom?</label>
      <input id="a">
    `;
    const profile = testProfile();
    profile.sensitive.workAuthorization.authorizedIn = { US: 'yes' };

    const { plan } = scanOf(profile);
    const entry = plan.entries[0]!;
    expect(entry.status).toBe('needs-consent');
    expect(entry.newValue).toBe('');
  });

  it('answers when the country matches', () => {
    document.body.innerHTML = `
      <label for="a">Are you legally authorized to work in the United States?</label>
      <input id="a">
    `;
    const profile = testProfile();
    profile.sensitive.workAuthorization.authorizedIn = { US: 'yes' };

    const { plan } = scanOf(profile);
    expect(plan.entries[0]?.newValue).toBe('Yes');
  });
});

describe('option matching', () => {
  const options = [
    { value: '', label: 'Select…' },
    { value: 'IN', label: 'India' },
    { value: 'US', label: 'United States' },
  ];

  it('matches an exact label', () => {
    expect(matchOption('India', options)?.option.value).toBe('IN');
  });

  it('matches yes and no across wordings', () => {
    const yesNo = [
      { value: '1', label: 'Yes' },
      { value: '0', label: 'No' },
    ];
    expect(matchOption('yes', yesNo)?.option.value).toBe('1');
    expect(matchOption('No', yesNo)?.option.value).toBe('0');
  });

  it('refuses an ambiguous partial match', () => {
    const degrees = [
      { value: 'ba', label: 'Bachelor of Arts' },
      { value: 'bs', label: 'Bachelor of Science' },
    ];
    // "Bachelor" fits both, so picking one would be a coin flip.
    expect(matchOption('Bachelor', degrees)).toBeNull();
  });

  it('returns nothing when no option fits', () => {
    expect(matchOption('Atlantis', options)).toBeNull();
  });
});

describe('date precision is never invented', () => {
  it('refuses to turn a bare year into a month', () => {
    expect(formatForDateInput('2026', 'month')).toBe('');
    expect(formatForDateInput('2026-05', 'month')).toBe('2026-05');
  });

  it('refuses to turn a month into a day', () => {
    expect(formatForDateInput('2026-05', 'date')).toBe('');
    expect(formatForDateInput('2026-05-14', 'date')).toBe('2026-05-14');
  });
});

describe('the fill plan', () => {
  it('marks confident matches ready and preselects only those', () => {
    document.body.innerHTML = `
      <label for="a">First Name</label><input id="a">
      <label for="b">Email</label><input id="b" type="email">
      <label for="c">Website</label><input id="c" type="url">
    `;
    const { plan } = scanOf(testProfile());
    const ready = plan.entries.filter((entry) => entry.status === 'ready');
    expect(ready.map((entry) => entry.newValue)).toContain('Aditi');
    expect(plan.entries.every((entry) => entry.selected === (entry.status === 'ready'))).toBe(true);
  });

  it('never overwrites an existing value by default', () => {
    document.body.innerHTML = '<label for="a">First Name</label><input id="a" value="Addie">';
    const { plan } = scanOf(testProfile());
    expect(plan.entries[0]?.status).toBe('skipped-existing');
    expect(plan.entries[0]?.selected).toBe(false);
  });

  it('offers to overwrite when the user has switched it on', () => {
    document.body.innerHTML = '<label for="a">First Name</label><input id="a" value="Addie">';
    const settings = {
      ...DEFAULT_SETTINGS,
      autofill: { ...DEFAULT_SETTINGS.autofill, allowOverwrite: true },
    };
    const { plan } = scanOf(testProfile(), settings);
    expect(plan.entries[0]?.status).toBe('ready');
    expect(plan.entries[0]?.currentValue).toBe('Addie');
  });

  it('demotes a weak match to review instead of filling it', () => {
    document.body.innerHTML = '<label for="a">Name</label><input id="a">';
    const { plan } = scanOf(testProfile());
    expect(plan.entries[0]?.status).toBe('review');
    expect(plan.entries[0]?.selected).toBe(false);
  });

  it('reports a field the profile cannot answer', () => {
    document.body.innerHTML = '<label for="a">LinkedIn Profile</label><input id="a">';
    const { plan } = scanOf(testProfile());
    expect(plan.entries[0]?.status).toBe('missing-value');
  });

  it('leaves an essay question to the user', () => {
    document.body.innerHTML = `
      <label for="a">Why do you want to work here?</label><textarea id="a"></textarea>
    `;
    const { plan } = scanOf(testProfile());
    expect(plan.entries[0]?.status).toBe('manual-required');
  });

  it('never fills a referee field with the candidate details', () => {
    document.body.innerHTML =
      '<label for="a">Referee Email Address</label><input id="a" type="email">';
    const { plan } = scanOf(testProfile());
    const entry = plan.entries[0];
    expect(entry?.newValue ?? '').toBe('');
  });

  it('always confirms a background-check consent, even with an answer saved', () => {
    document.body.innerHTML =
      '<label for="a">Do you consent to a background check?</label><input id="a">';
    const profile = testProfile();
    profile.sensitive.background.backgroundCheckConsent = 'yes';
    const { plan } = scanOf(profile);
    expect(plan.entries[0]?.status).toBe('needs-consent');
    expect(plan.entries[0]?.selected).toBe(false);
  });

  it('will not attach a resume file', () => {
    document.body.innerHTML = '<label for="a">Resume</label><input id="a" type="file">';
    const { plan } = scanOf(testProfile());
    expect(plan.entries[0]?.status).toBe('manual-required');
    expect(plan.entries[0]?.rationale).toMatch(/browsers do not allow/i);
  });
});

describe('writing values', () => {
  it('fills selected entries and leaves the rest alone', async () => {
    document.body.innerHTML = `
      <label for="a">First Name</label><input id="a">
      <label for="b">Email</label><input id="b" type="email">
    `;
    const { plan, elements } = scanOf(testProfile());
    const { outcomes } = await fillFields(plan.entries, { elements, highlight: false });

    expect(outcomes.every((outcome) => outcome.ok)).toBe(true);
    expect((document.getElementById('a') as HTMLInputElement).value).toBe('Aditi');
    expect((document.getElementById('b') as HTMLInputElement).value).toBe('aditi@example.com');
  });

  it('dispatches the events a framework needs to notice the change', async () => {
    document.body.innerHTML = '<label for="a">First Name</label><input id="a">';
    const input = document.getElementById('a') as HTMLInputElement;
    const seen: string[] = [];
    for (const type of ['input', 'change']) {
      input.addEventListener(type, () => seen.push(type));
    }

    const { plan, elements } = scanOf(testProfile());
    await fillFields(plan.entries, { elements, highlight: false });
    expect(seen).toEqual(['input', 'change']);
  });

  it('selects the right radio option', async () => {
    document.body.innerHTML = `
      <fieldset>
        <legend>Are you legally authorized to work in the United States?</legend>
        <label><input type="radio" name="auth" value="Yes"> Yes</label>
        <label><input type="radio" name="auth" value="No"> No</label>
      </fieldset>
    `;
    const profile = testProfile();
    profile.sensitive.workAuthorization.authorizedIn = { US: 'yes' };

    const { plan, elements } = scanOf(profile);
    const entries = plan.entries.map((entry) => ({ ...entry, selected: true }));
    await fillFields(entries, { elements, highlight: false });

    const yes = document.querySelector<HTMLInputElement>('input[value="Yes"]')!;
    expect(yes.checked).toBe(true);
  });

  it('restores every previous value on undo', async () => {
    document.body.innerHTML = `
      <label for="a">First Name</label><input id="a" value="Addie">
      <label for="b">Email</label><input id="b" type="email">
    `;
    const settings = {
      ...DEFAULT_SETTINGS,
      autofill: { ...DEFAULT_SETTINGS.autofill, allowOverwrite: true },
    };
    const { plan, elements } = scanOf(testProfile(), settings);
    const { undo } = await fillFields(plan.entries, { elements, highlight: false });

    expect((document.getElementById('a') as HTMLInputElement).value).toBe('Aditi');
    await undoFill(undo);
    expect((document.getElementById('a') as HTMLInputElement).value).toBe('Addie');
    expect((document.getElementById('b') as HTMLInputElement).value).toBe('');
  });

  it('never submits the form', async () => {
    document.body.innerHTML = `
      <form id="f">
        <label for="a">First Name</label><input id="a">
        <button type="submit">Apply</button>
      </form>
    `;
    let submitted = false;
    document.getElementById('f')!.addEventListener('submit', () => {
      submitted = true;
    });

    const { plan, elements } = scanOf(testProfile());
    await fillFields(plan.entries, { elements, highlight: false });
    expect(submitted).toBe(false);
  });
});

describe('remembered mappings', () => {
  it('reuses a mapping the user taught, at high confidence', () => {
    document.body.innerHTML = '<label for="a">Candidate ID</label><input id="a" name="cand_id">';
    const { fields } = harvestFields(document);
    const fingerprint = fingerprintOf(fields[0]!);

    const mappings = buildMappings(fields, testProfile(), DEFAULT_SETTINGS, [
      {
        id: 'm1',
        origin: 'https://jobs.example.com',
        fingerprint,
        label: 'Candidate ID',
        canonical: 'personal.email',
        createdAt: new Date().toISOString(),
        useCount: 3,
      },
    ]);

    expect(mappings[0]?.canonical).toBe('personal.email');
    expect(mappings[0]?.fromSavedRule).toBe(true);
    expect(mappings[0]?.proposedValue).toBe('aditi@example.com');
  });

  it('produces the same fingerprint across re-renders', () => {
    document.body.innerHTML = '<label for="x1">Candidate ID</label><input id="x1" name="cand">';
    const first = fingerprintOf(harvestFields(document).fields[0]!);
    // Same field, different generated id — the fingerprint must not change.
    document.body.innerHTML = '<label for="x2">Candidate ID</label><input id="x2" name="cand">';
    const second = fingerprintOf(harvestFields(document).fields[0]!);
    expect(first).toBe(second);
  });
});
