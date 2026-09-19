import { isSafeToPress } from '@/adapters';

/**
 * "Add another" controls.
 *
 * Trust boundary: content script, acting on an untrusted page. This is the
 * only place Fillwright presses a page button, and only on explicit request.
 *
 * When a profile has three education entries and the form shows one block,
 * the form usually offers a "+ Add education" button. Fillwright can press it
 * for the user — but only when the user asks, only a bounded number of times,
 * and only on a control that is unmistakably an add-entry button.
 *
 * The guard is layered:
 *  1. the accessible text must read as "add <education|experience …>";
 *  2. it must pass the adapter guard (no submit, apply, delete, navigation);
 *  3. it must not be a link, because a link navigates away from the form.
 * Anything that fails any of these is left for the user to press.
 */

export type RepeatKind = 'education' | 'experience';

export interface AddControl {
  kind: RepeatKind;
  element: HTMLElement;
  label: string;
}

const EDUCATION = /\b(?:education|school|degree|qualification|university|college|academic)\b/;
const EXPERIENCE = /\b(?:experience|employment|work|job|position|employer|role|internship)\b/;
const ADD = /^\s*(?:\+\s*)?(?:add|new)\b(?:\s+(?:another|more|an?|one more))?\b/;
const FORBIDDEN =
  /\b(?:submit|apply|send|delete|remove|save and|finish|review|next|continue|sign|log ?in)\b/;

export function classifyAddLabel(label: string): RepeatKind | null {
  const text = label.replace(/\s+/g, ' ').trim().toLowerCase();
  if (!text || text.length > 60) return null;
  if (!ADD.test(text) || FORBIDDEN.test(text)) return null;
  // Education is checked first: "Add academic experience" is education.
  if (EDUCATION.test(text)) return 'education';
  if (EXPERIENCE.test(text)) return 'experience';
  return null;
}

export function findAddControls(root: Document | HTMLElement = document): AddControl[] {
  const controls: AddControl[] = [];
  const candidates = root.querySelectorAll<HTMLElement>('button, [role="button"]');

  for (const element of Array.from(candidates).slice(0, 400)) {
    if (element.closest('a[href]')) continue;
    const label = accessibleText(element);
    const kind = classifyAddLabel(label);
    if (!kind) continue;
    if (!isSafeToPress(element)) continue;
    controls.push({ kind, element, label });
  }
  return controls;
}

/**
 * Presses the add control for `kind` up to `times` times, waiting for the
 * framework to render between presses. Returns how many presses were made.
 *
 * The control is looked up afresh before every press: frameworks frequently
 * re-render the button, and a stale reference would silently do nothing.
 */
export async function addEntries(kind: RepeatKind, times: number, settleMs = 450): Promise<number> {
  const limit = Math.max(0, Math.min(5, Math.trunc(times)));
  let pressed = 0;
  for (let i = 0; i < limit; i += 1) {
    const matches = findAddControls().filter((control) => control.kind === kind);
    // Two different "add education" buttons on one page is ambiguous; refuse.
    if (matches.length !== 1) break;
    try {
      matches[0]!.element.click();
    } catch {
      break;
    }
    pressed += 1;
    await new Promise((resolve) => setTimeout(resolve, settleMs));
  }
  return pressed;
}

function accessibleText(element: HTMLElement): string {
  return (
    element.getAttribute('aria-label') ||
    element.textContent ||
    element.getAttribute('title') ||
    ''
  ).trim();
}
