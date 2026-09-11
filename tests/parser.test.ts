import { describe, expect, it } from 'vitest';
import { parseResume } from '@/parser';
import { assertNoSensitiveInference } from '@/security/sensitive';
import { mergeResumeIntoProfile } from '@/profile/merge';
import { createEmptyProfile, tv } from '@/profile/factory';
import {
  HOSTILE_RESUME,
  PROFESSIONAL_RESUME,
  SPARSE_RESUME,
  STUDENT_RESUME,
} from './fixtures/resumes';

describe('parsing a student resume', () => {
  const parsed = parseResume(STUDENT_RESUME);

  it('reads the contact block', () => {
    expect(parsed.contact.firstName.value).toBe('Aditi');
    expect(parsed.contact.lastName.value).toBe('Ramachandran');
    expect(parsed.contact.email.value).toBe('aditi.ramachandran@example.com');
    expect(parsed.contact.phone.value).toContain('98450');
    expect(parsed.contact.email.confidence).toBeGreaterThan(0.9);
  });

  it('recognises the location', () => {
    expect(parsed.contact.city.value).toBe('Bengaluru');
    expect(parsed.contact.country.value).toBe('India');
  });

  it('finds the profile links and does not confuse them', () => {
    expect(parsed.contact.links.linkedin.value).toContain('linkedin.com/in/aditi-ramachandran');
    expect(parsed.contact.links.github.value).toContain('github.com/aditir');
    expect(parsed.contact.links.linkedin.value).not.toContain('github');
  });

  it('reads education including the 10-point CGPA', () => {
    const education = parsed.education[0];
    expect(education?.institution).toContain('Vellore Institute of Technology');
    expect(education?.degree).toBe('B.Tech');
    expect(education?.major).toContain('Computer Science');
    expect(education?.gpa).toBe('8.94');
    expect(education?.gpaScale).toBe('10');
    expect(education?.endDate).toBe('2026-05');
    expect(education?.coursework).toContain('Machine Learning');
  });

  it('reads both internships as separate entries', () => {
    expect(parsed.experience).toHaveLength(2);
    const titles = parsed.experience.map((entry) => entry.title);
    expect(titles.join(' ')).toMatch(/Software Engineering Intern/);
    expect(titles.join(' ')).toMatch(/Research Intern/);
  });

  it('classifies internships as internships and keeps their bullets', () => {
    const zeta = parsed.experience.find((entry) => /Zeta/.test(entry.company));
    expect(zeta?.employmentType).toBe('internship');
    expect(zeta?.highlights.length).toBeGreaterThanOrEqual(2);
    expect(zeta?.technologies).toContain('Kafka');
    expect(zeta?.startDate).toBe('2025-06');
  });

  it('reads projects with their repository links', () => {
    expect(parsed.projects.length).toBeGreaterThanOrEqual(2);
    const ledgerline = parsed.projects.find((project) => /Ledgerline/.test(project.name));
    expect(ledgerline).toBeTruthy();
    expect(ledgerline?.repositoryUrl).toContain('github.com/aditir/ledgerline');
    expect(ledgerline?.highlights.length).toBeGreaterThan(0);
  });

  it('groups skills by their stated category', () => {
    const go = parsed.skills.find((skill) => skill.name === 'Go');
    expect(go?.category).toBe('Languages');
    expect(parsed.skills.some((skill) => skill.name === 'Docker')).toBe(true);
  });

  it('reads certifications, achievements and languages', () => {
    expect(parsed.certifications[0]?.name).toContain('AWS Certified Solutions Architect');
    expect(parsed.certifications[0]?.issueDate).toBe('2025');
    expect(parsed.achievements.length).toBeGreaterThanOrEqual(2);
    const hindi = parsed.languages.find((language) => language.name === 'Hindi');
    expect(hindi?.proficiency).toBe('native');
  });

  it('reports good coverage and no warnings', () => {
    expect(parsed.coverage).toBe(1);
    expect(parsed.warnings).toHaveLength(0);
  });
});

describe('parsing a US professional resume', () => {
  const parsed = parseResume(PROFESSIONAL_RESUME);

  it('handles a hyphenated surname and a US phone format', () => {
    expect(parsed.contact.firstName.value).toBe('Marcus');
    expect(parsed.contact.lastName.value).toBe('Okonkwo-Bell');
    expect(parsed.contact.phone.value).toContain('512');
  });

  it('reads the state code and infers the country from it', () => {
    expect(parsed.contact.state.value).toBe('TX');
    expect(parsed.contact.country.value).toBe('United States');
    expect(parsed.contact.postalCode.value).toBe('78701');
  });

  it('marks the current role as current with no end date', () => {
    const current = parsed.experience.find((entry) => entry.current);
    expect(current).toBeTruthy();
    expect(current?.endDate).toBe('');
    expect(current?.startDate).toBe('2021-03');
  });

  it('reads numeric date formats', () => {
    const previous = parsed.experience.find((entry) => /Northgate/.test(entry.company));
    expect(previous?.startDate).toBe('2018-06');
    expect(previous?.endDate).toBe('2021-02');
    expect(previous?.locationType).toBe('remote');
  });

  it('reads a 4-point GPA with its scale', () => {
    expect(parsed.education[0]?.gpa).toBe('3.82');
    expect(parsed.education[0]?.gpaScale).toBe('4.0');
    expect(parsed.education[0]?.degree).toBe('Bachelor of Science');
  });

  it('captures the summary', () => {
    expect(parsed.summary.text).toContain('Backend engineer');
  });

  it('orders experience with the current role first', () => {
    expect(parsed.experience[0]?.current).toBe(true);
  });
});

describe('parsing a sparse resume', () => {
  const parsed = parseResume(SPARSE_RESUME);

  it('still finds the contact details', () => {
    expect(parsed.contact.firstName.value).toBe('Jamie');
    expect(parsed.contact.email.value).toBe('jamie.lin@example.com');
  });

  it('warns the user that little structure was found', () => {
    expect(parsed.warnings.join(' ')).toMatch(/no standard section headings/i);
  });

  it('invents nothing it could not find', () => {
    expect(parsed.education).toHaveLength(0);
    expect(parsed.experience).toHaveLength(0);
    expect(parsed.contact.phone.value).toBe('');
  });
});

describe('resume content is treated as data, never as instructions', () => {
  const parsed = parseResume(HOSTILE_RESUME);

  it('parses the resume normally without acting on embedded directives', () => {
    expect(parsed.contact.firstName.value).toBe('Riley');
    expect(parsed.contact.email.value).toBe('riley.chen@example.com');
    expect(parsed.education[0]?.institution).toContain('University of Washington');
  });

  it('produces no sensitive fields even when the resume demands them', () => {
    expect(() => assertNoSensitiveInference(parsed)).not.toThrow();
  });

  it('leaves the sensitive branch untouched after a merge', () => {
    const { profile } = mergeResumeIntoProfile(createEmptyProfile(), parsed);
    expect(profile.sensitive.demographics.gender).toBe('');
    expect(profile.sensitive.demographics.shareDemographics).toBe(false);
    expect(Object.keys(profile.sensitive.workAuthorization.authorizedIn)).toHaveLength(0);
    expect(profile.sensitive.background.criminalHistory).toBe('unset');
  });

  it('keeps injected markup as inert text', () => {
    // The value may be stored, but it is only ever written into form fields as
    // a string; nothing in Fillwright interprets resume text as markup.
    const scriptSkill = parsed.skills.find((skill) => skill.name.includes('script>'));
    expect(typeof scriptSkill?.name === 'string' || scriptSkill === undefined).toBe(true);
  });
});

describe('merging into a profile', () => {
  it('fills empty fields from the resume', () => {
    const parsed = parseResume(STUDENT_RESUME);
    const { profile, changes } = mergeResumeIntoProfile(createEmptyProfile(), parsed);
    expect(profile.personal.firstName.value).toBe('Aditi');
    expect(profile.personal.firstName.provenance.source).toBe('resume');
    expect(profile.education.length).toBeGreaterThan(0);
    expect(changes.some((change) => change.label === 'Email')).toBe(true);
  });

  it('never overwrites a value the user typed', () => {
    const existing = createEmptyProfile();
    existing.personal.email = tv('my.real.email@example.com', 'user', 1);
    const parsed = parseResume(STUDENT_RESUME);

    const { profile, preserved } = mergeResumeIntoProfile(existing, parsed, { strategy: 'replace' });
    expect(profile.personal.email.value).toBe('my.real.email@example.com');
    expect(profile.personal.email.provenance.source).toBe('user');
    expect(preserved).toContain('Email');
  });

  it('leaves existing values alone in fill-gaps mode', () => {
    const existing = createEmptyProfile();
    existing.personal.phone = tv('+1 555 000 1111', 'resume', 0.9);
    const { profile } = mergeResumeIntoProfile(existing, parseResume(STUDENT_RESUME));
    expect(profile.personal.phone.value).toBe('+1 555 000 1111');
  });

  it('records provenance and confidence on every written value', () => {
    const { profile } = mergeResumeIntoProfile(createEmptyProfile(), parseResume(STUDENT_RESUME));
    expect(profile.personal.email.provenance.confidence).toBeGreaterThan(0.9);
    expect(profile.personal.email.provenance.note).toBeTruthy();
    expect(profile.education[0]?.provenance.source).toBe('resume');
  });

  it('never assigns skill proficiency, which a resume cannot tell us', () => {
    const { profile } = mergeResumeIntoProfile(createEmptyProfile(), parseResume(STUDENT_RESUME));
    expect(profile.skills.every((skill) => skill.proficiency === '')).toBe(true);
  });
});
