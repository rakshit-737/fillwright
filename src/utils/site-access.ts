import { ATS_DOMAINS } from '@/field-detection/ats-hosts';

/**
 * Site-access tiers for Assist and Smart.
 *
 * Every pattern here is a subset of the manifest's optional host permissions,
 * so Chrome can grant it at runtime without a manifest change:
 * - "Job sites only" (default): the applicant-tracking domains.
 * - "This site": one origin, from the popup.
 * - "All sites": every https page — a second, explicit step.
 */
export const ALL_SITES = 'https://*/*';

/** `https://*.d/*` also matches the bare domain `d`. */
export const ATS_ORIGINS: readonly string[] = ATS_DOMAINS.map((domain) => `https://*.${domain}/*`);

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1']);

/** The pattern for the one host a page lives on, or null if it cannot be granted. */
export function originPatternFor(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol === 'https:' && parsed.hostname) return `https://${parsed.hostname}/*`;
  if (parsed.protocol === 'http:' && LOCAL_HOSTS.has(parsed.hostname)) {
    return `http://${parsed.hostname}/*`;
  }
  return null;
}

/** Granted origins the content script may be registered for. */
export function registrableOrigins(origins: readonly string[]): string[] {
  return origins.filter(
    (origin) =>
      origin.startsWith('https://') ||
      origin === 'http://localhost/*' ||
      origin === 'http://127.0.0.1/*',
  );
}

/** Site origins currently granted, as Chrome reports them. */
export async function grantedSiteOrigins(): Promise<string[]> {
  try {
    const all = await chrome.permissions.getAll();
    return registrableOrigins(all.origins ?? []);
  } catch {
    return [];
  }
}

/** Human-readable name for a granted pattern. */
export function describeOrigin(origin: string): string {
  if (origin === ALL_SITES) return 'All https sites';
  return origin
    .replace(/^https:\/\//, '')
    .replace(/\/\*$/, '')
    .replace(/^\*\./, 'any site on ');
}
