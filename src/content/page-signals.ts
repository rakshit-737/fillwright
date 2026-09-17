/**
 * Page-level signals for the "is this an application?" decision.
 *
 * Trust boundary: reads page text (title, top headings, button captions) and
 * counts of file and password inputs — never a value. The result is sent to
 * the worker, which scores it; the classifier is deliberately not bundled into
 * the content script.
 */
export interface PageSignals {
  headings: string[];
  buttonLabels: string[];
  hasFileInput: boolean;
  passwordFields: number;
}

export function collectPageSignals(doc: Document): PageSignals {
  const headings = [
    doc.title,
    ...Array.from(doc.querySelectorAll('h1, h2')).map((node) => node.textContent ?? ''),
  ]
    .map((text) => text.trim().slice(0, 160))
    .filter(Boolean)
    .slice(0, 12);

  const buttonLabels = Array.from(
    doc.querySelectorAll<HTMLElement>('button, input[type="submit"], [role="button"]'),
  )
    .slice(0, 60)
    .map((node) =>
      (node instanceof HTMLInputElement ? node.value : (node.textContent ?? ''))
        .trim()
        .slice(0, 60),
    )
    .filter(Boolean);

  return {
    headings,
    buttonLabels,
    hasFileInput: doc.querySelector('input[type="file"]') !== null,
    passwordFields: doc.querySelectorAll('input[type="password"]').length,
  };
}
