/**
 * The last check before Fillwright presses anything on a page.
 *
 * Trust boundary: content script, acting on an untrusted page. Roles and
 * labels are chosen by the page, so a hostile page can dress a real submit
 * button up as a dropdown option (`role="option"`), a radio (`role="radio"`)
 * or a combobox. Whatever the role says, an element that would submit a
 * form or navigate is never pressed.
 */

const SUBMIT_INPUTS = new Set(['submit', 'image', 'reset']);

export function isPressSafe(element: Element): boolean {
  if (!(element instanceof HTMLElement)) return false;
  if (element.closest('[data-fillwright-ui]')) return false;

  // A link navigates, wherever the click lands inside it.
  if (element.closest('a[href], area[href]')) return false;

  // A native button's default type is "submit": it submits its form unless it
  // says otherwise. Nested inside such a button counts too — the click bubbles.
  const button = element.closest('button');
  if (button && button.type !== 'button' && (button.form || button.getAttribute('form'))) {
    return false;
  }

  if (element instanceof HTMLInputElement && SUBMIT_INPUTS.has(element.type)) return false;
  const input = element.closest('input');
  if (input && SUBMIT_INPUTS.has(input.type)) return false;

  // Declared form submission helpers (formaction on anything inside a form).
  if (element.closest('[formaction]')) return false;

  return true;
}
