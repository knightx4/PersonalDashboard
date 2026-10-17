/**
 * How the bank may use a document, in the words the subject page shows
 * (plan #2276.6, shared with Add a source in #2307.4). Keyed by licence mode
 * (structure.ts), kept apart from it so a client component can read it.
 */
export const LICENCE_LABELS: Record<string, string> = {
  show: 'Full text',
  structure_only: 'Outline only',
  never_feed: 'Headings only',
};

export function licenceLabel(mode: string | null | undefined): string {
  return mode ? (LICENCE_LABELS[mode] ?? mode) : 'Licence not recorded';
}
