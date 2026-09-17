import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { copyFileSync, mkdirSync, existsSync } from 'node:fs';

const root = dirname(fileURLToPath(import.meta.url));

/**
 * pdf.js needs its worker as a separate top-level file. We copy the packaged
 * worker into dist/ so it is loaded from the extension origin — never a CDN.
 */
function copyPdfWorker() {
  return {
    name: 'fillwright-copy-pdf-worker',
    closeBundle() {
      const src = resolve(root, 'node_modules/pdfjs-dist/build/pdf.worker.min.mjs');
      const outDir = resolve(root, 'dist');
      if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
      if (existsSync(src)) copyFileSync(src, resolve(outDir, 'pdf.worker.min.mjs'));
      else console.warn('[fillwright] pdf.worker.min.mjs not found; PDF import will be disabled.');
    },
  };
}

export default defineConfig({
  root,
  publicDir: resolve(root, 'public'),
  resolve: { alias: { '@': resolve(root, 'src') } },
  plugins: [react(), copyPdfWorker()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: false,
    target: 'chrome116',
    rollupOptions: {
      input: {
        popup: resolve(root, 'popup.html'),
        options: resolve(root, 'options.html'),
        practice: resolve(root, 'practice.html'),
        background: resolve(root, 'src/background/index.ts'),
      },
      output: {
        entryFileNames: (chunk) => (chunk.name === 'background' ? 'background.js' : 'assets/[name].js'),
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name][extname]',
      },
    },
  },
});
