import { FIELD_CATALOG, isOpenableProfileField } from '@/field-detection/catalog';

/** Where the profile editor labels a catalog field differently. */
const EDITOR_LABELS: Partial<Record<string, string>> = {
  'education.institution': 'Institution',
  'education.major': 'Major / field of study',
  'experience.company': 'Company',
};

/** The `field` parameter of a `#/profile?field=…` link, if it is a catalog key. */
export function requestedField(hash: string): string | null {
  const query = hash.split('?')[1];
  if (!query) return null;
  const field = new URLSearchParams(query).get('field');
  return isOpenableProfileField(field) ? field : null;
}

/**
 * Focuses the profile control for `field`, found by its visible label. The
 * field name was checked against FIELD_CATALOG; it is only compared, never
 * used as a selector. Returns false when this page has no such control.
 */
export function focusProfileField(field: string, root: ParentNode = document): boolean {
  const wanted = (
    EDITOR_LABELS[field] ??
    FIELD_CATALOG.find((entry) => entry.field === field)?.label ??
    ''
  ).toLowerCase();
  if (!wanted) return false;
  for (const label of root.querySelectorAll<HTMLLabelElement>('label[for]')) {
    const text = (label.firstChild?.textContent ?? label.textContent ?? '').trim().toLowerCase();
    if (text !== wanted) continue;
    const control = document.getElementById(label.htmlFor);
    if (!control) continue;
    control.scrollIntoView?.({ block: 'center' });
    control.focus();
    return true;
  }
  return false;
}
