import { defineConfig } from 'vitest/config';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: { alias: { '@': resolve(root, 'src') } },
  test: {
    globals: true,
    environment: 'jsdom',
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    setupFiles: ['tests/setup.ts'],
    // `npm run test:coverage`. Thresholds sit just under today's numbers for
    // the modules that decide what gets filled; raise them as coverage grows,
    // never lower them to make a change pass.
    coverage: {
      provider: 'v8',
      include: ['src/autofill/**', 'src/field-detection/**', 'src/security/**', 'src/parser/**'],
      reporter: ['text-summary', 'text'],
      thresholds: {
        'src/autofill/**': { statements: 75, branches: 65, functions: 87, lines: 76 },
        'src/field-detection/**': { statements: 87, branches: 77, functions: 88, lines: 90 },
        'src/security/**': { statements: 56, branches: 61, functions: 62, lines: 59 },
        'src/parser/**': { statements: 72, branches: 55, functions: 80, lines: 78 },
      },
    },
  },
});
