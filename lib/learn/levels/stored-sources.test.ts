import { describe, expect, it } from 'vitest';
import type { NearestStructureUnit } from '@/lib/learn/catalogue/structure-store';
import { MAX_SOURCES, sourcesPrompt, sourceText } from '@/lib/learn/levels/draft-sources';
import {
  canonicalityByDocuments,
  documentLabel,
  draftedDocuments,
  independenceKey,
  mergeMatches,
  storedSourcesFrom,
  territoryCanon,
  unitLine,
  withDocumentCanonicality,
  withStoredSources,
} from '@/lib/learn/levels/stored-sources';

/**
 * Stored documents as the compiler's sources (plan #2247.10), on the
 * French-influence example from the Learn review: a goal narrower than any
 * course, served by weeks of an American Revolution syllabus and a French
 * Revolution syllabus, and not by the rest of either.
 */

const AR = 'a0000000-0000-4000-8000-000000000001';
const FR = 'a0000000-0000-4000-8000-000000000002';
const AR_LATER_TERM = 'a0000000-0000-4000-8000-000000000003';
const OSX = 'a0000000-0000-4000-8000-000000000004';

function unit(
  itemId: string,
  ordinal: number,
  heading: string,
  similarity: number,
  extra: Partial<NearestStructureUnit> = {},
): NearestStructureUnit {
  const docs: Record<string, Partial<NearestStructureUnit>> = {
    [AR]: { documentTitle: 'The American Revolution', institution: 'Yale', courseCode: 'HIST 116', term: 'Spring 2010', licenceMode: 'show' },
    [AR_LATER_TERM]: { documentTitle: 'The American Revolution', institution: 'Yale', courseCode: 'HIST 116', term: 'Spring 2014', licenceMode: 'show' },
    [FR]: { documentTitle: 'The French Revolution', institution: 'MIT', courseCode: '21H.312', term: 'Fall 2021', licenceMode: 'structure_only' },
    [OSX]: { documentTitle: 'U.S. History', institution: 'OpenStax', courseCode: null, term: null, licenceMode: 'never_feed' },
  };
  return {
    segmentId: `${itemId}-${ordinal}`,
    itemId,
    ordinal,
    label: `Week ${ordinal + 1}`,
    heading,
    topics: [],
    readings: [{ title: 'A reading that must not reach the model' }],
    similarity,
    documentTitle: '',
    canonicalUrl: `https://example.org/${itemId}`,
    institution: null,
    courseCode: null,
    term: null,
    licenceMode: 'show',
    ...docs[itemId],
    ...extra,
  };
}

// What the two searches (the goal, then a performance) returned.
const byGoal = [
  unit(AR, 6, 'The French alliance', 0.71, { topics: ['Franklin in Paris', 'Treaty of 1778'] }),
  unit(FR, 1, 'The Enlightenment and the American example', 0.69),
  unit(AR, 2, 'Republicanism and Montesquieu', 0.64),
];
const byPerformance = [
  unit(AR, 6, 'The French alliance', 0.66),
  unit(FR, 4, 'Lafayette and the Declaration of the Rights of Man', 0.62),
  unit(FR, 1, 'The Enlightenment and the American example', 0.74),
];

describe('finding weeks by what they cover', () => {
  it('keeps each unit once, at its best similarity, closest first', () => {
    const merged = mergeMatches([byGoal, byPerformance]);
    expect(merged.map((m) => m.segmentId)).toEqual([`${FR}-1`, `${AR}-6`, `${AR}-2`, `${FR}-4`]);
    expect(merged[0].similarity).toBe(0.74);
  });

  it('pulls weeks from both syllabi, each document in its own order', () => {
    const { sources, refs } = storedSourcesFrom(mergeMatches([byGoal, byPerformance]));
    expect(sources.map((s) => s.label)).toEqual([
      'MIT 21H.312, The French Revolution (Fall 2021)',
      'Yale HIST 116, The American Revolution (Spring 2010)',
    ]);
    expect(sources[0].items).toEqual([
      'Week 2: The Enlightenment and the American example',
      'Week 5: Lafayette and the Declaration of the Rights of Man',
    ]);
    expect(sources[1].items[1]).toBe('Week 7: The French alliance. Topics: Franklin in Paris; Treaty of 1778');
    expect(sources.every((s) => s.ordered)).toBe(true);
    expect(refs.map((r) => r.units.map((u) => u.ordinal))).toEqual([[1, 4], [2, 6]]);
    expect(refs[0].licenceMode).toBe('structure_only');
  });

  it('never gives the model a unit’s readings', () => {
    const { sources } = storedSourcesFrom(byGoal);
    expect(sources.flatMap((s) => s.items).join('\n')).not.toContain('must not reach');
  });

  it('caps the documents taken, best first', () => {
    const { sources } = storedSourcesFrom(mergeMatches([byGoal, byPerformance]), { maxDocuments: 1 });
    expect(sources.map((s) => s.label)).toEqual(['MIT 21H.312, The French Revolution (Fall 2021)']);
  });

  it('labels a document with no institution by its title alone', () => {
    expect(documentLabel({ title: 'Notes', institution: null, courseCode: null, term: null })).toBe('Notes');
    expect(unitLine({ label: null, heading: '  Taxes  ', topics: [] })).toBe('Taxes');
  });
});

describe('the stored documents as numbered sources', () => {
  const stored = storedSourcesFrom(mergeMatches([byGoal, byPerformance]));

  it('numbers them after the sources given and says which id each is', () => {
    const merged = withStoredSources(
      { sources: [{ id: 'S1', label: 'Pasted reading list', items: ['Paine, Common Sense'] }], performances: ['Explain the alliance'] },
      stored,
    );
    expect(merged.given.sources.map((s) => s.id)).toEqual(['S1', 'S2', 'S3']);
    expect(merged.refs.map((r) => r.sourceId)).toEqual(['S2', 'S3']);
    expect(merged.given.performances).toEqual(['Explain the alliance']);
    expect(sourcesPrompt(merged.given)).toContain('S2. MIT 21H.312, The French Revolution (Fall 2021) (units in the order taught)');
    expect(sourceText(['S3.2'], merged.given)).toBe(
      'Yale HIST 116, The American Revolution (Spring 2010): Week 7: The French alliance. Topics: Franklin in Paris; Treaty of 1778',
    );
  });

  it('takes only the slots the given sources leave', () => {
    const full = Array.from({ length: MAX_SOURCES - 1 }, (_, i) => ({ id: `S${i + 1}`, label: `Given ${i + 1}`, items: [] }));
    const merged = withStoredSources({ sources: full, performances: [] }, stored);
    expect(merged.given.sources).toHaveLength(MAX_SOURCES);
    expect(merged.refs).toHaveLength(1);
    expect(merged.refs[0].sourceId).toBe(`S${MAX_SOURCES}`);
  });
});

describe('canonicality follows the count of independent documents', () => {
  const { refs } = withStoredSources(
    { sources: [], performances: [] },
    storedSourcesFrom([
      ...mergeMatches([byGoal, byPerformance]),
      unit(AR_LATER_TERM, 6, 'The French alliance', 0.6),
    ]),
  );
  const [fr, ar, arLater] = refs;

  it('counts two terms of one course as one document', () => {
    expect(independenceKey(ar)).toBe(independenceKey(arLater));
    expect(independenceKey(fr)).not.toBe(independenceKey(ar));
    expect(independenceKey({ itemId: OSX, institution: 'OpenStax', courseCode: null })).toBe(`item:${OSX}`);
  });

  it('is canonical in two documents and practitioner in one', () => {
    expect(canonicalityByDocuments([`${fr.sourceId}.1`, `${ar.sourceId}.2`], 'practitioner', refs)).toBe('canonical');
    expect(canonicalityByDocuments([`${ar.sourceId}.2`], 'canonical', refs)).toBe('practitioner');
    expect(canonicalityByDocuments([`${ar.sourceId}.2`, `${arLater.sourceId}.1`], 'canonical', refs)).toBe('practitioner');
    expect(canonicalityByDocuments([`${ar.sourceId}.1`], 'emerging', refs)).toBe('emerging');
    expect(canonicalityByDocuments(['P1'], 'emerging', refs)).toBe('emerging');
  });

  it('makes the topic name every document its rows cite, and sets each row by the count', () => {
    const draft = {
      topicCites: ['P1'],
      canonicality: 'practitioner' as const,
      cells: [
        { level: 1, checks: ['Can name the treaty'], cites: [`${ar.sourceId}.2`], canonicality: 'canonical' as const },
        { level: 2, checks: ['Can say what Lafayette carried back'], cites: [`${fr.sourceId}.2`, `${ar.sourceId}.2`], canonicality: 'practitioner' as const },
      ],
      links: [],
    };
    const read = withDocumentCanonicality(draft, refs);
    // In source order, after what the call cited itself.
    expect(read.topicCites).toEqual(['P1', fr.sourceId, ar.sourceId]);
    expect(read.canonicality).toBe('canonical');
    expect(read.cells.map((c) => c.canonicality)).toEqual(['practitioner', 'canonical']);

    expect(draftedDocuments(read, refs)).toEqual([
      { sourceId: fr.sourceId, itemId: FR, title: 'The French Revolution', url: `https://example.org/${FR}`, licenceMode: 'structure_only', citedUnits: [4] },
      { sourceId: ar.sourceId, itemId: AR, title: 'The American Revolution', url: `https://example.org/${AR}`, licenceMode: 'show', citedUnits: [6] },
    ]);
  });

  it('leaves a draft with no stored documents as it was', () => {
    const draft = { topicCites: [], canonicality: null, cells: [], links: [] };
    expect(withDocumentCanonicality(draft, [])).toBe(draft);
  });
});

describe('the territory’s canon', () => {
  it('lists each textbook once, by how many independent documents name it', () => {
    const refs = [
      { itemId: AR, independence: 'course:yale|hist 116' },
      { itemId: AR_LATER_TERM, independence: 'course:yale|hist 116' },
      { itemId: FR, independence: 'course:mit|21h.312' },
    ];
    const canon = territoryCanon(refs, [
      { itemId: AR, textbooks: ['Gordon Wood, The Radicalism of the American Revolution', 'R. R. Palmer, The Age of the Democratic Revolution'] },
      { itemId: AR_LATER_TERM, textbooks: ['Gordon Wood, The Radicalism of the American Revolution'] },
      { itemId: FR, textbooks: ['R. R. Palmer, The Age of the Democratic Revolution', ' '] },
    ]);
    expect(canon).toEqual([
      { title: 'R. R. Palmer, The Age of the Democratic Revolution', documents: 2 },
      { title: 'Gordon Wood, The Radicalism of the American Revolution', documents: 1 },
    ]);
  });
});
