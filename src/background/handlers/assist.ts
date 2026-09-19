import { handle, ok, err } from '../router';
import { getProfile, listProfiles } from '@/storage/profiles';
import { getSettings, setSettings } from '@/storage/settings';
import { matchJobDescription } from '@/autofill/job-match';
import { getProvider, POSTING_EXCERPT_MAX, type DraftRequest } from '@/ai/provider';
import { sanitizeString } from '@/security/validate';
import { answerChoices, savedAnswerText } from '@/autofill/saved-answers';
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
   * Custom fields and saved answers, by title only. Like `content:draft-facts`
   * this is the listing half of a two-step exchange: nothing the user wrote
   * crosses to the page until they pick one item.
   */
  handle('content:answer-choices', async (request) => {
    const { question } = request as Extract<ContentRequest, { type: 'content:answer-choices' }>;
    const profile = await activeProfile();
    if (!profile) return err('No active profile.', 'ENOPROFILE');
    return ok(answerChoices(profile, sanitizeString(question ?? '', 1_000)));
  });

  /** The one saved answer the user picked. It is shown for editing first. */
  handle('content:saved-answer', async (request) => {
    const { id } = request as Extract<ContentRequest, { type: 'content:saved-answer' }>;
    const profile = await activeProfile();
    if (!profile) return err('No active profile.', 'ENOPROFILE');
    const text = savedAnswerText(profile, sanitizeString(id, 64));
    return text === null ? err('That saved answer no longer exists.', 'ENOTFOUND') : ok({ text });
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
    const prepared = await prepareDraft(request as DraftInput);
    if ('error' in prepared) return err(prepared.error, prepared.code);
    const result = await prepared.provider.draft(prepared.request);
    return result.ok
      ? ok({ text: result.text })
      : err(result.error ?? 'No draft was produced.', 'EDRAFT');
  });

  chrome.runtime.onConnect.addListener((port) => {
    if (port.name !== DRAFT_PORT) return;
    // Only Fillwright's own content scripts and pages can open this port; a web
    // page has no route to it (no externally_connectable), but check anyway.
    if (port.sender?.id !== chrome.runtime.id) {
      port.disconnect();
      return;
    }
    serveDraftPort(port);
  });
}

/** The port name for streamed drafts. */
export const DRAFT_PORT = 'fw-draft';

/**
 * Streams one draft over a port: `start` begins it, `cancel` or closing the
 * port stops it. Replies are `chunk` (the whole text so far), then exactly one
 * of `done` or `error`.
 */
function serveDraftPort(port: chrome.runtime.Port): void {
  const controller = new AbortController();
  let started = false;
  let open = true;
  const post = (message: DraftPortReply) => {
    if (!open) return;
    try {
      port.postMessage(message);
    } catch {
      open = false;
    }
  };

  port.onDisconnect.addListener(() => {
    open = false;
    controller.abort();
  });

  port.onMessage.addListener((message: unknown) => {
    const type = (message as { type?: unknown } | null)?.type;
    if (type === 'cancel') {
      controller.abort();
      return;
    }
    if (type !== 'start' || started) return;
    started = true;
    void (async () => {
      const prepared = await prepareDraft(message as DraftInput);
      if ('error' in prepared) {
        post({ type: 'error', code: prepared.code, error: prepared.error });
        return;
      }
      const result = await prepared.provider.draft(prepared.request, {
        signal: controller.signal,
        onChunk: (text) => post({ type: 'chunk', text }),
      });
      if (result.ok) post({ type: 'done', text: result.text });
      else
        post({
          type: 'error',
          code:
            result.reason === 'cancelled'
              ? 'EDRAFTCANCELLED'
              : result.reason === 'timeout'
                ? 'EDRAFTTIMEOUT'
                : 'EDRAFT',
          error: result.error ?? 'No draft was produced.',
        });
      open = false;
      port.disconnect();
    })();
  });
}

export type DraftPortReply =
  | { type: 'chunk'; text: string }
  | { type: 'done'; text: string }
  | { type: 'error'; code: string; error: string };

interface DraftInput {
  question?: unknown;
  factIds?: unknown;
  maxCharacters?: unknown;
  posting?: unknown;
}

async function prepareDraft(
  input: DraftInput,
): Promise<
  | { provider: ReturnType<typeof getProvider>; request: DraftRequest }
  | { error: string; code: string }
> {
  const settings = await getSettings();
  if (!settings.ai.enabled || !settings.ai.assistAnswerDrafting) {
    return { error: 'Answer drafting is switched off in Fillwright settings.', code: 'EAIOFF' };
  }
  const profile = settings.activeProfileId ? await getProfile(settings.activeProfileId) : undefined;
  if (!profile) return { error: 'No active profile.', code: 'ENOPROFILE' };
  return {
    provider: getProvider(settings.ai.provider),
    request: draftRequestFor(profile, {
      question: typeof input.question === 'string' ? input.question : '',
      factIds: Array.isArray(input.factIds)
        ? input.factIds.filter((id): id is string => typeof id === 'string')
        : [],
      ...(typeof input.maxCharacters === 'number' ? { maxCharacters: input.maxCharacters } : {}),
      ...(typeof input.posting === 'string' ? { posting: input.posting } : {}),
    }),
  };
}

/**
 * Builds exactly what the model will be given: the ticked facts, plus the
 * posting excerpt and saved answers only when those were ticked too.
 */
export function draftRequestFor(
  profile: Profile,
  input: { question: string; factIds: string[]; maxCharacters?: number; posting?: string },
): DraftRequest {
  const chosen = new Set(input.factIds.slice(0, 40).map((id) => sanitizeString(id, 32)));
  const context = draftFacts(profile)
    .filter((fact) => chosen.has(fact.id) && !fact.optional)
    .map((fact) => `${fact.label}: ${fact.value}`);

  const request: DraftRequest = { question: sanitizeString(input.question, 1_000), context };
  if (typeof input.maxCharacters === 'number' && input.maxCharacters > 0) {
    request.maxCharacters = Math.min(5_000, Math.trunc(input.maxCharacters));
  }
  if (chosen.has('posting') && input.posting) {
    const posting = sanitizeString(input.posting, POSTING_EXCERPT_MAX).trim();
    if (posting) request.posting = posting;
  }
  if (chosen.has('saved-answers')) {
    const saved = (profile.preferences?.savedAnswers ?? [])
      .slice(0, 10)
      .map((answer) => `${answer.label}: ${answer.text}`.trim().slice(0, 600))
      .filter(Boolean);
    if (saved.length) request.savedAnswers = saved;
  }
  return request;
}

async function activeProfile(): Promise<Profile | undefined> {
  const settings = await getSettings();
  return settings.activeProfileId ? getProfile(settings.activeProfileId) : undefined;
}

export interface DraftFact {
  id: string;
  label: string;
  value: string;
  /** Extra context the user must tick deliberately; unticked by default. */
  optional?: boolean;
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
  // Named, not quoted: the page's panel only needs to know which answers exist.
  const saved = (profile.preferences?.savedAnswers ?? [])
    .slice(0, 10)
    .map((answer) => answer.label || answer.key);
  if (saved.length) {
    facts.push({
      id: 'saved-answers',
      label: 'Your saved answers',
      value: saved.join(', ').slice(0, 400),
      optional: true,
    });
  }
  return facts;
}
