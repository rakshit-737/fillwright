/**
 * Deterministic ZIP writer for the release package.
 *
 * Trust boundary: a developer/CI tool. Nothing here ships in the extension.
 *
 * The same inputs always give the same bytes: entries are sorted by name, every
 * entry carries one fixed timestamp (UTC, never the wall clock or local zone),
 * and deflate runs with fixed settings. "Version made by" is MS-DOS and the
 * external attributes are zero, so the host OS and file modes never leak in.
 * That makes the store package reproducible from a commit, byte for byte.
 */
import { deflateRawSync, crc32, constants } from 'node:zlib';

/** Fixed deflate settings. Changing any of these changes every release hash. */
export const DEFLATE_OPTIONS = Object.freeze({
  level: 9,
  memLevel: 8,
  windowBits: 15,
  strategy: constants.Z_DEFAULT_STRATEGY,
});

/**
 * Seconds since the epoch to stamp on every entry: SOURCE_DATE_EPOCH when set
 * (the reproducible-builds convention), otherwise the last commit's time.
 * `commitTime` returns the output of `git log -1 --format=%ct`.
 */
export function resolveEpoch(env, commitTime) {
  const fromEnv = env.SOURCE_DATE_EPOCH;
  const raw = fromEnv !== undefined && fromEnv !== '' ? fromEnv : String(commitTime() ?? '').trim();
  if (!/^\d+$/.test(raw)) {
    throw new Error(
      `no usable timestamp (SOURCE_DATE_EPOCH or commit time): ${JSON.stringify(raw)}`,
    );
  }
  return Number(raw);
}

/** DOS date/time fields for a UTC timestamp. DOS time cannot go below 1980. */
function dosTime(epochSeconds) {
  const date = new Date(Math.max(epochSeconds, 315532800) * 1000);
  const time =
    ((date.getUTCHours() << 11) | (date.getUTCMinutes() << 5) | (date.getUTCSeconds() >> 1)) &
    0xffff;
  const day =
    (((date.getUTCFullYear() - 1980) << 9) | ((date.getUTCMonth() + 1) << 5) | date.getUTCDate()) &
    0xffff;
  return { time, day };
}

/**
 * @param {{ name: string, data: Uint8Array }[]} files  forward-slash names
 * @param {number} epochSeconds
 * @returns {Buffer}
 */
export function buildZip(files, epochSeconds) {
  const entries = [...files].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const { time, day } = dosTime(epochSeconds);
  const chunks = [];
  const central = [];
  let offset = 0;

  for (const entry of entries) {
    const data = Buffer.from(entry.data);
    const compressed = deflateRawSync(data, DEFLATE_OPTIONS);
    const crc = crc32(data);
    const nameBytes = Buffer.from(entry.name, 'utf8');
    // Bit 11: the name is UTF-8.
    const flags = /[^\x20-\x7e]/.test(entry.name) ? 0x0800 : 0;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(day, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    local.writeUInt16LE(0, 28);
    chunks.push(local, nameBytes, compressed);

    const header = Buffer.alloc(46);
    header.writeUInt32LE(0x02014b50, 0);
    header.writeUInt16LE(20, 4); // made by: MS-DOS, spec 2.0
    header.writeUInt16LE(20, 6);
    header.writeUInt16LE(flags, 8);
    header.writeUInt16LE(8, 10);
    header.writeUInt16LE(time, 12);
    header.writeUInt16LE(day, 14);
    header.writeUInt32LE(crc, 16);
    header.writeUInt32LE(compressed.length, 20);
    header.writeUInt32LE(data.length, 24);
    header.writeUInt16LE(nameBytes.length, 28);
    header.writeUInt32LE(0, 38); // external attributes
    header.writeUInt32LE(offset, 42);
    central.push(header, nameBytes);

    offset += local.length + nameBytes.length + compressed.length;
  }

  const centralBuffer = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBuffer.length, 12);
  end.writeUInt32LE(offset, 16);

  return Buffer.concat([...chunks, centralBuffer, end]);
}
