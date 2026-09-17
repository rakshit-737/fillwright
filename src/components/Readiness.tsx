import { computeCompleteness, type CompletenessSection } from '@/profile/completeness';
import type { Profile } from '@/types/profile';

/**
 * Profile readiness.
 *
 * "87%" tells someone they are incomplete without telling them what to do about
 * it. This lists the sections instead, marks the ones that are holding autofill
 * back, and makes each one a link to the place it gets fixed — so the number is
 * a summary of a checklist rather than a substitute for one.
 */
export function Readiness({
  profile,
  onNavigate,
}: {
  profile: Profile;
  onNavigate: (route: string, anchor?: string) => void;
}) {
  const completeness = computeCompleteness(profile);
  const incomplete = completeness.sections.filter((section) => section.score < 1);

  return (
    <section className="fw-readiness">
      <div className="fw-readiness__head">
        <div>
          <h2 className="fw-readiness__title">Profile readiness</h2>
          <p className="fw-readiness__lead">
            {incomplete.length === 0
              ? 'Everything Fillwright needs is filled in.'
              : `${incomplete.length} ${incomplete.length === 1 ? 'section' : 'sections'} could improve autofill.`}
          </p>
        </div>
        <span className="fw-readiness__pct">{completeness.percent}%</span>
      </div>

      <div
        className="fw-meter"
        role="progressbar"
        aria-valuenow={completeness.percent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Profile readiness"
      >
        <div className="fw-meter__fill" style={{ width: `${completeness.percent}%` }} />
      </div>

      <ul className="fw-readylist">
        {completeness.sections.map((section) => (
          <ReadinessRow key={section.key} section={section} onNavigate={onNavigate} />
        ))}
      </ul>
    </section>
  );
}

function ReadinessRow({
  section,
  onNavigate,
}: {
  section: CompletenessSection;
  onNavigate: (route: string, anchor?: string) => void;
}) {
  const state = section.score >= 1 ? 'done' : section.score > 0 ? 'partial' : 'empty';
  const destination = DESTINATIONS[section.key] ?? { route: 'profile' };

  return (
    <li className={`fw-ready fw-ready--${state}`}>
      <button
        className="fw-ready__button"
        onClick={() => onNavigate(destination.route, destination.anchor)}
      >
        <span className={`fw-ready__mark fw-ready__mark--${state}`} aria-hidden="true">
          {state === 'done' ? '✓' : state === 'partial' ? '•' : '○'}
        </span>
        <span className="fw-ready__text">
          <span className="fw-ready__label">{section.label}</span>
          {section.missing.length > 0 && (
            <span className="fw-ready__missing">
              Missing: {section.missing.map(sentenceCase).join(', ')}
            </span>
          )}
        </span>
        <span className="fw-ready__go" aria-hidden="true">
          {section.missing.length > 0 ? 'Add' : 'Edit'}
        </span>
        <span className="fw-sr-only">
          {section.missing.length > 0
            ? `Add ${section.missing.join(', ')} to ${section.label}`
            : `Edit ${section.label}`}
        </span>
      </button>
    </li>
  );
}

/**
 * Where each section is actually edited.
 *
 * Work authorisation lives under Application preferences rather than the
 * profile, because it is never derived from a resume — sending someone to the
 * profile page to fix it would be a dead end.
 */
const DESTINATIONS: Record<string, { route: string; anchor?: string }> = {
  identity: { route: 'profile' },
  location: { route: 'profile' },
  links: { route: 'profile' },
  education: { route: 'profile' },
  experience: { route: 'profile' },
  skills: { route: 'profile' },
  projects: { route: 'profile' },
  authorization: { route: 'preferences' },
};

/** "At least five skills" reads better mid-sentence as "at least five skills". */
function sentenceCase(text: string): string {
  // Keep proper nouns and acronyms (GitHub, GPA) as written.
  return /^[A-Z][a-z]+\b/.test(text) && !/^(?:GitHub|LinkedIn)/.test(text)
    ? text.charAt(0).toLowerCase() + text.slice(1)
    : text;
}
