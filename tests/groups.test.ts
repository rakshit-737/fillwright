import { beforeEach, describe, expect, it } from 'vitest';
import { harvestFields } from '@/field-detection/harvest';
import { buildMappings, buildFillPlan } from '@/autofill/plan';
import { indexFromHeading, indexFromIdentifier } from '@/field-detection/groups';
import { createEmptyProfile, newId, provenance, tv } from '@/profile/factory';
import { DEFAULT_SETTINGS } from '@/types/settings';
import type { EducationEntry, ExperienceEntry, Profile } from '@/types/profile';

function education(institution: string, degree: string, graduationDate: string): EducationEntry {
  return {
    id: newId('edu'),
    institution,
    degree,
    major: 'Computer Science',
    minor: '',
    location: '',
    startDate: '',
    endDate: graduationDate,
    graduationDate,
    gpa: '',
    gpaScale: '',
    honors: '',
    coursework: [],
    current: false,
    provenance: provenance('user', 1),
  };
}

function role(company: string, title: string, current = false): ExperienceEntry {
  return {
    id: newId('exp'),
    company,
    title,
    employmentType: '',
    location: '',
    locationType: '',
    startDate: '2023-01',
    endDate: current ? '' : '2024-01',
    current,
    description: '',
    highlights: [],
    technologies: [],
    provenance: provenance('user', 1),
  };
}

function profileWithHistory(): Profile {
  const profile = createEmptyProfile('Multi');
  profile.personal.firstName = tv('Aditi', 'user', 1);
  profile.education = [
    education('Vellore Institute of Technology', 'B.Tech', '2026-05'),
    education('Delhi Public School', 'High School Diploma', '2022-05'),
  ];
  profile.experience = [role('Zeta Payments', 'Software Engineering Intern', true), role('Acme Labs', 'Research Intern')];
  return profile;
}

function planFor(profile: Profile) {
  const { fields } = harvestFields(document);
  const mappings = buildMappings(fields, profile, DEFAULT_SETTINGS);
  return buildFillPlan(
    { url: '', pageKey: '', adapterId: null, scannedAt: '', fields, mappings },
    'scan',
    { education: profile.education.length, experience: profile.experience.length },
  );
}

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('reading a repeat index out of a field identifier', () => {
  it('understands the shapes servers actually emit', () => {
    expect(indexFromIdentifier('education[1].school')).toBe(1);
    expect(indexFromIdentifier('jobs.2.title')).toBe(2);
    expect(indexFromIdentifier('school_2')).toBe(1);
    expect(indexFromIdentifier('degree-3')).toBe(2);
  });

  it('does not mistake part of a field name for an index', () => {
    expect(indexFromIdentifier('address_line_1')).toBeNull();
    expect(indexFromIdentifier('phone2')).toBeNull();
    expect(indexFromIdentifier('first_name')).toBeNull();
  });

  it('reads a numbered heading', () => {
    expect(indexFromHeading('Education #2')).toBe(1);
    expect(indexFromHeading('Work Experience 3')).toBe(2);
    expect(indexFromHeading('Education')).toBeNull();
  });
});

describe('repeated education blocks map to different profile entries', () => {
  it('uses the index in the field name', () => {
    document.body.innerHTML = `
      <form>
        <label for="s0">University</label><input id="s0" name="education[0].school" />
        <label for="d0">Degree</label><input id="d0" name="education[0].degree" />
        <label for="s1">University</label><input id="s1" name="education[1].school" />
        <label for="d1">Degree</label><input id="d1" name="education[1].degree" />
      </form>
    `;
    const profile = profileWithHistory();
    const plan = planFor(profile);
    const values = plan.entries.map((entry) => entry.newValue);

    expect(values).toContain('Vellore Institute of Technology');
    expect(values).toContain('Delhi Public School');
    // The whole point: the second block must not repeat the first.
    expect(values.filter((value) => value === 'Vellore Institute of Technology')).toHaveLength(1);
  });

  it('uses a numbered section heading', () => {
    document.body.innerHTML = `
      <section><h3>Education #1</h3>
        <label for="a">University</label><input id="a" name="school_a" />
      </section>
      <section><h3>Education #2</h3>
        <label for="b">University</label><input id="b" name="school_b" />
      </section>
    `;
    const plan = planFor(profileWithHistory());
    const values = plan.entries.map((entry) => entry.newValue);
    expect(values).toContain('Vellore Institute of Technology');
    expect(values).toContain('Delhi Public School');
  });

  it('uses structural repetition when nothing is numbered', () => {
    document.body.innerHTML = `
      <div class="edu-list">
        <div class="edu-row">
          <label for="x1">University</label><input id="x1" />
          <label for="y1">Degree</label><input id="y1" />
        </div>
        <div class="edu-row">
          <label for="x2">University</label><input id="x2" />
          <label for="y2">Degree</label><input id="y2" />
        </div>
      </div>
    `;
    const plan = planFor(profileWithHistory());
    const values = plan.entries.map((entry) => entry.newValue);
    expect(values).toContain('Vellore Institute of Technology');
    expect(values).toContain('Delhi Public School');
  });

  it('does not invent an entry when the form has more blocks than the profile', () => {
    document.body.innerHTML = `
      <form>
        <label for="s0">University</label><input id="s0" name="education[0].school" />
        <label for="s1">University</label><input id="s1" name="education[1].school" />
        <label for="s2">University</label><input id="s2" name="education[2].school" />
      </form>
    `;
    const profile = profileWithHistory(); // two entries
    const plan = planFor(profile);

    const filled = plan.entries.filter((entry) => entry.newValue !== '');
    expect(filled).toHaveLength(2);
    // And it explains itself rather than silently leaving a blank.
    expect(
      plan.entries.some((entry) => /profile has 2 education entries/.test(entry.rationale)),
    ).toBe(true);
  });
});

describe('repeated experience blocks', () => {
  it('maps each block to its own role, current role first', () => {
    document.body.innerHTML = `
      <form>
        <label for="c0">Company</label><input id="c0" name="experience[0].company" />
        <label for="t0">Job Title</label><input id="t0" name="experience[0].title" />
        <label for="c1">Company</label><input id="c1" name="experience[1].company" />
        <label for="t1">Job Title</label><input id="t1" name="experience[1].title" />
      </form>
    `;
    const plan = planFor(profileWithHistory());
    const values = plan.entries.map((entry) => entry.newValue);

    expect(values).toContain('Zeta Payments');
    expect(values).toContain('Acme Labs');
    expect(values.filter((value) => value === 'Zeta Payments')).toHaveLength(1);
  });
});

describe('the plan reports how the form compares to the profile', () => {
  it('counts blocks on the form and entries in the profile', () => {
    document.body.innerHTML = `
      <form>
        <label for="s0">University</label><input id="s0" name="education[0].school" />
        <label for="s1">University</label><input id="s1" name="education[1].school" />
      </form>
    `;
    const plan = planFor(profileWithHistory());
    expect(plan.blocks.education).toBe(2);
    expect(plan.available.education).toBe(2);
  });

  it('shows when a form has fewer blocks than the profile has entries', () => {
    document.body.innerHTML = `
      <form><label for="s0">University</label><input id="s0" name="school" /></form>
    `;
    const plan = planFor(profileWithHistory());
    expect(plan.blocks.education).toBe(1);
    expect(plan.available.education).toBe(2);
  });
});

describe('non-repeating fields are unaffected', () => {
  it('keeps a single-entry form behaving exactly as before', () => {
    document.body.innerHTML = `
      <form>
        <label for="f">First Name</label><input id="f" name="first_name" />
        <label for="s">University</label><input id="s" name="school" />
      </form>
    `;
    const plan = planFor(profileWithHistory());
    const values = plan.entries.map((entry) => entry.newValue);
    expect(values).toContain('Aditi');
    expect(values).toContain('Vellore Institute of Technology');
  });
});
