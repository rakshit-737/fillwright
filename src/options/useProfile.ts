import { useCallback, useEffect, useRef, useState } from 'react';
import { send } from '@/utils/messaging';
import { registerLeaveGuard } from './leaveGuard';
import type { Profile } from '@/types/profile';

export type SaveState = 'idle' | 'dirty' | 'saving' | 'saved' | 'error';

export interface ProfileEditor {
  profile: Profile | null;
  loading: boolean;
  error: string;
  /** Code of the last failure, e.g. ELOCKED, so panes can offer the right fix. */
  errorCode: string;
  saveState: SaveState;
  /** Applies a mutation to a draft copy and schedules a save. */
  update: (mutate: (draft: Profile) => void) => void;
  /** Forces an immediate save, e.g. before navigating away. */
  flush: () => Promise<void>;
  reload: () => void;
}

const AUTOSAVE_DELAY_MS = 700;

/**
 * Loads a profile and autosaves edits.
 *
 * Edits are applied to a structural clone and written back through the
 * background worker, which owns storage. Saves are debounced so typing does not
 * hit IndexedDB on every keystroke, and a pending save is flushed on unmount so
 * closing the tab mid-edit cannot lose the last few characters.
 */
export function useProfile(profileId: string | null): ProfileEditor {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [errorCode, setErrorCode] = useState('');
  const [saveState, setSaveState] = useState<SaveState>('idle');

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<Profile | null>(null);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(() => {
    if (!profileId) {
      setProfile(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    void send<Profile>({ type: 'ui:get-profile', profileId }).then((result) => {
      if (result.ok) {
        setProfile(result.data);
        setError('');
        setErrorCode('');
      } else {
        setError(result.error);
        setErrorCode(result.code ?? '');
      }
      setLoading(false);
    });
  }, [profileId]);

  useEffect(load, [load]);

  /** Saves pending edits. Resolves false when a save was attempted and failed. */
  const persist = useCallback(async (): Promise<boolean> => {
    const draft = pending.current;
    if (!draft) return true;
    pending.current = null;
    setSaveState('saving');
    const result = await send<Profile>({ type: 'ui:save-profile', profile: draft });
    if (result.ok) {
      // Adopt the stored copy so `updatedAt` in the UI matches what was written.
      setProfile(result.data);
      setSaveState('saved');
      if (savedTimer.current) clearTimeout(savedTimer.current);
      savedTimer.current = setTimeout(() => setSaveState('idle'), 1600);
      return true;
    } else {
      // Keep the edits: a later save (or the retry button) writes them, unless
      // the user has typed something newer in the meantime.
      pending.current ??= draft;
      setSaveState('error');
      setError(result.error);
      setErrorCode(result.code ?? '');
      return false;
    }
  }, []);

  const update = useCallback(
    (mutate: (draft: Profile) => void) => {
      setProfile((current) => {
        if (!current) return current;
        const draft = structuredClone(current);
        mutate(draft);
        pending.current = draft;
        setSaveState('dirty');
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => void persist(), AUTOSAVE_DELAY_MS);
        return draft;
      });
    },
    [persist],
  );

  const flush = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current);
    await persist();
  }, [persist]);

  const failed = useRef(false);
  useEffect(() => {
    failed.current = saveState === 'error';
  }, [saveState]);

  // Leaving the pane flushes pending edits first, and asks before discarding
  // edits whose save failed.
  useEffect(() => {
    const release = registerLeaveGuard(async () => {
      if (timer.current) clearTimeout(timer.current);
      // The outcome of this flush decides, not the last rendered state, which
      // may be mid-save.
      const saved = pending.current ? await persist() : !failed.current;
      if (saved) return true;
      return window.confirm(
        'Some changes to your profile have not been saved.\n\n' +
          'Leave this page anyway? Those changes will be lost.',
      );
    });
    // Closing the tab with a failed save: let the browser ask.
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (failed.current) event.preventDefault();
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      release();
      window.removeEventListener('beforeunload', onBeforeUnload);
    };
  }, [persist]);

  // Never lose an in-flight edit when the pane unmounts or the tab closes.
  useEffect(() => {
    const onHide = () => {
      if (pending.current) void persist();
    };
    window.addEventListener('pagehide', onHide);
    return () => {
      window.removeEventListener('pagehide', onHide);
      if (timer.current) clearTimeout(timer.current);
      if (savedTimer.current) clearTimeout(savedTimer.current);
      if (pending.current) void persist();
    };
  }, [persist]);

  return { profile, loading, error, errorCode, saveState, update, flush, reload: load };
}

export function saveStateLabel(state: SaveState): string {
  switch (state) {
    case 'dirty':
      return 'Unsaved changes';
    case 'saving':
      return 'Saving…';
    case 'saved':
      return 'Saved';
    case 'error':
      return 'Not saved yet — your changes are kept';
    default:
      return '';
  }
}
