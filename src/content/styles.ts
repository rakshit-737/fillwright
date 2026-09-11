/**
 * Styles for the on-page panel, as a string injected into its shadow root.
 *
 * Kept separate from the extension's other stylesheets because it must be
 * entirely self-contained: no custom properties inherited from the page, no
 * external font, and every value spelled out so a page's `* { }` rule cannot
 * change how the panel reads.
 */
export const WIDGET_CSS = `
  :host, * { box-sizing: border-box; }

  .fw-widget {
    position: fixed;
    right: 20px;
    bottom: 20px;
    width: 340px;
    max-width: calc(100vw - 32px);
    max-height: calc(100vh - 40px);
    font-family: ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
    font-size: 13px;
    line-height: 1.5;
    color: #16151a;
    animation: fw-in 180ms cubic-bezier(0.2, 0, 0.13, 1);
  }

  .fw-widget[data-reduced-motion='true'] { animation: none; }
  @media (prefers-reduced-motion: reduce) { .fw-widget { animation: none; } }

  @keyframes fw-in {
    from { opacity: 0; transform: translateY(8px); }
    to   { opacity: 1; transform: none; }
  }

  .fw-card {
    display: flex;
    flex-direction: column;
    max-height: calc(100vh - 40px);
    background: #ffffff;
    border: 1px solid #e6e3de;
    border-radius: 14px;
    box-shadow: 0 12px 32px rgba(20, 18, 30, 0.16), 0 2px 8px rgba(20, 18, 30, 0.08);
    overflow: hidden;
  }

  .fw-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 14px;
    border-bottom: 1px solid #e6e3de;
    background: #fbfaf8;
    flex: none;
  }

  .fw-brand { display: flex; align-items: center; gap: 8px; }

  .fw-mark {
    width: 16px; height: 16px; border-radius: 5px;
    background: linear-gradient(135deg, #4b3ecf, #c2629a);
    flex: none;
  }

  .fw-title { font-weight: 600; font-size: 13px; letter-spacing: -0.01em; }

  .fw-close {
    width: 24px; height: 24px;
    border: none; background: none; cursor: pointer;
    color: #56545e; font-size: 18px; line-height: 1;
    border-radius: 6px;
  }
  .fw-close:hover { background: #f4f2ef; color: #16151a; }

  .fw-body {
    padding: 14px;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .fw-summary { display: flex; gap: 16px; flex-wrap: wrap; }

  .fw-stat { display: flex; flex-direction: column; }
  .fw-stat__value { font-size: 20px; font-weight: 600; font-variant-numeric: tabular-nums; }
  .fw-stat__label { font-size: 11px; color: #8b8892; }
  .fw-stat--ok .fw-stat__value { color: #1f7a4d; }
  .fw-stat--caution .fw-stat__value { color: #9a6209; }

  .fw-list {
    list-style: none; margin: 0; padding: 0;
    display: flex; flex-direction: column; gap: 2px;
    max-height: 300px; overflow-y: auto;
  }

  .fw-item { border-radius: 8px; }
  .fw-item:hover { background: #f4f2ef; }

  .fw-item__row {
    display: flex; align-items: flex-start; gap: 8px;
    padding: 7px 8px; cursor: pointer;
  }

  .fw-check { width: 14px; height: 14px; margin-top: 2px; flex: none; accent-color: #4b3ecf; }
  .fw-check--spacer { display: inline-block; }

  .fw-item__text { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }

  .fw-item__label {
    font-size: 12px; font-weight: 500;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }

  .fw-item__value { font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .fw-item__old { color: #8b8892; text-decoration: line-through; }
  .fw-item__arrow { color: #8b8892; }
  .fw-item__new { color: #4b3ecf; font-weight: 500; }
  .fw-item__status { font-size: 11px; color: #8b8892; }

  .fw-badge {
    flex: none; padding: 1px 7px; border-radius: 999px;
    font-size: 10px; font-weight: 600; white-space: nowrap;
    align-self: center;
  }
  .fw-badge--ok { background: #e6f4ec; color: #1f7a4d; }
  .fw-badge--caution { background: #fdf1dd; color: #9a6209; }
  .fw-badge--muted { background: #f4f2ef; color: #8b8892; }

  .fw-actions { display: flex; gap: 8px; }

  .fw-btn {
    flex: 1;
    min-height: 34px; padding: 0 12px;
    border-radius: 9px; border: 1px solid #d4d0c9;
    background: #ffffff; color: #16151a;
    font-family: inherit; font-size: 12px; font-weight: 600;
    cursor: pointer;
  }
  .fw-btn:hover { background: #f4f2ef; }
  .fw-btn--primary { background: #4b3ecf; border-color: #4b3ecf; color: #ffffff; }
  .fw-btn--primary:hover { background: #3f33b4; }
  .fw-btn[disabled] { opacity: 0.5; cursor: not-allowed; }
  .fw-btn:focus-visible { outline: none; box-shadow: 0 0 0 2px #ffffff, 0 0 0 4px #4b3ecf; }

  .fw-muted { color: #56545e; font-size: 12px; margin: 0; }
  .fw-note { color: #8b8892; font-size: 11px; margin: 0; line-height: 1.45; }
  .fw-error { color: #b3261e; font-size: 12px; margin: 0; }
  .fw-done { font-size: 13px; font-weight: 600; color: #1f7a4d; margin: 0; }

  @media (prefers-color-scheme: dark) {
    .fw-widget { color: #f2f0f4; }
    .fw-card { background: #1a191f; border-color: #2c2a34; }
    .fw-header { background: #22212a; border-color: #2c2a34; }
    .fw-close { color: #a8a5b1; }
    .fw-close:hover { background: #2c2a34; color: #f2f0f4; }
    .fw-item:hover { background: #22212a; }
    .fw-stat__label, .fw-item__status, .fw-note, .fw-item__old, .fw-item__arrow { color: #77737f; }
    .fw-muted { color: #a8a5b1; }
    .fw-item__new { color: #9a90ff; }
    .fw-btn { background: #22212a; border-color: #3b3845; color: #f2f0f4; }
    .fw-btn:hover { background: #2c2a34; }
    .fw-btn--primary { background: #9a90ff; border-color: #9a90ff; color: #16151a; }
    .fw-btn--primary:hover { background: #ada4ff; }
    .fw-badge--ok { background: #17291f; color: #5fd39a; }
    .fw-badge--caution { background: #2c2314; color: #eab765; }
    .fw-badge--muted { background: #2c2a34; color: #a8a5b1; }
    .fw-stat--ok .fw-stat__value { color: #5fd39a; }
    .fw-stat--caution .fw-stat__value { color: #eab765; }
    .fw-done { color: #5fd39a; }
    .fw-error { color: #f28b82; }
  }

  .fw-item__labelrow { display: flex; align-items: center; gap: 6px; min-width: 0; }
  .fw-item__label { cursor: pointer; }

  .fw-chip {
    flex: none;
    padding: 0 5px;
    border-radius: 4px;
    background: #ecebfb;
    color: #4b3ecf;
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }

  .fw-item__meta { flex: none; align-self: center; }

  .fw-item__tools {
    display: flex;
    gap: 12px;
    padding: 0 8px 7px 30px;
  }

  .fw-link {
    padding: 0;
    border: none;
    background: none;
    color: #4b3ecf;
    font: inherit;
    font-size: 11px;
    text-decoration: underline;
    text-underline-offset: 2px;
    cursor: pointer;
  }
  .fw-link:hover { color: #3f33b4; }
  .fw-link:focus-visible { outline: none; box-shadow: 0 0 0 2px #ffffff, 0 0 0 4px #4b3ecf; border-radius: 3px; }

  .fw-why {
    margin: 0;
    padding: 0 8px 9px 30px;
    font-size: 11px;
    line-height: 1.5;
    color: #56545e;
  }

  .fw-teach {
    margin: 0 8px 9px 30px;
    padding: 10px;
    border: 1px solid #e6e3de;
    border-radius: 8px;
    background: #fbfaf8;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .fw-teach__lead { margin: 0; font-size: 12px; font-weight: 600; }

  .fw-teach__select {
    width: 100%;
    padding: 5px 7px;
    font: inherit;
    font-size: 12px;
    border: 1px solid #d4d0c9;
    border-radius: 6px;
    background: #fff;
    color: inherit;
  }

  .fw-teach__remember {
    display: flex;
    align-items: center;
    gap: 7px;
    font-size: 11px;
    color: #56545e;
    cursor: pointer;
  }

  .fw-teach__actions { display: flex; }

  .fw-btn--sm { min-height: 28px; font-size: 11px; flex: 0 0 auto; padding: 0 14px; }

  @media (prefers-color-scheme: dark) {
    .fw-chip { background: #232043; color: #9a90ff; }
    .fw-link { color: #9a90ff; }
    .fw-link:hover { color: #ada4ff; }
    .fw-why { color: #a8a5b1; }
    .fw-teach { background: #22212a; border-color: #2c2a34; }
    .fw-teach__select { background: #1a191f; border-color: #3b3845; }
    .fw-teach__remember { color: #a8a5b1; }
  }

  .fw-diag {
    margin: 0 8px 9px 30px;
    padding: 9px 10px;
    border: 1px dashed #d4d0c9;
    border-radius: 7px;
    background: #fbfaf8;
  }

  .fw-diag__head {
    margin: 0 0 6px;
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    color: #8b8892;
  }

  .fw-diag__list {
    margin: 0;
    display: grid;
    grid-template-columns: 84px minmax(0, 1fr);
    gap: 2px 8px;
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 10px;
    line-height: 1.45;
  }

  .fw-diag__key { color: #8b8892; }
  .fw-diag__value { margin: 0; color: #16151a; overflow-wrap: anywhere; }

  @media (prefers-color-scheme: dark) {
    .fw-diag { background: #22212a; border-color: #3b3845; }
    .fw-diag__value { color: #f2f0f4; }
  }

  @media (max-width: 420px) {
    .fw-widget { right: 12px; left: 12px; bottom: 12px; width: auto; }
  }
`;
