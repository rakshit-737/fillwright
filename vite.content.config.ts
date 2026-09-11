import { defineConfig } from 'vite';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));

/**
 * The content script is built separately as a single self-contained IIFE:
 * chrome.scripting.executeScript cannot load ES modules with imports, and a
 * one-file bundle keeps the injected surface auditable.
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
      entry: resolve(root, 'src/content/index.ts'),
      formats: ['iife'],
      name: '__fillwright__',
      fileName: () => 'content.js',
    },
    rollupOptions: {
      output: { assetFileNames: 'content.css', extend: true },
    },
  },
});
