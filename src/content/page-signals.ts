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

/**
 * A best guess at the posting's company and role, for the optional local
 * history. Page text only, capped, and used only when history is switched on.
 */
export function guessPosting(doc: Document): { company: string; role: string } {
  const clean = (text: string | null | undefined) => (text ?? '').replace(/\s+/g, ' ').trim();
  const meta = (property: string) =>
    clean(doc.querySelector(`meta[property="${property}"]`)?.getAttribute('content'));

  let role = clean(doc.querySelector('h1')?.textContent) || meta('og:title');
  let company = meta('og:site_name');

  // Titles like "Job Application for Engineer at Acme" or "Engineer - Acme Careers".
  const title = clean(doc.title);
  const at = title.match(/(?:application for\s+)?(.+?)\s+(?:at|@)\s+(.+?)(?:\s*[|–—-].*)?$/i);
  if (at) {
    role ||= clean(at[1]);
    company ||= clean(at[2]);
  } else if (!company) {
    const parts = title
      .split(/\s+[|–—-]\s+/)
      .map(clean)
      .filter(Boolean);
    if (parts.length > 1) company = parts[parts.length - 1]!.replace(/\s+careers?$/i, '');
  }
  return { company: company.slice(0, 120), role: role.slice(0, 120) };
}
