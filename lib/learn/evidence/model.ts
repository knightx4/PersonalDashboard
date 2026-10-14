/**
 * What backs an idea, as a row of learn.evidence_links (plan #2006.1) and as
 * the app reads it. Pure, so the ordering can be tested without a database.
 */

export const EVIDENCE_SOURCE_KINDS = ['note', 'course', 'work', 'reading', 'video'] as const;
export type EvidenceSourceKind = (typeof EVIDENCE_SOURCE_KINDS)[number];

export type EvidenceTargetKind = 'idea' | 'topic';

/** One row as the loader selects it. */
export type EvidenceRow = {
  id: string;
  target_kind: EvidenceTargetKind;
  target_id: string;
  source_kind: EvidenceSourceKind;
  source_id: string;
  similarity: number;
  weight: number;
  basis: string;
  found_at: string;
};

export type EvidenceLink = {
  id: string;
  targetKind: EvidenceTargetKind;
  targetId: string;
  sourceKind: EvidenceSourceKind;
  /** The source's id in its own table; a video's is its YouTube id. */
  sourceId: string;
  /** How close the match is, 0 to 1. */
  similarity: number;
  /** How much the link counts, 0 to 1. */
  weight: number;
  /** One sentence on why it counts: "you wrote about this in <note>". */
  basis: string;
  foundAt: string;
};

/**
 * Rows as links, strongest first. The weight decides, then the similarity,
 * then the newer find, then the id, so the order is the same on every read.
 */
export function evidenceFromRows(rows: EvidenceRow[]): EvidenceLink[] {
  return rows
    .map((row) => ({
      id: row.id,
      targetKind: row.target_kind,
      targetId: row.target_id,
      sourceKind: row.source_kind,
      sourceId: row.source_id,
      similarity: row.similarity,
      weight: row.weight,
      basis: row.basis,
      foundAt: row.found_at,
    }))
    .sort(
      (a, b) =>
        b.weight - a.weight ||
        b.similarity - a.similarity ||
        b.foundAt.localeCompare(a.foundAt) ||
        a.id.localeCompare(b.id),
    );
}
