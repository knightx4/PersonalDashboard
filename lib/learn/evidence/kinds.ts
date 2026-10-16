/**
 * What kind of evidence a link is, and how far that kind can reach (plan
 * #2172.2). Pure, so the rules can be tested; the database works out the
 * same two columns itself (learn.evidence_links.kind and .ceiling, migration
 * learn 0156), and `evidenceKind` and `linkCeiling` here say the same thing
 * for rows that have not been through it, such as the gallery's fixtures.
 *
 * A link's ceiling is the smaller of its own weight and its kind's: work 1,
 * a graded course 1 (its grade and age are already in the weight), argued
 * writing 0.75, a note 0.5, a clipping or a video 0.25, a mention 0.
 *
 * A mention is a name match that does not count (held_reason, plan
 * #2172.1), or one of your ideas naming a topic: the idea's own state
 * reaches the topic through the ideas attached to it, so its text naming the
 * topic adds nothing. A mention alone writes nothing.
 *
 * Argued writing is a kind nothing writes yet: decision #2172.5 holds it
 * back until the matcher repair has been measured.
 */

export const EVIDENCE_KINDS = ['work', 'course', 'argued', 'note', 'clipping', 'video', 'mention'] as const;
export type EvidenceKind = (typeof EVIDENCE_KINDS)[number];

/** The most a link of each kind can count for, before its own weight. */
export const KIND_CEILING: Record<EvidenceKind, number> = {
  work: 1,
  course: 1,
  argued: 0.75,
  note: 0.5,
  clipping: 0.25,
  video: 0.25,
  mention: 0,
};

/** A note at or under this weight is a clipping (CLIPPING_WEIGHT in ./notes). */
const CLIPPING_AT = 0.25;

/** The kind of a link, from what the row holds. The same rule as the generated column. */
export function evidenceKind(row: {
  source_kind: string;
  weight: number;
  held_reason?: string | null;
}): EvidenceKind {
  if (row.held_reason) return 'mention';
  switch (row.source_kind) {
    case 'idea':
      return 'mention';
    case 'work':
      return 'work';
    case 'course':
      return 'course';
    case 'video':
      return 'video';
    case 'reading':
      return 'clipping';
    default:
      return row.weight <= CLIPPING_AT ? 'clipping' : 'note';
  }
}

/** The most one link can count for: its weight, never past its kind's ceiling. */
export function linkCeiling(kind: EvidenceKind, weight: number): number {
  return Math.min(Math.max(0, weight), KIND_CEILING[kind]);
}

/** A kind as a mark names it. */
export const KIND_WORDS: Record<EvidenceKind, string> = {
  work: 'Work',
  course: 'Course',
  argued: 'Argued',
  note: 'Note',
  clipping: 'Clipping',
  video: 'Video',
  mention: 'Mention',
};

/** The kind and ceiling of a row that has not been through the database, as its generated columns would be. */
export function kindAndCeiling(row: { source_kind: string; weight: number; held_reason?: string | null }): {
  kind: EvidenceKind;
  ceiling: number;
} {
  const kind = evidenceKind(row);
  return { kind, ceiling: linkCeiling(kind, row.weight) };
}
