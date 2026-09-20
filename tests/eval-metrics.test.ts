import { describe, expect, it } from 'vitest';
import {
  compareToBaseline,
  emptyScore,
  sameValue,
  scoreClassification,
  scoreList,
  scoreScalar,
  toMetric,
} from './corpus/metrics';

describe('accuracy metrics', () => {
  it('computes precision and recall per field, with unknown as a class', () => {
    const { perField, confusions } = scoreClassification([
      { expected: 'personal.email', actual: 'personal.email' },
      { expected: 'personal.email', actual: 'unknown' },
      { expected: 'unknown', actual: 'personal.phone' },
      { expected: 'personal.phone', actual: 'personal.phone' },
    ]);
    expect(toMetric(perField['personal.email']!)).toEqual({
      precision: 1,
      recall: 0.5,
      support: 2,
    });
    expect(toMetric(perField['personal.phone']!)).toEqual({
      precision: 0.5,
      recall: 1,
      support: 1,
    });
    expect(confusions).toHaveLength(2);
  });

  it('matches values loosely but not by coincidence', () => {
    expect(sameValue('B.E.', 'B.E. in Electronics')).toBe(true);
    expect(sameValue('Anna University', 'anna university')).toBe(true);
    expect(sameValue('C', 'CSS')).toBe(false);
    expect(sameValue('Go', 'Google')).toBe(false);
  });

  it('scores scalars and lists', () => {
    const score = emptyScore();
    scoreScalar(score, 'Priya', 'Priya');
    scoreScalar(score, 'Natarajan', '');
    scoreScalar(score, '', 'Guess');
    expect(score).toEqual({ tp: 1, fp: 1, fn: 1 });

    const list = emptyScore();
    scoreList(list, ['Java', 'Docker', 'Redis'], ['Java', 'Redis', 'Kafka']);
    expect(list).toEqual({ tp: 2, fp: 1, fn: 1 });
  });

  it('fails on any drop below the baseline and nothing else', () => {
    const baseline = { a: { precision: 0.9, recall: 0.8 }, b: { precision: 1, recall: 1 } };
    const ok = compareToBaseline(
      {
        a: { precision: 0.95, recall: 0.8, support: 3 },
        b: { precision: 1, recall: 1, support: 1 },
      },
      baseline,
    );
    expect(ok.regressions).toEqual([]);
    const bad = compareToBaseline({ a: { precision: 0.9, recall: 0.7, support: 3 } }, baseline);
    expect(bad.regressions).toEqual(['a: recall 0.7 < baseline 0.8']);
    expect(bad.missing).toEqual(['b']);
  });
});
