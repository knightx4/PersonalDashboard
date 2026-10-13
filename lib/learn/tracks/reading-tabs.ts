/**
 * The tabs on a reading's page (plan #1876.4): the reading itself, and what
 * Dash makes of its text. The Summary tab also holds the chat with Dash about
 * the reading (#1876.5), under the summary.
 */
export const READING_TABS = [
  { id: 'reading', label: 'Reading' },
  { id: 'summary', label: 'Summary' },
] as const;

export type ReadingTab = (typeof READING_TABS)[number]['id'];
