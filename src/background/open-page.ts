import { isOpenableProfileField } from '@/field-detection/catalog';

/** The only extension pages a content script may ask to open. */
export const OPENABLE_ROUTES: ReadonlySet<string> = new Set([
  'security',
  'import',
  'privacy',
  'assistance',
  'profile',
]);

/**
 * Builds the options-page path for a `content:open-page` request, or null.
 *
 * Both values come from a content script, so neither is trusted: the route
 * must be on the fixed list, and `field` is accepted only on the profile route
 * and only when it is exactly a key of FIELD_CATALOG. Opening the page grants
 * nothing — the profile is still read and written only by the options page.
 */
export function openPagePath(route: unknown, field?: unknown): string | null {
  if (typeof route !== 'string' || !OPENABLE_ROUTES.has(route)) return null;
  if (field === undefined || field === null || field === '') return `options.html#/${route}`;
  if (route !== 'profile' || !isOpenableProfileField(field)) return null;
  return `options.html#/profile?field=${encodeURIComponent(field)}`;
}
