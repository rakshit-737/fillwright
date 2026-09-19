import { describe, expect, it } from 'vitest';
import { resolveForField, resolveValue } from '@/autofill/resolve';
import { createEmptyProfile } from '@/profile/factory';
import { isSensitiveField } from '@/security/sensitive';
import type { DetectedField } from '@/types/fields';

function field(label: string, kind: DetectedField['kind'] = 'text'): DetectedField {
  return {
    id: 'f1',
    kind,
    signals: {
      labelText: label,
      ariaLabel: '',
      ariaDescription: '',
      placeholder: '',
      name: '',
      id: '',
      autocomplete: '',
      inputType: kind,
      title: '',
      sectionHeading: '',
      precedingText: '',
      optionLabels: [],
      required: false,
      maxLength: null,
    },
    options: [],
    currentValue: '',
    hasExistingValue: false,
    visible: true,
    disabled: false,
    readOnly: false,
    order: 0,
    selectorHint: '',
    groupSignature: null,
    groupOrdinal: null,
  };
}

function withPay(current: string, expected = '2000000', share = true) {
  const profile = createEmptyProfile('Test');
  profile.sensitive.compensation.currentSalary = current;
  profile.sensitive.compensation.expectedSalary = expected;
  profile.sensitive.compensation.shareCompensation = share;
  return profile;
}

describe('current salary', () => {
  it('is a sensitive field', () => {
    expect(isSensitiveField('sensitive.currentSalary')).toBe(true);
  });

  it('is withheld unless the master switch is on, like the expected figure', () => {
    const profile = withPay('1200000', '2000000', false);
    const off = resolveValue('sensitive.currentSalary', profile);
    expect(off.value).toBe('');
    expect(off.needsConsent).toBe(true);
    profile.sensitive.compensation.shareCompensation = true;
    expect(resolveValue('sensitive.currentSalary', profile).value).toBe('1200000');
  });

  it('answers current with current and expected with expected', () => {
    const profile = withPay('1200000', '1800000');
    expect(resolveForField('sensitive.currentSalary', field('Current CTC'), profile).value).toBe(
      '1200000',
    );
    expect(resolveForField('preferences.desiredSalary', field('Expected CTC'), profile).value).toBe(
      '1800000',
    );
  });

  it('strips currency symbols and separators for a number input', () => {
    expect(
      resolveForField(
        'sensitive.currentSalary',
        field('Current CTC', 'number'),
        withPay('₹ 12,00,000'),
      ).value,
    ).toBe('1200000');
    expect(
      resolveForField(
        'sensitive.currentSalary',
        field('Current salary', 'number'),
        withPay('$85,000.50'),
      ).value,
    ).toBe('85000.50');
  });

  it('declines a number input when the stored value is not one number', () => {
    const result = resolveForField(
      'sensitive.currentSalary',
      field('Current CTC', 'number'),
      withPay('10-12 lakh'),
    );
    expect(result.value).toBe('');
    expect(result.note).not.toBe('');
  });

  it('never converts units: declines when the question unit does not match what is stored', () => {
    const lpa = resolveForField(
      'sensitive.currentSalary',
      field('Current CTC (in LPA)'),
      withPay('1200000'),
    );
    expect(lpa.value).toBe('');
    expect(lpa.note).toMatch(/lakh/i);

    const perMonth = resolveForField(
      'sensitive.currentSalary',
      field('Current monthly salary'),
      withPay('12 LPA'),
    );
    expect(perMonth.value).toBe('');
    expect(perMonth.note).toMatch(/month/i);

    const expected = resolveForField(
      'preferences.desiredSalary',
      field('Expected CTC (LPA)'),
      withPay('', '2000000'),
    );
    expect(expected.value).toBe('');
  });

  it('fills when the stored unit matches the question unit', () => {
    const profile = withPay('12 LPA');
    expect(
      resolveForField('sensitive.currentSalary', field('Current CTC (in LPA)', 'number'), profile)
        .value,
    ).toBe('12');
    expect(
      resolveForField('sensitive.currentSalary', field('Current CTC (in lakhs)'), profile).value,
    ).toBe('12 LPA');
    expect(
      resolveForField(
        'sensitive.currentSalary',
        field('Current monthly salary'),
        withPay('50000 per month'),
      ).value,
    ).toBe('50000 per month');
  });
});
