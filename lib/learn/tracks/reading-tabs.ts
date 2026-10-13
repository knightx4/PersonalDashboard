/**
 * The tabs on a reading's page (plan #1876.4): the reading itself, and what
 * Dash makes of its text. The chat (#1876.5) is meant to join Summary's tab
 * or sit beside it.
 */
export const READING_TABS = [
  { id: 'reading', label: 'Reading' },
  { id: 'summary', label: 'Summary' },
] as const;

export type ReadingTab = (typeof READING_TABS)[number]['id'];
