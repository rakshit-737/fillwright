import { handle, ok, err } from '../router';
import { getProfile, listProfiles } from '@/storage/profiles';
import { getSettings, setSettings } from '@/storage/settings';
import { matchJobDescription } from '@/autofill/job-match';
import { getProvider } from '@/ai/provider';
import { sanitizeString } from '@/security/validate';
import type { ContentRequest } from '@/types/messages';
import type { Profile } from '@/types/profile';

/**
 * Trust boundary: service worker, answering content scripts (untrusted pages).
 *
 * Handlers behind the on-page panel's secondary features: the job-posting
 * match, the profile switcher and optional answer drafting.
 *
 * Each returns the least the panel needs. The profile switcher sees names, not
 * contents. The job match sees skill names that appear in the posting the user
 * is already reading. A draft sees only the facts the user ticked.
 */
export function registerAssistHandlers(): void {
  handle('content:job-match', async (request) => {
    const { text } = request as Extract<ContentRequest, { type: 'content:job-match' }>;
    const settings = await getSettings();
    if (!settings.activeProfileId) return ok(null);
    const profile = await getProfile(settings.activeProfileId);
    if (!profile) return ok(null);
    const match = matchJobDescription(
      sanitizeString(text, 40_000),
      profile.skills.map((skill) => skill.name),
    );
    // Only skills the posting itself names are returned, so nothing about the
    // profile is revealed beyond what is already on the page.
    return ok(match.looksLikePosting ? match : null);
  });

  handle('content:list-profiles', async () => {
    const [profiles, settings] = await Promise.all([listProfiles(), getSettings()]);
    return ok(
      profiles.map((profile) => ({
        id: profile.id,
        name: profile.name,
        active: profile.id === settings.activeProfileId,
      })),
    );
  });

  handle('content:switch-profile', async (request) => {
    const { profileId } = request as Extract<ContentRequest, { type: 'content:switch-profile' }>;
    const id = sanitizeString(profileId, 64);
    const profiles = await listProfiles();
    if (!profiles.some((profile) => profile.id === id))
      return err('Profile not found', 'ENOTFOUND');
    await setSettings({ activeProfileId: id });
    return ok({ switched: true });
  });

  /**
   * The facts a draft could use, shown to the user BEFORE anything is
   * generated so they can untick what they do not want passed to the model.
   */
  handle('content:draft-facts', async () => {
    const settings = await getSettings();
    if (
      !settings.ai.enabled ||
      !settings.ai.assistAnswerDrafting ||
      settings.ai.provider === 'none'
    ) {
      return err('Answer drafting is switched off in Fillwright settings.', 'EAIOFF');
    }
    const availability = await getProvider(settings.ai.provider).availability();
    if (availability.state !== 'ready') {
      return err(availability.reason, 'EAIUNAVAILABLE');
    }
    const profile = settings.activeProfileId
      ? await getProfile(settings.activeProfileId)
      : undefined;
    if (!profile) return err('No active profile.', 'ENOPROFILE');
    return ok(draftFacts(profile));
  });

  handle('content:draft', async (request) => {
    const { question, factIds, maxCharacters } = request as Extract<
      ContentRequest,
      { type: 'content:draft' }
    >;
    const settings = await getSettings();
    if (!settings.ai.enabled || !settings.ai.assistAnswerDrafting) {
      return err('Answer drafting is switched off in Fillwright settings.', 'EAIOFF');
    }
    const profile = settings.activeProfileId
      ? await getProfile(settings.activeProfileId)
      : undefined;
    if (!profile) return err('No active profile.', 'ENOPROFILE');

    const chosen = new Set(
      Array.isArray(factIds) ? factIds.slice(0, 40).map((id) => sanitizeString(id, 32)) : [],
    );
    const context = draftFacts(profile)
      .filter((fact) => chosen.has(fact.id))
      .map((fact) => `${fact.label}: ${fact.value}`);

    const result = await getProvider(settings.ai.provider).draft({
      question: sanitizeString(question, 1_000),
      context,
      ...(typeof maxCharacters === 'number' && maxCharacters > 0
        ? { maxCharacters: Math.min(5_000, Math.trunc(maxCharacters)) }
        : {}),
    });
    return result.ok
      ? ok({ text: result.text })
      : err(result.error ?? 'No draft was produced.', 'EDRAFT');
  });
}

export interface DraftFact {
  id: string;
  label: string;
  value: string;
}

/**
 * Career facts only. Contact details, demographics and every sensitive answer
 * are excluded outright: a written answer never needs them, so they are never
 * offered to the model at all.
 */
export function draftFacts(profile: Profile): DraftFact[] {
  const facts: DraftFact[] = [];
  const push = (id: string, label: string, value: string) => {
    const text = value.trim();
    if (text) facts.push({ id, label, value: text.slice(0, 400) });
  };

  push('summary', 'Summary', profile.summary.value);
  profile.experience.slice(0, 3).forEach((entry, index) => {
    push(`exp-${index}`, 'Experience', [entry.title, entry.company].filter(Boolean).join(' at '));
  });
  profile.education.slice(0, 2).forEach((entry, index) => {
    const parts = [entry.degree, entry.major, entry.institution].filter(Boolean);
    push(`edu-${index}`, 'Education', parts.join(', '));
  });
  profile.projects.slice(0, 3).forEach((entry, index) => {
    push(`proj-${index}`, 'Project', [entry.name, entry.description].filter(Boolean).join(' — '));
  });
  const skills = profile.skills.slice(0, 15).map((skill) => skill.name);
  if (skills.length) push('skills', 'Skills', skills.join(', '));
  return facts;
}
