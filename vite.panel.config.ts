import { defineConfig } from 'vite';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));

/**
 * The panel bundle (`dist/panel.js`), built like the content script: one
 * self-contained IIFE, because chrome.scripting.executeScript cannot load ES
 * modules and a single file keeps the injected surface auditable.
 *
 * It exists so the page only pays for the panel when the user opens it; see
 * src/content/panel-entry.ts.
 */
export default defineConfig({
  root,
  publicDir: false,
  resolve: { alias: { '@': resolve(root, 'src') } },
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    sourcemap: false,
    target: 'chrome116',
    cssCodeSplit: false,
    lib: {
      entry: resolve(root, 'src/content/panel-entry.ts'),
      formats: ['iife'],
      name: '__fillwrightPanel__',
      fileName: () => 'panel.js',
    },
    rollupOptions: {
      output: { assetFileNames: 'panel.css', extend: true },
    },
  },
});
