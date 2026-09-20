import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { validateScan } from '@/security/scan-guard';
import { conformProfile } from '@/profile/portable';
import { normalizeLabel } from '@/field-detection/normalize';
import { matchOption } from '@/autofill/resolve';
import type { FieldOption } from '@/types/fields';

// Property tests: whatever a hostile page or a hand-edited import throws at
// these boundaries, they return something bounded and never throw.

const RUNS = { numRuns: 300 };
const anyJson = fc.anything({ maxDepth: 4, withNullPrototype: true, withBigInt: false });

const fieldLike = fc.record(
  {
    id: fc.oneof(fc.string({ maxLength: 100 }), anyJson),
    kind: fc.oneof(fc.constantFrom('text', 'select', 'radio-group', 'bogus'), anyJson),
    signals: fc.oneof(
      fc.dictionary(
        fc.string({ maxLength: 20 }),
        fc.oneof(fc.string({ maxLength: 2_000 }), anyJson),
      ),
      anyJson,
    ),
    options: fc.oneof(
      fc.array(fc.record({ value: fc.string(), label: fc.string() }), { maxLength: 250 }),
      anyJson,
    ),
    currentValue: fc.oneof(fc.string({ maxLength: 8_000 }), anyJson),
    order: anyJson,
  },
  { requiredKeys: [] },
);

describe('property: validateScan', () => {
  it('never throws and caps everything it lets through', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          anyJson,
          fc.record({
            fields: fc.array(fc.oneof(fieldLike, anyJson), { maxLength: 60 }),
            url: anyJson,
          }),
        ),
        (input) => {
          const result = validateScan(input);
          if (!result.ok) {
            expect(typeof result.error).toBe('string');
            return;
          }
          expect(result.scan.fields.length).toBeLessThanOrEqual(400);
          for (const field of result.scan.fields) {
            expect(field.id.length).toBeLessThanOrEqual(64);
            expect(field.options.length).toBeLessThanOrEqual(200);
            expect(field.currentValue.length).toBeLessThanOrEqual(5_000);
            for (const value of Object.values(field.signals)) {
              if (typeof value === 'string') expect(value.length).toBeLessThanOrEqual(5_000);
            }
          }
        },
      ),
      RUNS,
    );
  });
});

describe('property: conformProfile', () => {
  it('never throws and always returns a profile of the expected shape', () => {
    fc.assert(
      fc.property(fc.dictionary(fc.string({ maxLength: 30 }), anyJson), (raw) => {
        const profile = conformProfile(raw);
        expect(typeof profile.id).toBe('string');
        expect(Array.isArray(profile.resumeIds)).toBe(true);
        expect(profile.resumeIds).toHaveLength(0);
        expect(JSON.stringify(profile).length).toBeLessThan(5_000_000);
      }),
      RUNS,
    );
  });
});

describe('property: normalizeLabel', () => {
  it('never throws and returns a short, trimmed, lower-case string', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 2_000, unit: 'grapheme' }), (raw) => {
        const out = normalizeLabel(raw);
        expect(typeof out).toBe('string');
        expect(out).toBe(out.trim());
        expect(out).toBe(out.toLowerCase());
        expect(out.length).toBeLessThanOrEqual(raw.length * 3 + 32);
      }),
      RUNS,
    );
  });
});

describe('property: matchOption', () => {
  it('never throws and only ever returns one of the options it was given', () => {
    const option = fc.record({
      value: fc.string({ maxLength: 60 }),
      label: fc.string({ maxLength: 60 }),
    });
    fc.assert(
      fc.property(
        fc.string({ maxLength: 80 }),
        fc.array(option, { maxLength: 60 }),
        (value, options: FieldOption[]) => {
          const match = matchOption(value, options);
          if (match === null) return;
          expect(options).toContain(match.option);
          expect(match.confidence).toBeGreaterThanOrEqual(0);
          expect(match.confidence).toBeLessThanOrEqual(1);
        },
      ),
      RUNS,
    );
  });
});
