import type { ControlKind, DetectedField, FieldOption, FieldSignals } from '@/types/fields';

/**
 * Reads form controls out of a live document.
 *
 * Everything here treats the page as untrusted: text is collected as data for
 * the classifier, lengths are capped so a hostile page cannot exhaust memory,
 * and no value read from the DOM is ever evaluated, executed, or inserted as
 * markup anywhere.
 */

/** Upper bound on controls per scan. Real applications have well under 100. */
const MAX_FIELDS = 400;
const MAX_TEXT = 600;
/** How far up the tree to look for a label or a section heading. */
const MAX_ANCESTOR_HOPS = 6;

const SKIPPED_INPUT_TYPES = new Set([
  'hidden',
  'submit',
  'button',
  'reset',
  'image',
  // Passwords are never read and never written. Fillwright is not a password
  // manager and has no business touching credential fields.
  'password',
]);

export interface HarvestResult {
  fields: DetectedField[];
  /** Elements addressed by field id, so the filler can find them again. */
  elements: Map<string, HTMLElement[]>;
  truncated: boolean;
}

/**
 * Collects every fillable control, including those inside open shadow roots.
 *
 * Closed shadow roots and cross-origin iframes are unreachable by design; the
 * content script is injected into each same-origin frame separately instead.
 */
export function harvestFields(root: Document | ShadowRoot = document): HarvestResult {
  const elements = new Map<string, HTMLElement[]>();
  const fields: DetectedField[] = [];
  const seenRadioGroups = new Set<string>();
  let counter = 0;
  let truncated = false;

  for (const element of deepQueryControls(root)) {
    if (fields.length >= MAX_FIELDS) {
      truncated = true;
      break;
    }
    if (!isFillable(element)) continue;

    // Radio buttons are one logical field, not N. The whole group is collected
    // the first time any member is encountered.
    if (element instanceof HTMLInputElement && element.type === 'radio') {
      const groupKey = radioGroupKey(element);
      if (seenRadioGroups.has(groupKey)) continue;
      seenRadioGroups.add(groupKey);

      const members = radioGroupMembers(element, root);
      const id = `fw-${counter++}`;
      fields.push(describeRadioGroup(id, members, fields.length));
      elements.set(id, members);
      continue;
    }

    const id = `fw-${counter++}`;
    fields.push(describeControl(id, element, fields.length));
    elements.set(id, [element]);
  }

  // Radio groups built from buttons (role="radio" inside role="radiogroup"),
  // as Ashby and many design systems render them. Native radios are handled
  // above; these have no <input> at all.
  for (const group of deepQuery(root, '[role="radiogroup"]')) {
    if (fields.length >= MAX_FIELDS) {
      truncated = true;
      break;
    }
    if (group.closest('[data-fillwright-ui]')) continue;
    const members = Array.from(group.querySelectorAll<HTMLElement>('[role="radio"]')).filter(
      (member) => !(member instanceof HTMLInputElement),
    );
    if (members.length === 0) continue;
    const id = `fw-${counter++}`;
    fields.push(describeAriaRadioGroup(id, group, members, fields.length));
    elements.set(id, members);
  }

  return { fields, elements, truncated };
}

/* ------------------------------------------------------------- collection */

function deepQuery(root: Document | ShadowRoot | Element, selector: string): HTMLElement[] {
  const found: HTMLElement[] = [];
  const visit = (node: Document | ShadowRoot | Element) => {
    found.push(...Array.from(node.querySelectorAll<HTMLElement>(selector)));
    for (const element of node.querySelectorAll<HTMLElement>('*')) {
      if (element.shadowRoot) visit(element.shadowRoot);
    }
  };
  visit(root);
  return found;
}

/** The value an ARIA radio option stands for. */
export function ariaOptionValue(option: HTMLElement): string {
  return clean(
    option.getAttribute('data-value') ??
      option.getAttribute('aria-label') ??
      option.textContent ??
      '',
  );
}

function describeAriaRadioGroup(
  id: string,
  group: HTMLElement,
  members: HTMLElement[],
  order: number,
): DetectedField {
  const first = members[0]!;
  const options: FieldOption[] = members.map((member) => ({
    value: ariaOptionValue(member),
    label: truncate(clean(member.getAttribute('aria-label') ?? member.textContent ?? '')),
  }));
  const checked = members.find((member) => member.getAttribute('aria-checked') === 'true');
  const signals = readSignals(first, 'radio-group', options);
  signals.labelText = truncate(groupLabel(first) || signals.labelText);
  // An option button's own text is not the question.
  if (signals.ariaLabel && options.some((option) => option.label === signals.ariaLabel)) {
    signals.ariaLabel = '';
  }
  return {
    id,
    kind: 'radio-group',
    signals,
    options,
    currentValue: checked ? ariaOptionValue(checked) : '',
    hasExistingValue: Boolean(checked),
    visible: isVisible(group) || members.some(isVisible),
    disabled: group.getAttribute('aria-disabled') === 'true' || members.every(isDisabled),
    readOnly: group.getAttribute('aria-readonly') === 'true',
    order,
    selectorHint: selectorFor(first),
    ...repeatPositionOf(group),
  };
}

const CONTROL_SELECTOR =
  'input, select, textarea, [contenteditable="true"], [contenteditable=""], [role="combobox"], [role="textbox"]';

function deepQueryControls(root: Document | ShadowRoot | Element): HTMLElement[] {
  const found: HTMLElement[] = [];
  const seen = new Set<Element>();

  const visit = (node: Document | ShadowRoot | Element) => {
    for (const element of node.querySelectorAll<HTMLElement>(CONTROL_SELECTOR)) {
      if (!seen.has(element)) {
        seen.add(element);
        found.push(element);
      }
    }
    // Recurse into open shadow roots; many design systems wrap inputs in them.
    for (const element of node.querySelectorAll<HTMLElement>('*')) {
      if (element.shadowRoot) visit(element.shadowRoot);
    }
  };

  visit(root);
  return found;
}

function isFillable(element: HTMLElement): boolean {
  if (element instanceof HTMLInputElement && SKIPPED_INPUT_TYPES.has(element.type)) return false;
  // Fillwright never touches anything that looks like a credential or a
  // one-time code, whatever its declared type.
  const identity = `${element.getAttribute('name') ?? ''} ${element.id} ${element.getAttribute('autocomplete') ?? ''}`;
  if (
    /\b(?:password|passwd|pwd|otp|one[-_]?time|cvv|card[-_]?number|ssn|social[-_]?security)\b/i.test(
      identity,
    )
  ) {
    return false;
  }
  if (element.closest('[data-fillwright-ui]')) return false;
  return true;
}

/* -------------------------------------------------------------- describing */

function describeControl(id: string, element: HTMLElement, order: number): DetectedField {
  const kind = controlKind(element);
  const options = readOptions(element);
  const currentValue = readValue(element);

  return {
    id,
    kind,
    signals: readSignals(element, kind, options),
    options,
    currentValue,
    hasExistingValue: currentValue.trim().length > 0,
    visible: isVisible(element),
    disabled: isDisabled(element),
    readOnly: isReadOnly(element),
    order,
    selectorHint: selectorFor(element),
    ...repeatPositionOf(element),
  };
}

/**
 * Locates the control inside a repeated block, if it is in one.
 *
 * Walks up looking for an ancestor whose siblings have the same *shape* — same
 * tag and same class attribute — and which contains form controls. That is what
 * a repeated "Education #2" block looks like in the DOM: the same markup,
 * rendered again.
 *
 * The signature deliberately excludes ids and text, which differ between
 * repeats; only the structure is compared.
 */
function repeatPositionOf(element: HTMLElement): {
  groupSignature: string | null;
  groupOrdinal: number | null;
} {
  let node: HTMLElement | null = element.parentElement;

  for (let hop = 0; node && hop < MAX_ANCESTOR_HOPS; hop++, node = node.parentElement) {
    const parent = node.parentElement;
    if (!parent) break;

    const shape = shapeOf(node);
    const siblings = Array.from(parent.children).filter(
      (child): child is HTMLElement => child instanceof HTMLElement && shapeOf(child) === shape,
    );

    // One of a kind is a container, not a repetition.
    if (siblings.length < 2) continue;
    // A repeated block has to actually hold fields.
    if (!node.querySelector(CONTROL_SELECTOR)) continue;

    return {
      groupSignature: `${pathOf(parent)}>${shape}`,
      groupOrdinal: siblings.indexOf(node),
    };
  }

  return { groupSignature: null, groupOrdinal: null };
}

/** Tag plus class list — the part of an element that repeats identically. */
function shapeOf(element: HTMLElement): string {
  const classes = Array.from(element.classList).sort().join('.');
  return classes ? `${element.tagName.toLowerCase()}.${classes}` : element.tagName.toLowerCase();
}

/** Short ancestor path, so two different repeating lists stay distinguishable. */
function pathOf(element: HTMLElement): string {
  const parts: string[] = [];
  let node: HTMLElement | null = element;
  for (let hop = 0; node && hop < 3; hop++, node = node.parentElement) {
    parts.unshift(shapeOf(node));
  }
  return parts.join('>');
}

function describeRadioGroup(id: string, members: HTMLInputElement[], order: number): DetectedField {
  const first = members[0]!;
  const options: FieldOption[] = members.map((member) => ({
    value: member.value,
    label: truncate(labelForControl(member) || member.value),
  }));
  const checked = members.find((member) => member.checked);

  // The group's own label lives on the fieldset or the surrounding container,
  // not on any individual radio — an individual radio's label is its option.
  const signals = readSignals(first, 'radio-group', options);
  signals.labelText = truncate(groupLabel(first) || signals.labelText);

  return {
    id,
    kind: 'radio-group',
    signals,
    options,
    currentValue: checked?.value ?? '',
    hasExistingValue: Boolean(checked),
    visible: members.some(isVisible),
    disabled: members.every(isDisabled),
    readOnly: false,
    order,
    selectorHint: selectorFor(first),
    ...repeatPositionOf(first),
  };
}

function controlKind(element: HTMLElement): ControlKind {
  if (element instanceof HTMLTextAreaElement) return 'textarea';
  if (element instanceof HTMLSelectElement) return 'select';
  if (element instanceof HTMLInputElement) {
    switch (element.type) {
      case 'email':
        return 'email';
      case 'tel':
        return 'tel';
      case 'url':
        return 'url';
      case 'number':
        return 'number';
      case 'date':
        return 'date';
      case 'month':
        return 'month';
      case 'checkbox':
        return 'checkbox';
      case 'radio':
        return 'radio-group';
      case 'file':
        return 'file';
      default:
        return 'text';
    }
  }
  if (element.isContentEditable) return 'contenteditable';
  if (element.getAttribute('role') === 'combobox') return 'combobox';
  if (element.getAttribute('role') === 'textbox') return 'contenteditable';
  return 'unsupported';
}

function readSignals(
  element: HTMLElement,
  kind: ControlKind,
  options: FieldOption[],
): FieldSignals {
  const input = element as HTMLInputElement;
  return {
    labelText: truncate(labelForControl(element)),
    ariaLabel: truncate(element.getAttribute('aria-label') ?? ''),
    ariaDescription: truncate(describedByText(element)),
    placeholder: truncate(element.getAttribute('placeholder') ?? ''),
    name: truncate(element.getAttribute('name') ?? '', 120),
    id: truncate(element.id, 120),
    autocomplete: truncate(element.getAttribute('autocomplete') ?? '', 120),
    inputType: kind === 'radio-group' ? 'radio-group' : kind,
    title: truncate(element.getAttribute('title') ?? ''),
    sectionHeading: truncate(sectionHeadingFor(element)),
    precedingText: truncate(precedingTextFor(element)),
    optionLabels: options.slice(0, 40).map((option) => option.label),
    required: element.hasAttribute('required') || element.getAttribute('aria-required') === 'true',
    maxLength: Number.isFinite(input.maxLength) && input.maxLength > 0 ? input.maxLength : null,
    lang: truncate(element.closest('[lang]')?.getAttribute('lang') ?? '', 35),
  };
}

/* ------------------------------------------------------------------ labels */

/**
 * Finds the visible label for a control, in order of reliability.
 *
 * The DOM offers several mechanisms and real sites use all of them, often
 * inconsistently within one form.
 */
export function labelForControl(element: HTMLElement): string {
  // 1. aria-labelledby wins: it is explicit and points at real text.
  const labelledBy = element.getAttribute('aria-labelledby');
  if (labelledBy) {
    const text = labelledBy
      .split(/\s+/)
      .map((id) => ownerDocument(element).getElementById(id)?.textContent ?? '')
      .join(' ')
      .trim();
    if (text) return clean(text);
  }

  // 2. <label for="id">
  if (element.id) {
    const escaped = cssEscape(element.id);
    const label = ownerDocument(element).querySelector<HTMLLabelElement>(`label[for="${escaped}"]`);
    if (label?.textContent?.trim()) return clean(label.textContent);
  }

  // 3. A wrapping <label>, with the control's own text removed.
  const wrapping = element.closest('label');
  if (wrapping) {
    const text = textWithoutControls(wrapping);
    if (text) return clean(text);
  }

  // 4. Some frameworks emit a sibling label with no `for` attribute.
  const previous = element.previousElementSibling;
  if (previous && previous.tagName === 'LABEL' && previous.textContent?.trim()) {
    return clean(previous.textContent);
  }

  // 5. Lever-style: the control sits alone in a wrapper, and the wrapper's
  // previous sibling is a label-classed block of text. Only a wrapper holding
  // exactly one control qualifies, so a label is never shared by two fields.
  const wrapper = element.parentElement;
  const beside = wrapper?.previousElementSibling;
  if (
    wrapper &&
    beside &&
    wrapper.querySelectorAll('input, select, textarea').length === 1 &&
    /label|question|title/i.test(beside.getAttribute('class') ?? '') &&
    !beside.querySelector('input, select, textarea')
  ) {
    const text = clean(beside.textContent ?? '');
    if (text && text.length <= 120) return text;
  }

  return '';
}

/** The label for a radio/checkbox group, which lives above the options. */
function groupLabel(element: HTMLElement): string {
  const fieldset = element.closest('fieldset');
  const legend = fieldset?.querySelector('legend');
  if (legend?.textContent?.trim()) return clean(legend.textContent);

  const labelled = element.closest('[role="radiogroup"], [role="group"]');
  const ariaLabel = labelled?.getAttribute('aria-label');
  if (ariaLabel) return clean(ariaLabel);

  const labelledBy = labelled?.getAttribute('aria-labelledby');
  if (labelledBy) {
    const text = labelledBy
      .split(/\s+/)
      .map((id) => ownerDocument(element).getElementById(id)?.textContent ?? '')
      .join(' ');
    if (text.trim()) return clean(text);
  }

  // Fall back to the nearest preceding block of text above the group.
  let node: HTMLElement | null = element.parentElement;
  for (let hop = 0; node && hop < MAX_ANCESTOR_HOPS; hop++, node = node.parentElement) {
    const heading = node.querySelector(
      'legend, .question-title, [class*="label"], [class*="question"]',
    );
    if (heading?.textContent?.trim() && !heading.contains(element))
      return clean(heading.textContent);
  }
  return '';
}

function describedByText(element: HTMLElement): string {
  const describedBy = element.getAttribute('aria-describedby');
  if (!describedBy) return '';
  return clean(
    describedBy
      .split(/\s+/)
      .map((id) => ownerDocument(element).getElementById(id)?.textContent ?? '')
      .join(' '),
  );
}

/** The nearest heading above the control, used as section context. */
function sectionHeadingFor(element: HTMLElement): string {
  const legend = element.closest('fieldset')?.querySelector('legend');
  if (legend?.textContent?.trim()) return clean(legend.textContent);

  let node: Element | null = element;
  for (let hop = 0; node && hop < MAX_ANCESTOR_HOPS * 2; hop++) {
    let sibling = node.previousElementSibling;
    while (sibling) {
      if (/^H[1-6]$/.test(sibling.tagName) && sibling.textContent?.trim()) {
        return clean(sibling.textContent);
      }
      const nested = sibling.querySelector('h1, h2, h3, h4, h5, h6');
      if (nested?.textContent?.trim()) return clean(nested.textContent);
      sibling = sibling.previousElementSibling;
    }
    node = node.parentElement;
  }
  return '';
}

/**
 * Visible text immediately before the control, for label-less layouts.
 *
 * Strictly *preceding and adjacent*. Returning the parent's whole text looks
 * equivalent but is not: on the many real forms where inputs are direct
 * children of the `<form>`, that hands back every label on the page. Unrelated
 * wording then leaks into every field's evidence — and, worse, into the
 * negative rules, where a single "University" elsewhere on the form can
 * disqualify a first-name field.
 *
 * So this walks backwards from the control, collecting text until it reaches
 * another form control (which marks the previous field's territory) or the cap.
 */
function precedingTextFor(element: HTMLElement): string {
  const parts: string[] = [];
  let budget = 160;

  let node: Node | null = element;
  for (let hop = 0; node && hop < 12 && budget > 0; hop++) {
    let sibling: Node | null = node.previousSibling;

    while (sibling && budget > 0) {
      if (sibling instanceof HTMLElement) {
        // Another control means we have reached the previous field.
        if (sibling.matches(CONTROL_SELECTOR)) return finishPreceding(parts);
        if (sibling.querySelector(CONTROL_SELECTOR)) return finishPreceding(parts);
        const text = clean(sibling.textContent ?? '');
        if (text) {
          parts.unshift(text.slice(0, budget));
          budget -= text.length;
        }
      } else if (sibling.nodeType === Node.TEXT_NODE) {
        const text = clean(sibling.textContent ?? '');
        if (text) {
          parts.unshift(text.slice(0, budget));
          budget -= text.length;
        }
      }
      sibling = sibling.previousSibling;
    }

    node = node.parentElement;
    // Never climb out to the form itself; its text is the entire page.
    if (node instanceof HTMLElement && (node.tagName === 'FORM' || node.tagName === 'BODY')) break;
  }

  return finishPreceding(parts);
}

function finishPreceding(parts: string[]): string {
  return truncate(parts.join(' '), 200);
}

/**
 * Text content of a container with form controls and their options removed.
 * Without this, a `<label>` wrapping a `<select>` returns every option's text.
 */
function textWithoutControls(container: Element): string {
  let out = '';
  const walker = ownerDocument(container as HTMLElement).createTreeWalker(
    container,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode(node) {
        const parent = node.parentElement;
        if (!parent) return NodeFilter.FILTER_REJECT;
        if (parent.closest('select, option, textarea, button, [data-fillwright-ui]')) {
          return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
      },
    },
  );

  let node = walker.nextNode();
  while (node && out.length < MAX_TEXT) {
    out += ` ${node.textContent ?? ''}`;
    node = walker.nextNode();
  }
  return out.trim();
}

/* ------------------------------------------------------------ values, state */

function readOptions(element: HTMLElement): FieldOption[] {
  if (element instanceof HTMLSelectElement) {
    return Array.from(element.options)
      .slice(0, 200)
      .map((option) => ({ value: option.value, label: clean(option.textContent ?? option.value) }));
  }
  if (element instanceof HTMLInputElement && element.type === 'checkbox') {
    return [{ value: element.value || 'on', label: truncate(labelForControl(element)) }];
  }
  return [];
}

function readValue(element: HTMLElement): string {
  if (element instanceof HTMLSelectElement) {
    // A placeholder option ("Select…", "") is not a real value.
    const selected = element.selectedOptions[0];
    if (!selected || selected.value === '' || selected.disabled) return '';
    return selected.value;
  }
  if (element instanceof HTMLInputElement) {
    if (element.type === 'checkbox') return element.checked ? element.value || 'on' : '';
    if (element.type === 'file') return element.files?.[0]?.name ?? '';
    return element.value;
  }
  if (element instanceof HTMLTextAreaElement) return element.value;
  if (element.isContentEditable) return element.textContent ?? '';
  return '';
}

function isVisible(element: HTMLElement): boolean {
  if (!element.isConnected) return false;
  // getClientRects() is empty for display:none and for detached subtrees, and
  // it is far cheaper than a full getComputedStyle on every control.
  if (element.getClientRects().length === 0) {
    // Radios and checkboxes are routinely visually hidden but still operable
    // via a styled label, so they are judged by their label's visibility.
    const label = element.closest('label');
    if (!label || label.getClientRects().length === 0) return false;
  }
  const style = getComputedStyle(element);
  return style.visibility !== 'hidden' && style.display !== 'none';
}

function isDisabled(element: HTMLElement): boolean {
  const candidate = element as HTMLInputElement;
  return Boolean(candidate.disabled) || element.getAttribute('aria-disabled') === 'true';
}

function isReadOnly(element: HTMLElement): boolean {
  const candidate = element as HTMLInputElement;
  return Boolean(candidate.readOnly) || element.getAttribute('aria-readonly') === 'true';
}

/* ------------------------------------------------------------------ radios */

function radioGroupKey(element: HTMLInputElement): string {
  const form = element.form
    ? (element.form.getAttribute('name') ?? element.form.id ?? 'form')
    : 'noform';
  return `${form}::${element.name || element.id}`;
}

function radioGroupMembers(
  element: HTMLInputElement,
  root: Document | ShadowRoot,
): HTMLInputElement[] {
  if (!element.name) return [element];
  const scope: ParentNode = element.form ?? root;
  const escaped = cssEscape(element.name);
  const members = Array.from(
    scope.querySelectorAll<HTMLInputElement>(`input[type="radio"][name="${escaped}"]`),
  );
  return members.length > 0 ? members : [element];
}

/* ------------------------------------------------------------------ utils */

function ownerDocument(element: HTMLElement | Element): Document {
  return element.ownerDocument ?? document;
}

function clean(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function truncate(text: string, max = MAX_TEXT): string {
  const cleaned = clean(text);
  return cleaned.length > max ? cleaned.slice(0, max) : cleaned;
}

/**
 * CSS.escape with a fallback, so an id containing a colon or a bracket (common
 * in Workday and other enterprise apps) cannot break a selector.
 */
function cssEscape(value: string): string {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') return CSS.escape(value);
  return value.replace(/["\\\][:.#$@%^&*()+=~`'<>,?/|{} ]/g, (match) => `\\${match}`);
}

/**
 * A short, human-readable path used as the fingerprint for remembered mappings.
 * It does not need to be a valid selector — it only needs to be stable across
 * visits to the same form, which is why volatile framework ids are excluded.
 */
export function selectorFor(element: HTMLElement): string {
  const parts: string[] = [];
  let node: HTMLElement | null = element;

  for (let hop = 0; node && hop < 4; hop++, node = node.parentElement) {
    let part = node.tagName.toLowerCase();
    const name = node.getAttribute('name');
    if (name) part += `[name="${name}"]`;
    else if (node.id && !isGeneratedId(node.id)) part += `#${node.id}`;
    parts.unshift(part);
    if (name || (node.id && !isGeneratedId(node.id))) break;
  }

  return parts.join(' > ').slice(0, 240);
}

/** Framework-generated ids change on every render and make a useless key. */
function isGeneratedId(id: string): boolean {
  return /^(?:react|mui|radix|headlessui|ember|:r|__)/i.test(id) || /\d{4,}/.test(id);
}
