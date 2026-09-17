import type { MappingStatus } from '@/types/fields';

/** Short, user-facing names for each mapping status. Pure data. */
export const STATUS_LABELS: Record<MappingStatus, string> = {
  ready: 'Ready to fill',
  review: 'Check this one',
  'needs-consent': 'Needs your answer',
  'missing-value': 'Not in your profile',
  'manual-required': 'You need to write this',
  'skipped-existing': 'Already filled in',
  unmapped: 'Not recognised',
};
