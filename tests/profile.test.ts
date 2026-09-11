import { describe, expect, it } from 'vitest';
import { createEmptyProfile, newId, tv } from '@/profile/factory';
import { computeCompleteness } from '@/profile/completeness';

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
