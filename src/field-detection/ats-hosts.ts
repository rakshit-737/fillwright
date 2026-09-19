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

const ATS_HOST_PATTERN = new RegExp(
  `(?:${ATS_DOMAINS.map((domain) => domain.replace(/\./g, '\\.')).join('|')})`,
);

export function isAtsHost(url: string): boolean {
  return ATS_HOST_PATTERN.test(url);
}
