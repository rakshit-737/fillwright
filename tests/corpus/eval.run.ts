/// <reference types="node" />
/**
 * Accuracy evaluation: runs the classifier over tests/corpus/fields.json and
 * the resume parser over tests/corpus/resumes, prints per-field precision and
 * recall with a confusion list, and fails when any metric drops below
 * tests/corpus/baseline.json.
 *
 * Run with `npm run eval`. After an intended improvement, refresh the floor
 * with `npm run eval -- --update-baseline` and commit the new baseline.
 */
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { classifyField } from '@/field-detection/classify';
import { parseResume } from '@/parser';
import type { FieldSignals } from '@/types/fields';
import {
  compareToBaseline,
  digitsOnly,
  emptyScore,
  scoreClassification,
  scoreList,
  scoreScalar,
  toMetric,
  type Baseline,
  type Metric,
  type Score,
} from './metrics';

const here = dirname(fileURLToPath(import.meta.url));
const BASELINE = join(here, 'baseline.json');
const out = (line = '') => process.stdout.write(`${line}\n`);
const pct = (n: number) => `${(n * 100).toFixed(1)}%`.padStart(7);

interface FieldCase {
  id: string;
  expected: string;
  source: string;
  signals: FieldSignals;
}

interface ExpectedResume {
  layout: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  education: Array<{ institution: string; degree: string; gpa: string }>;
  experience: Array<{ company: string; title: string }>;
  skills: string[];
}

function evaluateFields(): Record<string, Metric> {
  const cases = JSON.parse(readFileSync(join(here, 'fields.json'), 'utf8')) as FieldCase[];
  const results = cases.map((c) => ({
    expected: c.expected,
    actual: classifyField(c.signals).field,
  }));
  const { perField, confusions } = scoreClassification(results);

  out(`\nField classifier — ${cases.length} labelled fields`);
  out(`${'field'.padEnd(36)}precision  recall  support`);
  const metrics: Record<string, Metric> = {};
  for (const field of Object.keys(perField).sort()) {
    const m = toMetric(perField[field]!);
    metrics[`field:${field}`] = m;
    out(
      `${field.padEnd(36)}${pct(m.precision)}  ${pct(m.recall)}  ${String(m.support).padStart(7)}`,
    );
  }
  const correct = results.filter((r) => r.expected === r.actual).length;
  out(`accuracy ${pct(correct / results.length)} (${correct}/${results.length})`);
  metrics['field:*accuracy'] = {
    precision: toMetric({ tp: correct, fp: results.length - correct, fn: 0 }).precision,
    recall: 1,
    support: results.length,
  };

  out('\nConfusions (expected -> actual, count)');
  if (confusions.length === 0) out('  none');
  for (const c of confusions) out(`  ${c.expected} -> ${c.actual}  x${c.count}`);
  return metrics;
}

function evaluateResumes(): Record<string, Metric> {
  const dir = join(here, 'resumes');
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.txt'))
    .sort();
  const keys = [
    'firstName',
    'lastName',
    'email',
    'phone',
    'institution',
    'degree',
    'gpa',
    'company',
    'title',
    'skills',
  ];
  const totals: Record<string, Score> = Object.fromEntries(keys.map((k) => [k, emptyScore()]));
  const misses: string[] = [];

  for (const file of files) {
    const text = readFileSync(join(dir, file), 'utf8');
    const want = JSON.parse(
      readFileSync(join(dir, file.replace(/\.txt$/, '.expected.json')), 'utf8'),
    ) as ExpectedResume;
    const got = parseResume(text);
    const before = JSON.stringify(totals);

    scoreScalar(totals.firstName!, want.firstName, got.contact.firstName.value);
    scoreScalar(totals.lastName!, want.lastName, got.contact.lastName.value);
    scoreScalar(totals.email!, want.email, got.contact.email.value);
    scoreScalar(
      totals.phone!,
      want.phone,
      got.contact.phone.value,
      (a, b) => digitsOnly(a).endsWith(digitsOnly(b)) || digitsOnly(b).endsWith(digitsOnly(a)),
    );
    scoreList(
      totals.institution!,
      want.education.map((e) => e.institution),
      got.education.map((e) => e.institution),
    );
    scoreList(
      totals.degree!,
      want.education.map((e) => e.degree),
      got.education.map((e) => e.degree),
    );
    scoreList(
      totals.gpa!,
      want.education.map((e) => e.gpa),
      got.education.map((e) => e.gpa),
    );
    scoreList(
      totals.company!,
      want.experience.map((e) => e.company),
      got.experience.map((e) => e.company),
    );
    scoreList(
      totals.title!,
      want.experience.map((e) => e.title),
      got.experience.map((e) => e.title),
    );
    scoreList(
      totals.skills!,
      want.skills,
      got.skills.map((s) => s.name),
    );

    if (
      JSON.stringify(totals)
        .match(/"f[pn]":\d+/g)
        ?.join() !== before.match(/"f[pn]":\d+/g)?.join()
    ) {
      misses.push(`${file} (${want.layout})`);
    }
  }

  out(`\nResume parser — ${files.length} resumes`);
  out(`${'field'.padEnd(36)}precision  recall  support`);
  const metrics: Record<string, Metric> = {};
  for (const key of keys) {
    const m = toMetric(totals[key]!);
    metrics[`resume:${key}`] = m;
    out(`${key.padEnd(36)}${pct(m.precision)}  ${pct(m.recall)}  ${String(m.support).padStart(7)}`);
  }
  out('\nResumes with at least one miss');
  for (const miss of misses) out(`  ${miss}`);
  return metrics;
}

it('meets the committed accuracy baseline', () => {
  const current = { ...evaluateFields(), ...evaluateResumes() };

  if (process.env.EVAL_UPDATE_BASELINE === '1') {
    const baseline: Baseline = {};
    for (const key of Object.keys(current).sort()) {
      baseline[key] = { precision: current[key]!.precision, recall: current[key]!.recall };
    }
    writeFileSync(BASELINE, `${JSON.stringify(baseline, null, 2)}\n`);
    out(`\nBaseline written to ${BASELINE}`);
    return;
  }

  expect(existsSync(BASELINE), 'tests/corpus/baseline.json is missing').toBe(true);
  const baseline = JSON.parse(readFileSync(BASELINE, 'utf8')) as Baseline;
  const { regressions, missing } = compareToBaseline(current, baseline);
  for (const key of missing) out(`note: ${key} is in the baseline but no longer measured`);
  const improved = Object.keys(current).filter(
    (key) =>
      baseline[key] &&
      (current[key]!.precision > baseline[key]!.precision ||
        current[key]!.recall > baseline[key]!.recall),
  );
  if (improved.length) {
    out(`\nImproved over baseline: ${improved.join(', ')}`);
    out('Run `npm run eval -- --update-baseline` and commit the result to lock the gain in.');
  }
  expect(regressions, 'accuracy fell below tests/corpus/baseline.json').toEqual([]);
  expect(missing, 'a baselined metric is no longer measured').toEqual([]);
});
