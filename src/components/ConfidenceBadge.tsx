import type { Provenance } from '@/types/profile';

export type ConfidenceLevel = 'high' | 'medium' | 'low';

export function levelOf(confidence: number): ConfidenceLevel {
  if (confidence >= 0.85) return 'high';
  if (confidence >= 0.6) return 'medium';
  return 'low';
}

const LABELS: Record<ConfidenceLevel, string> = {
  high: 'High confidence',
  medium: 'Worth a check',
  low: 'Please confirm',
};

/**
 * Shows how sure Fillwright is about a value and where it came from.
 *
 * Confidence is surfaced everywhere a parsed value appears, because the user is
 * the only one who can actually verify it. A low-confidence value is not an
 * error — it is a question.
 */
export function ConfidenceBadge({
  confidence,
  provenance,
  compact = false,
}: {
  confidence: number;
  provenance?: Provenance;
  compact?: boolean;
}) {
  const level = levelOf(confidence);
  const percent = Math.round(confidence * 100);
  const source = provenance ? SOURCE_LABELS[provenance.source] : undefined;

  const title = [
    `${LABELS[level]} (${percent}%)`,
    source ? `Source: ${source}` : '',
    provenance?.note ? `Because: ${provenance.note}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  return (
    <span
      className={`fw-conf fw-conf--${level}${compact ? ' fw-conf--compact' : ''}`}
      title={title}
    >
      <span className="fw-conf__dot" aria-hidden="true" />
      <span className="fw-conf__text">
        {compact ? `${percent}%` : `${LABELS[level]} · ${percent}%`}
      </span>
      <span className="fw-sr-only">{title}</span>
    </span>
  );
}

const SOURCE_LABELS: Record<Provenance['source'], string> = {
  resume: 'read from your resume',
  user: 'entered by you',
  inferred: 'inferred from other fields',
  default: 'not set yet',
};

export function SourceTag({ provenance }: { provenance: Provenance }) {
  return (
    <span className="fw-source" title={provenance.note || undefined}>
      {SOURCE_LABELS[provenance.source]}
    </span>
  );
}
