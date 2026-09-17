/**
 * Job description → profile match.
 *
 * Trust boundary: the posting text is read in the content script (page data,
 * untrusted); matching runs in the worker against the profile's skill names,
 * and only skill names that already appear in the posting are returned.
 *
 * Reads the job posting text that is already visible on the page and reports
 * which skills it mentions that the user's profile does, and does not, contain.
 *
 * What this deliberately does not do:
 *  - it never adds a skill to the profile, or suggests the user claim one;
 *  - it never rewrites an answer to "fit" the posting;
 *  - it never scores the user as a candidate. "Mentioned / in your profile"
 *    is a fact; "you are a 72% match" would be an invented judgement.
 *
 * The posting text is page content and therefore untrusted. It is only ever
 * searched for known terms here — never interpreted, never executed, never
 * sent anywhere.
 */

export interface JobMatch {
  /** Skills the posting mentions that the profile contains. */
  present: string[];
  /** Well-known skills the posting mentions that the profile does not list. */
  missing: string[];
  /** Years of experience the posting asks for, when it states a number. */
  yearsRequired: number | null;
  /** True when the text looked like a job posting at all. */
  looksLikePosting: boolean;
}

/**
 * Terms recognised in a posting even when the profile lacks them, so the
 * "not in your profile" list is useful. Kept to unambiguous technical names:
 * a generic word such as "communication" would match half of every posting
 * and tell the user nothing.
 */
const KNOWN_SKILLS = [
  'Python',
  'Java',
  'JavaScript',
  'TypeScript',
  'Go',
  'Golang',
  'Rust',
  'C++',
  'C#',
  'Ruby',
  'PHP',
  'Kotlin',
  'Swift',
  'Scala',
  'SQL',
  'NoSQL',
  'PostgreSQL',
  'MySQL',
  'MongoDB',
  'Redis',
  'GraphQL',
  'React',
  'Angular',
  'Vue',
  'Next.js',
  'Node.js',
  'Django',
  'Flask',
  'FastAPI',
  'Spring',
  'Express',
  '.NET',
  'HTML',
  'CSS',
  'Tailwind',
  'AWS',
  'Azure',
  'GCP',
  'Docker',
  'Kubernetes',
  'Terraform',
  'Ansible',
  'Linux',
  'Git',
  'CI/CD',
  'Jenkins',
  'Kafka',
  'Spark',
  'Hadoop',
  'Airflow',
  'Snowflake',
  'TensorFlow',
  'PyTorch',
  'scikit-learn',
  'Pandas',
  'NumPy',
  'Machine Learning',
  'Deep Learning',
  'NLP',
  'Computer Vision',
  'LLM',
  'Figma',
  'Tableau',
  'Power BI',
  'Excel',
  'SIEM',
  'Splunk',
  'Wireshark',
  'Burp Suite',
  'Penetration Testing',
  'OWASP',
  'Metasploit',
  'Nmap',
  'Incident Response',
  'Threat Modeling',
];

const POSTING_WORDS =
  /\b(?:responsibilities|requirements|qualifications|what you(?:'|’)ll do|about the role|we(?:'|’)re looking for|nice to have|preferred|you will)\b/i;

const MAX_TEXT = 40_000;

export function matchJobDescription(text: string, profileSkills: string[]): JobMatch {
  const posting = text.slice(0, MAX_TEXT);
  const looksLikePosting = POSTING_WORDS.test(posting);

  const present = new Map<string, string>();
  for (const skill of profileSkills) {
    const name = skill.trim();
    if (name.length < 1 || name.length > 60) continue;
    if (mentions(posting, name)) present.set(canonical(name), name);
  }

  const missing = new Map<string, string>();
  for (const skill of KNOWN_SKILLS) {
    const key = canonical(skill);
    if (present.has(key) || missing.has(key)) continue;
    if (profileSkills.some((own) => canonical(own) === key)) continue;
    if (mentions(posting, skill)) missing.set(key, skill);
  }

  return {
    present: [...present.values()].slice(0, 40),
    missing: [...missing.values()].slice(0, 20),
    yearsRequired: yearsFrom(posting),
    looksLikePosting,
  };
}

/** Whole-term, case-insensitive match that copes with C++, C#, Node.js. */
export function mentions(text: string, term: string): boolean {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // "Go" is also an English word, so it has to appear in a capitalised form.
  const flags = /^go$/i.test(term) ? '' : 'i';
  const pattern = new RegExp(`(?:^|[^A-Za-z0-9+#])${escaped}(?![A-Za-z0-9+#])`, flags);
  return pattern.test(text);
}

function canonical(term: string): string {
  const lower = term.trim().toLowerCase();
  const aliases: Record<string, string> = {
    golang: 'go',
    node: 'node.js',
    nodejs: 'node.js',
    reactjs: 'react',
    'react.js': 'react',
    postgres: 'postgresql',
    k8s: 'kubernetes',
    'vue.js': 'vue',
    ml: 'machine learning',
  };
  return aliases[lower] ?? lower;
}

function yearsFrom(text: string): number | null {
  const match = text.match(
    /\b(\d{1,2})\s*\+?\s*(?:or more\s+)?years?(?:\s+of)?\s+(?:\w+\s+){0,3}experience\b/i,
  );
  if (!match) return null;
  const years = Number(match[1]);
  return years > 0 && years < 40 ? years : null;
}

/**
 * Pulls the posting text from the page. Form controls and Fillwright's own UI
 * are excluded, so what the user typed into the form is never part of it.
 */
export function collectPostingText(doc: Document): string {
  const candidates = Array.from(
    doc.querySelectorAll<HTMLElement>(
      '[class*="description" i], [id*="description" i], [data-automation-id*="jobPostingDescription"], article, main',
    ),
  ).filter((node) => !node.closest('[data-fillwright-ui]') && !node.closest('form'));

  const source = candidates.sort(
    (a, b) => (b.textContent?.length ?? 0) - (a.textContent?.length ?? 0),
  )[0];
  return (source?.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT);
}
