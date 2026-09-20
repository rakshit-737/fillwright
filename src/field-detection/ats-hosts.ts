/**
 * Applicant-tracking domains. One list, used both to recognise an application
 * page and to build the "Job sites only" site-access tier, so the two can
 * never disagree.
 */
export const ATS_DOMAINS: readonly string[] = [
  'greenhouse.io',
  'lever.co',
  'ashbyhq.com',
  'myworkdayjobs.com',
  'workday.com',
  'smartrecruiters.com',
  'icims.com',
  'taleo.net',
  'workable.com',
  'jobvite.com',
  'bamboohr.com',
  'recruitee.com',
  'breezy.hr',
  'jazzhr.com',
  'teamtailor.com',
  'personio.de',
  'personio.com',
];

/** True when the URL's host is one of the ATS domains or a subdomain of one. */
export function isAtsHost(url: string): boolean {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return false;
  }
  return ATS_DOMAINS.some((domain) => host === domain || host.endsWith(`.${domain}`));
}
