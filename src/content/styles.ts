import css from './panel.css?inline';

/**
 * The panel stylesheet as a string, for the shadow root.
 *
 * Trust boundary: static, bundled CSS; nothing here comes from the page.
 */
export const WIDGET_CSS: string = css;
