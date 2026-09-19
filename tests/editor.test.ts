import { describe, expect, it, beforeEach } from 'vitest';
import { moveItem } from '@/components/EntryList';
import { __test__ as settingsInternals, getSettings, setSettings } from '@/storage/settings';
import { DEFAULT_SETTINGS } from '@/types/settings';
import { createEmptyProfile, tv } from '@/profile/factory';
import { mergeResumeIntoProfile } from '@/profile/merge';
import { parseResume } from '@/parser';
import { resetStorage } from './setup';
import { STUDENT_RESUME } from './fixtures/resumes';

describe('moveItem', () => {
  it('moves an item up and down', () => {
    expect(moveItem(['a', 'b', 'c'], 1, -1)).toEqual(['b', 'a', 'c']);
    expect(moveItem(['a', 'b', 'c'], 1, 1)).toEqual(['a', 'c', 'b']);
  });

  it('refuses to move past either end', () => {
    expect(moveItem(['a', 'b'], 0, -1)).toEqual(['a', 'b']);
    expect(moveItem(['a', 'b'], 1, 1)).toEqual(['a', 'b']);
  });
});

describe('settings merge', () => {
  beforeEach(resetStorage);

  it('deep merges a patch without dropping sibling keys', () => {
    const merged = settingsInternals.merge(DEFAULT_SETTINGS, {
      autofill: { allowOverwrite: true },
    });
    expect(merged.autofill.allowOverwrite).toBe(true);
    // The sibling must survive — a shallow merge would wipe the whole branch.
    expect(merged.autofill.highlightFilledFields).toBe(true);
    expect(merged.privacy.keepApplicationHistory).toBe(false);
  });

  it('round-trips through storage and fills in new keys from defaults', async () => {
    await setSettings({ ui: { theme: 'dark' } });
    const settings = await getSettings();
    expect(settings.ui.theme).toBe('dark');
    expect(settings.autofill.confidenceThreshold).toBe(0.7);
    expect(settings.ai.enabled).toBe(false);
  });

  it('keeps the cautious defaults', () => {
    expect(DEFAULT_SETTINGS.autofill.allowOverwrite).toBe(false);
    expect(DEFAULT_SETTINGS.privacy.keepApplicationHistory).toBe(false);
    expect(DEFAULT_SETTINGS.ai.enabled).toBe(false);
  });
});

describe('editing protects a field permanently', () => {
  it('survives a later resume import, in either merge strategy', () => {
    const parsed = parseResume(STUDENT_RESUME);

    // First import populates the profile from the resume.
    const first = mergeResumeIntoProfile(createEmptyProfile(), parsed).profile;
    expect(first.personal.email.value).toBe('aditi.ramachandran@example.com');

    // The user corrects the phone number by hand, as the editor would.
    first.personal.phone = tv('+91 99999 00000', 'user', 1, 'entered by you');

    // A second import, even the aggressive one, must not undo that.
    const second = mergeResumeIntoProfile(first, parsed, { strategy: 'replace' }).profile;
    expect(second.personal.phone.value).toBe('+91 99999 00000');
    expect(second.personal.phone.provenance.source).toBe('user');
  });

  it('reports which fields it refused to overwrite', () => {
    const profile = createEmptyProfile();
    profile.personal.firstName = tv('Addie', 'user', 1);
    const { preserved } = mergeResumeIntoProfile(profile, parseResume(STUDENT_RESUME), {
      strategy: 'replace',
    });
    expect(preserved).toContain('First name');
  });
});
