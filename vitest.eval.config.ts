import { defineConfig } from 'vitest/config';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));

// Accuracy evaluation over the invented corpus in tests/corpus. Kept out of
// `npm test` so its report is readable; run it with `npm run eval`.
export default defineConfig({
  resolve: { alias: { '@': resolve(root, 'src') } },
  test: {
    environment: 'node',
    include: ['tests/corpus/eval.run.ts'],
    reporters: ['default'],
  },
});
