import { beforeEach, describe, expect, it } from 'vitest';
import { harvestFields } from '@/field-detection/harvest';
import { buildMappings, buildFillPlan, fingerprintOf } from '@/autofill/plan';
import {
  answerChoices,
  customKeyFor,
  isValidCustomKey,
  rankSavedAnswers,
  resolveCustom,
  savedAnswerText,
} from '@/autofill/saved-answers';
import { createEmptyProfile, provenance } from '@/profile/factory';
import { DEFAULT_SETTINGS } from '@/types/settings';
import type { Profile } from '@/types/profile';
import type { SavedMapping, ScanResult } from '@/types/fields';

/**
 * Saved answers (Preferences) and custom fields (Profile) are things the user
 * wrote by hand. They reach a form only in two ways: a mapping the user taught
 * ("One of your custom fields…"), or an explicit "Use a saved answer" pick.
 */
function profile(): Profile {
  const p = createEmptyProfile('Test');
  p.custom = [
    {
      id: 'cf-1',
      key: 'custom1',
      label: 'Employee ID',
      value: 'EMP-4471',
      provenance: provenance('user', 1),
    },
    {
      id: 'cf-2',
      key: 'custom2',
      label: 'Shirt size',
      value: 'M',
      provenance: provenance('user', 1),
    },
  ];
  p.preferences.savedAnswers = [
    {
      id: 'sa-1',
      key: 'answer-1',
      label: 'Greatest strength',
      text: 'I finish what I start.',
      updatedAt: '',
    },
    {
      id: 'sa-2',
      key: 'answer-2',
      label: 'Why do you want to work here',
      text: 'Because payments matter.',
      updatedAt: '',
    },
    { id: 'sa-3', key: 'answer-3', label: 'Empty one', text: '   ', updatedAt: '' },
  ];
  return p;
}

function mapping(fingerprint: string, customKey: string): SavedMapping {
  return {
    id: 'm1',
    origin: 'https://jobs.example.com',
    fingerprint,
    label: 'x',
    canonical: 'custom',
    customKey,
    createdAt: '',
    useCount: 0,
  };
}

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('custom keys', () => {
  it('round-trips and rejects anything else', () => {
    expect(customKeyFor('field', 'cf-1')).toBe('field:cf-1');
    expect(isValidCustomKey('field:cf-1')).toBe(true);
    expect(isValidCustomKey('answer:sa-2')).toBe(true);
    expect(isValidCustomKey('profile:email')).toBe(false);
    expect(isValidCustomKey('field:<img>')).toBe(false);
    expect(isValidCustomKey('')).toBe(false);
  });

  it('resolves a custom field or saved answer, and nothing for a stale key', () => {
    const p = profile();
    expect(resolveCustom(p, 'field:cf-1').value).toBe('EMP-4471');
    expect(resolveCustom(p, 'answer:sa-2').value).toBe('Because payments matter.');
    expect(resolveCustom(p, 'field:gone').value).toBe('');
    expect(resolveCustom(p, 'answer:sa-3').value).toBe('');
    expect(resolveCustom(p, undefined).value).toBe('');
  });
});

describe('a taught custom mapping is used', () => {
  it('fills the custom field value it points to', () => {
    document.body.innerHTML = '<label for="a">Badge reference</label><input id="a" name="zz_b">';
    const { fields } = harvestFields(document);
    const mappings = buildMappings(fields, profile(), DEFAULT_SETTINGS, [
      mapping(fingerprintOf(fields[0]!), 'field:cf-1'),
    ]);
    expect(mappings[0]?.canonical).toBe('custom');
    expect(mappings[0]?.proposedValue).toBe('EMP-4471');
    expect(mappings[0]?.status).toBe('ready');
  });

  it('fills a saved answer into a written question the user mapped', () => {
    document.body.innerHTML =
      '<label for="q">Why do you want to work here?</label><textarea id="q" name="q"></textarea>';
    const { fields } = harvestFields(document);
    const mappings = buildMappings(fields, profile(), DEFAULT_SETTINGS, [
      mapping(fingerprintOf(fields[0]!), 'answer:sa-2'),
    ]);
    expect(mappings[0]?.proposedValue).toBe('Because payments matter.');
  });

  it('reports a missing value when the custom field was deleted', () => {
    document.body.innerHTML = '<label for="a">Badge reference</label><input id="a" name="zz_b">';
    const { fields } = harvestFields(document);
    const mappings = buildMappings(fields, profile(), DEFAULT_SETTINGS, [
      mapping(fingerprintOf(fields[0]!), 'field:nope'),
    ]);
    expect(mappings[0]?.status).toBe('missing-value');
    expect(mappings[0]?.proposedValue).toBe('');
  });

  it('never fills an essay row by itself: a saved answer is only offered', () => {
    document.body.innerHTML =
      '<label for="q">Why do you want to work here?</label><textarea id="q" name="q"></textarea>';
    const { fields } = harvestFields(document);
    const mappings = buildMappings(fields, profile(), DEFAULT_SETTINGS);
    const scan: ScanResult = {
      url: '',
      pageKey: '',
      adapterId: null,
      scannedAt: '',
      fields,
      mappings,
    };
    const entry = buildFillPlan(scan, 's').entries[0]!;
    expect(entry.status).toBe('manual-required');
    expect(entry.newValue).toBe('');
    expect(entry.selected).toBe(false);
  });
});

describe('what the content script may see', () => {
  it('lists titles only, never values or answer text', () => {
    const choices = answerChoices(profile(), '');
    const flat = JSON.stringify(choices);
    expect(flat).not.toContain('EMP-4471');
    expect(flat).not.toContain('payments matter');
    expect(flat).not.toContain('finish what I start');
    expect(choices.custom.map((c) => c.label)).toEqual(['Employee ID', 'Shirt size']);
    // An empty saved answer is not offered.
    expect(choices.answers.map((c) => c.id)).toEqual(['sa-1', 'sa-2']);
    for (const item of [...choices.custom, ...choices.answers]) {
      expect(Object.keys(item).sort()).toEqual(['id', 'label']);
    }
  });

  it('ranks saved answers by overlap with the question, without dropping any', () => {
    const ranked = answerChoices(profile(), 'Why do you want to work at Acme?').answers;
    expect(ranked.map((c) => c.id)).toEqual(['sa-2', 'sa-1']);
    const other = answerChoices(profile(), 'What is your greatest strength?').answers;
    expect(other[0]?.id).toBe('sa-1');
  });

  it('ranking is stable when nothing overlaps', () => {
    const answers = profile().preferences.savedAnswers;
    expect(rankSavedAnswers('Favourite colour', answers).map((a) => a.id)).toEqual([
      'sa-1',
      'sa-2',
      'sa-3',
    ]);
  });

  it('hands over the text of one answer, by id, only when it exists', () => {
    const p = profile();
    expect(savedAnswerText(p, 'sa-1')).toBe('I finish what I start.');
    expect(savedAnswerText(p, 'missing')).toBeNull();
    expect(savedAnswerText(p, 'sa-3')).toBeNull();
  });
});
