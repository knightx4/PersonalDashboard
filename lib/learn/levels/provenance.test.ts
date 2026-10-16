import { describe, expect, it } from 'vitest';
import { draftProvenance, markTarget } from './provenance';

describe('draftProvenance', () => {
  const topic = {
    id: 't',
    citation: { source: 'A syllabus', canonicality: 'canonical' as const },
    cells: [
      { id: 'c1', level: 1, checks: [], original: null, rewrittenAt: null, source: 'A syllabus', canonicality: 'canonical' as const },
      { id: 'c2', level: 2, checks: [], original: null, rewrittenAt: null, source: null, canonicality: 'personal' as const },
      { id: 'c3', level: 3, checks: [], original: null, rewrittenAt: null, source: null, canonicality: null },
    ],
    links: [
      { id: 'l1', fromLevel: 3, topicId: 'r', topicName: 'Return', level: 2, why: null, source: null, canonicality: null },
      // A link read from the other side has no row id here and is not this draft's to mark.
      { fromLevel: 1, topicId: 'x', topicName: 'X', level: 1, why: null },
    ],
  };

  it('counts cited, personal and uncited rows, and names the uncited in page order', () => {
    expect(draftProvenance(topic)).toEqual({
      cited: 2,
      personal: 1,
      total: 5,
      uncited: [
        { kind: 'cell', id: 'c3', label: 'level 3' },
        { kind: 'link', id: 'l1', label: 'level 3 needing Return 2' },
      ],
    });
  });

  it('writes what a mark or an undo sends', () => {
    expect(markTarget(draftProvenance(topic).uncited)).toBe('cell:c3,link:l1');
    expect(markTarget([{ kind: 'topic', id: 't' }], true)).toBe('undo:topic:t');
  });
});
