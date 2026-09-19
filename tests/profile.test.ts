import { describe, expect, it } from 'vitest';
import { createEmptyProfile, newId, provenance, tv } from '@/profile/factory';
import { computeCompleteness } from '@/profile/completeness';
import { mergeResumeIntoProfile, sameName, sameStart } from '@/profile/merge';
import { parseResume, type ParsedResume } from '@/parser';
import type { ExperienceEntry, Profile } from '@/types/profile';

describe('profile factory', () => {
  it('creates a profile with no personal data in it', () => {
    const profile = createEmptyProfile('Test');
    expect(profile.personal.firstName.value).toBe('');
    expect(profile.personal.email.value).toBe('');
    expect(profile.education).toEqual([]);
    expect(profile.resumeIds).toEqual([]);
  });

  it('leaves every sensitive answer unset', () => {
    const { sensitive } = createEmptyProfile();
    expect(sensitive.demographics.shareDemographics).toBe(false);
    expect(sensitive.compensation.shareCompensation).toBe(false);
    expect(sensitive.background.criminalHistory).toBe('unset');
    expect(sensitive.relocation.willingToRelocate).toBe('unset');
    expect(Object.keys(sensitive.workAuthorization.authorizedIn)).toHaveLength(0);
  });

  it('generates unique ids', () => {
    const ids = new Set(Array.from({ length: 500 }, () => newId('x')));
    expect(ids.size).toBe(500);
  });

  it('records provenance on tracked values', () => {
    const value = tv('ada@example.com', 'resume', 0.9, 'matched email pattern');
    expect(value.provenance.source).toBe('resume');
    expect(value.provenance.confidence).toBe(0.9);
    expect(value.provenance.note).toBe('matched email pattern');
    expect(Date.parse(value.provenance.updatedAt)).not.toBeNaN();
  });
});

describe('completeness', () => {
  it('scores an empty profile at zero', () => {
    expect(computeCompleteness(createEmptyProfile()).percent).toBe(0);
  });

  it('reports the gaps that matter most first', () => {
    const profile = createEmptyProfile();
    profile.personal.firstName = tv('Ada', 'user', 1);
    profile.personal.lastName = tv('Lovelace', 'user', 1);
    const result = computeCompleteness(profile);
    expect(result.percent).toBeGreaterThan(0);
    expect(result.percent).toBeLessThan(100);
    expect(result.topGaps).toContain('Email');
  });

  it('never counts work authorization until the user answers it', () => {
    const profile = createEmptyProfile();
    const before = computeCompleteness(profile);
    profile.sensitive.workAuthorization.authorizedIn = { US: 'yes' };
    const after = computeCompleteness(profile);
    expect(after.percent).toBeGreaterThan(before.percent);
  });
});

type ParsedRole = ParsedResume['experience'][number];

function role(
  company: string,
  title: string,
  startDate: string,
  extra: Partial<ParsedRole> = {},
): ParsedRole {
  return {
    company,
    title,
    employmentType: '',
    location: '',
    locationType: '',
    startDate,
    endDate: '',
    current: false,
    description: '',
    highlights: [],
    technologies: [],
    confidence: 0.8,
    note: 'test',
    ...extra,
  } as ParsedRole;
}

function resume(experience: ParsedRole[], extra: Partial<ParsedResume> = {}): ParsedResume {
  const base = parseResume('Nothing here\n');
  return {
    ...base,
    education: [],
    experience,
    projects: [],
    skills: [],
    certifications: [],
    achievements: [],
    languages: [],
    ...extra,
  };
}

function existing(
  company: string,
  title: string,
  startDate: string,
  source: 'user' | 'resume',
  extra: Partial<ExperienceEntry> = {},
): ExperienceEntry {
  return {
    id: `exp_${company}`,
    company,
    title,
    employmentType: '',
    location: '',
    locationType: '',
    startDate,
    endDate: '',
    current: false,
    description: '',
    highlights: [],
    technologies: [],
    provenance: provenance(source, source === 'user' ? 1 : 0.8),
    ...extra,
  };
}

function profileWith(experience: ExperienceEntry[]): Profile {
  const profile = createEmptyProfile('Test');
  profile.experience = experience;
  return profile;
}

const STRATEGIES = ['fill-gaps', 'replace'] as const;

describe('list merge: strategy x user-edited x matched/unmatched', () => {
  for (const strategy of STRATEGIES) {
    describe(strategy, () => {
      it('never overwrites a matched entry the user edited', () => {
        const mine = existing('Acme', 'Engineer', '2022-01', 'user', {
          description: 'My own words',
          location: 'Pune',
        });
        const parsed = resume([
          role('Acme Inc.', 'Engineer', 'Jan 2022', {
            description: 'Resume words',
            location: 'Mumbai',
          }),
        ]);
        const { profile, entries } = mergeResumeIntoProfile(profileWith([mine]), parsed, {
          strategy,
        });
        expect(profile.experience).toHaveLength(1);
        expect(profile.experience[0]).toEqual(mine);
        expect(entries).toEqual([expect.objectContaining({ kind: 'kept', section: 'experience' })]);
      });

      it('never drops an unmatched entry the user edited', () => {
        const mine = existing('Side Gig', 'Founder', '2020-01', 'user');
        const parsed = resume([role('Acme', 'Engineer', '2022-01')]);
        const { profile } = mergeResumeIntoProfile(profileWith([mine]), parsed, { strategy });
        expect(profile.experience.map((e) => e.company)).toEqual(['Side Gig', 'Acme']);
        expect(profile.experience[0]).toEqual(mine);
      });

      it('adds an unmatched parsed entry', () => {
        const old = existing('Acme', 'Engineer', '2022-01', 'resume');
        const parsed = resume([
          role('Acme', 'Engineer', '2022-01'),
          role('Globex', 'Intern', '2024-05'),
        ]);
        const { profile, entries } = mergeResumeIntoProfile(profileWith([old]), parsed, {
          strategy,
        });
        expect(profile.experience.map((e) => e.company)).toEqual(['Acme', 'Globex']);
        expect(entries.filter((e) => e.kind === 'added').map((e) => e.label)).toEqual([
          'Intern at Globex',
        ]);
      });

      it('keeps the id of a matched resume-sourced entry and fills its empty fields', () => {
        const old = existing('Acme', 'Engineer', '2022-01', 'resume', { location: 'Pune' });
        const parsed = resume([
          role('ACME Ltd', 'Engineer', '01/2022', {
            location: 'Mumbai',
            description: 'Built things',
          }),
        ]);
        const { profile } = mergeResumeIntoProfile(profileWith([old]), parsed, { strategy });
        expect(profile.experience).toHaveLength(1);
        const [entry] = profile.experience;
        expect(entry!.id).toBe(old.id);
        expect(entry!.description).toBe('Built things');
        // Only 'replace' refreshes a value that was already there.
        expect(entry!.location).toBe(strategy === 'replace' ? 'Mumbai' : 'Pune');
      });

      it('keeps a resume-sourced entry the new resume no longer lists, and flags it', () => {
        const old = existing('Initech', 'Analyst', '2019-01', 'resume');
        const parsed = resume([role('Acme', 'Engineer', '2022-01')]);
        const { profile, entries } = mergeResumeIntoProfile(profileWith([old]), parsed, {
          strategy,
        });
        expect(profile.experience.map((e) => e.company)).toEqual(['Initech', 'Acme']);
        expect(entries).toContainEqual(
          expect.objectContaining({ kind: 'missing', label: 'Analyst at Initech' }),
        );
      });
    });
  }

  it('fill-gaps now adds a new role to a non-empty list', () => {
    const old = existing('Acme', 'Engineer', '2022-01', 'resume');
    const parsed = resume([
      role('Acme', 'Engineer', '2022-01'),
      role('Globex', 'Intern', '2024-05'),
    ]);
    const { profile } = mergeResumeIntoProfile(profileWith([old]), parsed);
    expect(profile.experience).toHaveLength(2);
  });

  it('replace clears current on a role the resume now shows as ended', () => {
    const old = existing('Acme', 'Engineer', '2022-01', 'resume', { current: true, endDate: '' });
    const parsed = resume([
      role('Acme', 'Engineer', '2022-01', { current: false, endDate: '2024-03' }),
    ]);
    const replaced = mergeResumeIntoProfile(profileWith([old]), parsed, { strategy: 'replace' });
    expect(replaced.profile.experience[0]).toMatchObject({ current: false, endDate: '2024-03' });
    const filled = mergeResumeIntoProfile(profileWith([old]), parsed, { strategy: 'fill-gaps' });
    expect(filled.profile.experience[0]).toMatchObject({ current: true, endDate: '2024-03' });
  });

  it('does not pair two roles at one company with different start dates', () => {
    const old = existing('Acme', 'Engineer', '2020-01', 'user');
    const parsed = resume([role('Acme', 'Engineer', '2023-06')]);
    const { profile } = mergeResumeIntoProfile(profileWith([old]), parsed, { strategy: 'replace' });
    expect(profile.experience).toHaveLength(2);
  });

  it('leaves unticked changes out', () => {
    const old = existing('Acme', 'Engineer', '2022-01', 'resume', { location: 'Pune' });
    const parsed = resume([
      role('Acme', 'Engineer', '2022-01', { location: 'Mumbai' }),
      role('Globex', 'Intern', '2024-05'),
    ]);
    const first = mergeResumeIntoProfile(profileWith([old]), parsed, { strategy: 'replace' });
    const skip = first.entries
      .filter((e) => e.kind === 'added' || e.kind === 'updated')
      .map((e) => e.id);
    expect(skip).toHaveLength(2);
    const second = mergeResumeIntoProfile(profileWith([old]), parsed, {
      strategy: 'replace',
      skip,
    });
    expect(second.profile.experience).toEqual([old]);
    expect(second.entries.map((e) => e.id)).toEqual(first.entries.map((e) => e.id));
  });

  it('merges skills, languages, education, projects and certifications by name', () => {
    const profile = createEmptyProfile('Test');
    profile.skills = [
      {
        id: 's1',
        name: 'TypeScript',
        category: '',
        proficiency: 'expert',
        yearsOfExperience: '4',
        provenance: provenance('user', 1),
      },
    ];
    profile.education = [
      {
        id: 'e1',
        institution: 'IIT Delhi',
        degree: 'B.Tech',
        major: 'CS',
        minor: '',
        location: '',
        startDate: '',
        endDate: '',
        graduationDate: '2024',
        gpa: '9.1',
        gpaScale: '10',
        honors: '',
        coursework: [],
        current: false,
        provenance: provenance('user', 1),
      },
    ];
    const parsed = resume([], {
      skills: [
        { name: 'typescript', category: 'Languages', confidence: 0.9 },
        { name: 'Rust', category: 'Languages', confidence: 0.9 },
      ] as ParsedResume['skills'],
      education: [
        {
          institution: 'Indian Institute of Technology',
          degree: 'BTech',
          major: '',
          minor: '',
          location: '',
          startDate: '',
          endDate: '',
          graduationDate: '',
          gpa: '',
          gpaScale: '',
          honors: '',
          coursework: [],
          current: false,
          confidence: 0.8,
          note: '',
        },
        {
          institution: 'IIT Delhi',
          degree: 'BTech',
          major: 'Computer Science',
          minor: '',
          location: '',
          startDate: '',
          endDate: '',
          graduationDate: '2024',
          gpa: '8.0',
          gpaScale: '10',
          honors: '',
          coursework: [],
          current: false,
          confidence: 0.8,
          note: '',
        },
      ] as ParsedResume['education'],
    });
    for (const strategy of STRATEGIES) {
      const out = mergeResumeIntoProfile(profile, parsed, { strategy }).profile;
      expect(out.skills.map((s) => s.name)).toEqual(['TypeScript', 'Rust']);
      expect(out.skills[0]).toEqual(profile.skills[0]);
      expect(out.education[0]).toEqual(profile.education[0]);
      expect(out.education).toHaveLength(2);
    }
  });
});

describe('matching helpers', () => {
  it('tolerates punctuation, case and company suffixes', () => {
    expect(sameName('Acme, Inc.', 'ACME')).toBe(true);
    expect(sameName('B.Tech', 'BTech')).toBe(true);
    expect(sameName('IIT Delhi', 'IIT Delhi, India')).toBe(true);
    expect(sameName('Google', 'Globex')).toBe(false);
    expect(sameName('AI', 'AI Lab')).toBe(false);
  });

  it('compares start dates by year and month', () => {
    expect(sameStart('2022-01', 'Jan 2022')).toBe(true);
    expect(sameStart('2022-01', '2022')).toBe(true);
    expect(sameStart('2022-01', '')).toBe(true);
    expect(sameStart('2022-01', 'Mar 2022')).toBe(false);
    expect(sameStart('2021', '2022')).toBe(false);
  });
});
