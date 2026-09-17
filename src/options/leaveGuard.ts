/**
 * Unsaved-changes guard for the options page.
 *
 * Trust boundary: UI state only.
 *
 * Profile edits autosave shortly after typing stops, so leaving a pane is
 * normally safe: the pending save is flushed first. Only when a save has
 * actually failed does navigation ask for confirmation, because leaving would
 * discard edits that exist nowhere else.
 */

type Guard = () => Promise<boolean>;

const guards = new Set<Guard>();

export function registerLeaveGuard(guard: Guard): () => void {
  guards.add(guard);
  return () => guards.delete(guard);
}

/** Resolves true when it is fine to navigate away from the current pane. */
export async function canLeave(): Promise<boolean> {
  for (const guard of guards) {
    if (!(await guard())) return false;
  }
  return true;
}
