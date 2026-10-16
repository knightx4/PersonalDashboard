import type { RowCitation, TopicDetail } from '@/lib/learn/levels/store';

/**
 * Provenance, the fourth of a draft's five checks (plan #2138.11): which of
 * the rows that would land on the map name a source. Read from the rows
 * themselves rather than kept with the other checks, so marking a row
 * personal shows the moment it is made.
 *
 * Pure; the page and the gallery both call it.
 */

export type ProvenanceRow = { kind: 'topic' | 'cell' | 'link'; id: string; label: string };

export type Provenance = {
  /** Rows naming a source. */
  cited: number;
  /** Rows marked personal: theirs, with no source to name. */
  personal: number;
  total: number;
  /** Rows with neither, in page order; approval waits on these. */
  uncited: ProvenanceRow[];
};

function state(row: Partial<RowCitation>): 'cited' | 'personal' | 'uncited' {
  if (row.source) return 'cited';
  return row.canonicality === 'personal' ? 'personal' : 'uncited';
}

export function draftProvenance(topic: Pick<TopicDetail, 'id' | 'citation' | 'cells' | 'links'>): Provenance {
  const rows: (ProvenanceRow & { state: ReturnType<typeof state> })[] = [
    { kind: 'topic', id: topic.id, label: 'the topic', state: state(topic.citation) },
    ...topic.cells.map((cell) => ({ kind: 'cell' as const, id: cell.id, label: `level ${cell.level}`, state: state(cell) })),
    ...topic.links.flatMap((link) =>
      link.id
        ? [
            {
              kind: 'link' as const,
              id: link.id,
              label: `level ${link.fromLevel} needing ${link.topicName} ${link.level}`,
              state: state(link),
            },
          ]
        : [],
    ),
  ];
  return {
    cited: rows.filter((r) => r.state === 'cited').length,
    personal: rows.filter((r) => r.state === 'personal').length,
    total: rows.length,
    uncited: rows.filter((r) => r.state === 'uncited').map(({ kind, id, label }) => ({ kind, id, label })),
  };
}

/** The value a mark-personal press sends for these rows: `cell:<id>,link:<id>`. */
export function markTarget(rows: readonly Pick<ProvenanceRow, 'kind' | 'id'>[], undo = false): string {
  return `${undo ? 'undo:' : ''}${rows.map((r) => `${r.kind}:${r.id}`).join(',')}`;
}
