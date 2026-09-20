import { FillwrightWidget } from './widget';

/**
 * The panel bundle's entry point: `dist/panel.js`.
 *
 * The on-page panel — its markup, its stylesheet and the review list — is the
 * larger half of the content script, and a page that is never asked about
 * never needs any of it. So it is built as a second self-contained IIFE and
 * injected into this frame only when the panel is first opened (the content
 * script asks the worker, which calls `chrome.scripting.executeScript`).
 *
 * Trust boundary: identical to content.js — the same isolated world in the
 * same page. It publishes exactly one thing, the widget constructor, on the
 * isolated world's global, where only Fillwright's own code can see it.
 */
export type PanelExports = { FillwrightWidget: typeof FillwrightWidget };

const scope = globalThis as typeof globalThis & { __fillwrightPanel?: PanelExports };
scope.__fillwrightPanel ??= { FillwrightWidget };

export {};
