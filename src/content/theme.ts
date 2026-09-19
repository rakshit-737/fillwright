import type { Settings } from '@/types/settings';

export type Theme = Settings['ui']['theme'];

const DARK_BLOCK = /@media\s*\(\s*prefers-color-scheme\s*:\s*dark\s*\)\s*\{/g;

/**
 * Rewrites the panel stylesheet for the theme chosen in Settings.
 *
 *  - system: unchanged; the dark rules follow `prefers-color-scheme`.
 *  - light:  the dark blocks are removed.
 *  - dark:   the dark blocks are unwrapped, so they always apply. They sit
 *            after the light rules they override, so source order still wins.
 *
 * Pure string work on our own bundled CSS; nothing here comes from the page.
 */
export function themedCss(css: string, theme: Theme): string {
  if (theme !== 'light' && theme !== 'dark') return css;
  let out = '';
  let cursor = 0;
  DARK_BLOCK.lastIndex = 0;
  for (let match = DARK_BLOCK.exec(css); match; match = DARK_BLOCK.exec(css)) {
    const bodyStart = match.index + match[0].length;
    let depth = 1;
    let i = bodyStart;
    for (; i < css.length && depth > 0; i += 1) {
      if (css[i] === '{') depth += 1;
      else if (css[i] === '}') depth -= 1;
    }
    // i is just past the closing brace of the media block.
    out += css.slice(cursor, match.index);
    if (theme === 'dark') out += css.slice(bodyStart, i - 1);
    cursor = i;
    DARK_BLOCK.lastIndex = i;
  }
  return out + css.slice(cursor);
}
