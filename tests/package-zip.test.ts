// @vitest-environment node
/// <reference types="node" />
import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { unzipSync, strFromU8 } from 'fflate';
// @ts-expect-error -- plain ESM build script without type declarations
import { buildZip, resolveEpoch } from '../scripts/lib/zip.mjs';

const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
const files = [
  { name: 'b/two.js', data: Buffer.from('console.info(2)') },
  { name: 'a.json', data: Buffer.from('{"a":1}') },
  { name: 'manifest.json', data: Buffer.from('{}') },
];

describe('deterministic release zip', () => {
  it('produces identical bytes regardless of entry order or wall clock', () => {
    const one = buildZip(files, 1_700_000_000);
    const two = buildZip([...files].reverse(), 1_700_000_000);
    expect(sha(one)).toBe(sha(two));
  });

  it('stores entries sorted, with the given timestamp, and round-trips', () => {
    const zip = buildZip(files, 1_700_000_000);
    const out = unzipSync(zip);
    expect(Object.keys(out)).toEqual(['a.json', 'b/two.js', 'manifest.json']);
    expect(strFromU8(out['b/two.js']!)).toBe('console.info(2)');
    // 2023-11-14 22:13:20 UTC, as DOS time, in the first local header.
    const view = Buffer.from(zip);
    expect(view.readUInt16LE(12)).toBe(((2023 - 1980) << 9) | (11 << 5) | 14);
    expect(view.readUInt16LE(10)).toBe((22 << 11) | (13 << 5) | 10);
  });

  it('changes when the timestamp changes', () => {
    expect(sha(buildZip(files, 1_700_000_000))).not.toBe(sha(buildZip(files, 1_600_000_000)));
  });

  it('takes the epoch from SOURCE_DATE_EPOCH, then the last commit time', () => {
    expect(resolveEpoch({ SOURCE_DATE_EPOCH: '1700000000' }, () => '1')).toBe(1_700_000_000);
    expect(resolveEpoch({}, () => '1600000000\n')).toBe(1_600_000_000);
    expect(() => resolveEpoch({ SOURCE_DATE_EPOCH: 'soon' }, () => '1')).toThrow();
    expect(() => resolveEpoch({}, () => '')).toThrow();
  });
});
