import { describe, expect, it } from 'vitest';
import {
  applyGradeRules,
  explainQuestion,
  graderCells,
  linkReviewsFor,
  whatMoved,
  type GradeCell,
  type GradeEvidence,
  type GradeMap,
} from './grade';
import { readCells } from './model';

/**
 * Two topics: CAPM 1 to 8 and Return 1 to 4. CAPM 3 requires Return 2.
 * Plus a draft topic, Beta, that CAPM 2 links to.
 */
function cell(topicId: string, level: number): GradeCell {
  return { id: `${topicId}${level}`, topicId, level, descriptor: [`${topicId} ${level} check a`, `${topicId} ${level} check b`] };
}

function baseMap(evidence: GradeEvidence[] = []): GradeMap {
  return {
    topics: [
      { id: 'capm', name: 'CAPM', ceiling: 8, approved: true },
      { id: 'ret', name: 'Return', ceiling: 4, approved: true },
      { id: 'beta', name: 'Beta', ceiling: 3, approved: false },
    ],
    cells: [
      ...[1, 2, 3, 4, 5, 6, 7, 8].map((l) => cell('capm', l)),
      ...[1, 2, 3, 4].map((l) => cell('ret', l)),
      ...[1, 2, 3].map((l) => cell('beta', l)),
    ],
    links: [
      { id: 'L1', requiringCellId: 'capm3', requiredCellId: 'ret2' },
      { id: 'L2', requiringCellId: 'capm2', requiredCellId: 'beta1' },
    ],
    evidence,
  };
}

describe('graderCells', () => {
  it('shows the asked cell, two levels either side, and what it requires', () => {
    const cells = graderCells(baseMap(), 'capm3')!;
    expect(cells.map((c) => [c.key, c.cellId, c.role])).toEqual([
      ['C1', 'capm3', 'asked'],
      ['C2', 'capm1', 'nearby'],
      ['C3', 'capm2', 'nearby'],
      ['C4', 'capm4', 'nearby'],
      ['C5', 'capm5', 'nearby'],
      ['C6', 'ret2', 'required'],
    ]);
  });

  it('carries a lower cell’s links up the level chain, and leaves draft topics out', () => {
    const ids = graderCells(baseMap(), 'capm7')!.map((c) => c.cellId);
    expect(ids).toContain('ret2');
    expect(ids).not.toContain('beta1');
  });

  it('refuses a cell on a draft topic', () => {
    expect(graderCells(baseMap(), 'beta1')).toBeNull();
  });
});

describe('applyGradeRules', () => {
  const cells = graderCells(baseMap(), 'capm3')!;
  const answer = 'Expected return is the risk-free rate plus beta times the market premium.';

  it('keeps a met whose quote is in the answer word for word', () => {
    const { write } = applyGradeRules({
      cells,
      answer,
      verdicts: [{ cell: 'C1', verdict: 'met', quote: ' beta times the market premium ' }],
    });
    expect(write).toEqual([{ cellId: 'capm3', verdict: 'met', quote: 'beta times the market premium' }]);
  });

  it('rule 1: drops a met with no quote or a quote not in the answer', () => {
    const { write, dropped } = applyGradeRules({
      cells,
      answer,
      verdicts: [
        { cell: 'C1', verdict: 'met', quote: 'beta multiplied by the premium' },
        { cell: 'C6', verdict: 'met', quote: null },
      ],
    });
    expect(write).toEqual([]);
    expect(dropped).toEqual([
      { cellId: 'capm3', why: 'quote-not-in-answer' },
      { cellId: 'ret2', why: 'no-quote' },
    ]);
  });

  it('rule 2: writes not met only on the asked cell', () => {
    const { write, dropped } = applyGradeRules({
      cells,
      answer,
      verdicts: [
        { cell: 'C1', verdict: 'not_met' },
        { cell: 'C4', verdict: 'not_met' },
      ],
    });
    expect(write).toEqual([{ cellId: 'capm3', verdict: 'not_met', quote: null }]);
    expect(dropped).toEqual([{ cellId: 'capm4', why: 'not-met-off-the-asked-cell' }]);
  });

  it('rule 3: not touched, unknown keys and repeats write nothing', () => {
    const { write } = applyGradeRules({
      cells,
      answer,
      verdicts: [
        { cell: 'C2', verdict: 'not_touched' },
        { cell: 'C99', verdict: 'met', quote: 'Expected return' },
        { cell: 'C3', verdict: 'met', quote: 'Expected return' },
        { cell: 'C3', verdict: 'not_met' },
      ],
    });
    expect(write).toEqual([{ cellId: 'capm2', verdict: 'met', quote: 'Expected return' }]);
  });
});

describe('linkReviewsFor', () => {
  it('puts the link up when a doubted cell is shown again over the same miss', () => {
    const map = baseMap([
      { id: 'e1', cellId: 'capm3', verdict: 'met', observedAt: '2026-10-01T00:00:00.000Z' },
      { id: 'e2', cellId: 'ret2', verdict: 'not_met', observedAt: '2026-10-02T00:00:00.000Z' },
    ]);
    const before = readCells(map);
    expect(before.get('capm3')!.inDoubt).toBe(true);
    expect(linkReviewsFor(map, before, new Map([['capm3', 'e3']]))).toEqual([
      { linkId: 'L1', shownCellId: 'capm3', shownEvidenceId: 'e3', missedCellId: 'ret2', missedEvidenceId: 'e2' },
    ]);
  });

  it('follows the link to a miss below the required cell', () => {
    const map = baseMap([
      { id: 'e1', cellId: 'capm4', verdict: 'met', observedAt: '2026-10-01T00:00:00.000Z' },
      { id: 'e2', cellId: 'ret1', verdict: 'not_met', observedAt: '2026-10-02T00:00:00.000Z' },
    ]);
    const reviews = linkReviewsFor(map, readCells(map), new Map([['capm4', 'e3']]));
    expect(reviews.map((r) => [r.linkId, r.missedCellId])).toEqual([['L1', 'ret1']]);
  });

  it('writes nothing for a cell that was not in doubt', () => {
    const map = baseMap([{ id: 'e1', cellId: 'capm3', verdict: 'met', observedAt: '2026-10-01T00:00:00.000Z' }]);
    expect(linkReviewsFor(map, readCells(map), new Map([['capm3', 'e3']]))).toEqual([]);
  });
});

describe('whatMoved', () => {
  it('lists shown cells with quotes, then the cells they newly imply, then a miss', () => {
    const map = baseMap();
    const before = readCells(map);
    const written = [
      { cellId: 'capm3', verdict: 'met' as const, quote: 'plus beta' },
      { cellId: 'ret3', verdict: 'met' as const, quote: 'geometric' },
    ];
    const after = readCells({
      ...map,
      evidence: written.map((w, i) => ({
        id: `n${i}`,
        cellId: w.cellId,
        verdict: w.verdict,
        observedAt: '2026-10-10T00:00:00.000Z',
      })),
    });
    const moved = whatMoved({ map, askedCellId: 'capm3', before, after, written, reviews: [] });
    expect(moved.reached.map((r) => [r.cellId, r.how, r.quote, r.via?.topicName ?? null])).toEqual([
      ['capm3', 'shown', 'plus beta', null],
      ['ret3', 'shown', 'geometric', null],
      ['capm1', 'implied', null, 'CAPM'],
      ['capm2', 'implied', null, 'CAPM'],
      ['ret1', 'implied', null, 'CAPM'],
      ['ret2', 'implied', null, 'CAPM'],
    ]);
  });

  it('names a link put in doubt by the two cells it joins', () => {
    const map = baseMap();
    const r = readCells(map);
    const moved = whatMoved({
      map,
      askedCellId: 'capm3',
      before: r,
      after: r,
      written: [{ cellId: 'capm3', verdict: 'not_met', quote: null }],
      reviews: [{ linkId: 'L1', shownCellId: 'capm3', shownEvidenceId: 'x', missedCellId: 'ret2', missedEvidenceId: 'y' }],
    });
    expect(moved.reached.map((c) => [c.cellId, c.how, c.asked])).toEqual([['capm3', 'missed', true]]);
    expect(moved.doubted).toEqual([{ from: { topicName: 'CAPM', level: 3 }, to: { topicName: 'Return', level: 2 } }]);
  });
});

describe('explainQuestion', () => {
  it('asks the explained levels and leaves cases and defences alone', () => {
    expect(explainQuestion('DCF', 2)).toBe('In your own words, what is DCF?');
    for (const level of [1, 3, 7, 8, 9]) expect(explainQuestion('DCF', level)).toContain('DCF');
    for (const level of [4, 5, 6, 10]) expect(explainQuestion('DCF', level)).toBeNull();
  });
});
