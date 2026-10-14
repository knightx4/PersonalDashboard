/**
 * What backs an idea, as a row of learn.evidence_links (plan #2006.1) and as
 * the app reads it. Pure, so the ordering can be tested without a database.
 */

/**
 * What backs an idea. A topic can also be backed by an idea of yours, as
 * source_kind 'idea' (plan #2016.3); that kind is TopicSourceKind in ./topics,
 * since only links to topics carry it.
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
  /** Links to topics only: how the source touched it (plan #2016.3). */
  matched_by?: 'name' | 'similarity' | null;
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
  /** For a link to a topic, whether the source names it or its vector agreed; null otherwise. */
  matchedBy?: 'name' | 'similarity' | null;
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
      matchedBy: row.matched_by ?? null,
    }))
    .sort(
      (a, b) =>
        b.weight - a.weight ||
        b.similarity - a.similarity ||
        b.foundAt.localeCompare(a.foundAt) ||
        a.id.localeCompare(b.id),
    );
}

// -- As a card shows it (plan #2006.6) ---------------------------------------------

/** How many links an idea's card and concept page list. */
export const CARD_EVIDENCE_LIMIT = 3;

/** The basis as a sentence on its own line: "You wrote about this in …". */
export function basisSentence(basis: string): string {
  const text = basis.trim();
  return text.length === 0 ? text : text[0].toUpperCase() + text.slice(1);
}

const KIND_NOUN: Record<EvidenceSourceKind, [string, string]> = {
  note: ['a note', 'notes'],
  course: ['a course', 'courses'],
  work: ['your work', 'work entries'],
  reading: ['a reading', 'readings'],
  video: ['a video', 'videos'],
};

/**
 * What backs an idea in a few words, for the map's hover card:
 * "2 notes and a course". Kinds in the order of their strongest link.
 */
export function backedByText(links: readonly Pick<EvidenceLink, 'sourceKind'>[]): string | null {
  const counts = new Map<EvidenceSourceKind, number>();
  for (const link of links) counts.set(link.sourceKind, (counts.get(link.sourceKind) ?? 0) + 1);
  const parts = [...counts].map(([kind, n]) => (n === 1 ? KIND_NOUN[kind][0] : `${n} ${KIND_NOUN[kind][1]}`));
  if (parts.length === 0) return null;
  if (parts.length === 1) return parts[0];
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}
