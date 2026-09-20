// Runs the accuracy evaluation (tests/corpus/eval.run.ts).
//   npm run eval                       report, and fail below the baseline
//   npm run eval -- --update-baseline  rewrite tests/corpus/baseline.json
import { spawnSync } from 'node:child_process';

const update = process.argv.includes('--update-baseline');
const result = spawnSync('npx', ['vitest', 'run', '--config', 'vitest.eval.config.ts'], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
  env: { ...process.env, EVAL_UPDATE_BASELINE: update ? '1' : '0' },
});
process.exit(result.status ?? 1);
