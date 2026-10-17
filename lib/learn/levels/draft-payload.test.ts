import { describe, expect, it } from 'vitest';
import {
  checksFromText,
  draftPayloadSchema,
  isVagueCheck,
  normaliseDraft,
  readWanted,
  sameChecks,
  type DraftPayload,
  type FieldOption,
  type MapTopic,
} from './draft-payload';

const MAP: MapTopic[] = [
  { id: 't-return', name: 'Return', scope: 'What a return on an investment is.', ceiling: 6, approved: true },
  { id: 't-beta', name: 'Beta', scope: 'How a stock moves with the market.', ceiling: 7, approved: true },
];

const FIELDS: FieldOption[] = [
  { id: 'f-fin', slug: 'finance', name: 'Finance' },
  { id: 'f-econ', slug: 'economics', name: 'Economics' },
];

function levels(ceiling: number) {
  return Array.from({ length: ceiling }, (_, i) => ({
    level: i + 1,
    checks: [`Can do the first thing at level ${i + 1}`, `Can do the second thing at level ${i + 1}`],
  }));
}

function payload(over: Partial<DraftPayload> = {}): DraftPayload {
  return draftPayloadSchema.parse({
    name: 'CAPM',
    scope: 'The capital asset pricing model: expected return from beta and the market premium, not multi-factor models.',
    ceiling: 4,
    fields: ['finance'],
    levels: levels(4),
    links: [],
    missing: [],
    ...over,
  });
}

describe('normaliseDraft', () => {
  it('keeps a well-formed draft with a cell per level', () => {
    const result = normaliseDraft(payload(), MAP, FIELDS);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.draft.cells.map((c) => c.level)).toEqual([1, 2, 3, 4]);
    expect(result.draft.fieldIds).toEqual(['f-fin']);
  });

  it('says a too-broad goal is too vague', () => {
    const result = normaliseDraft(payload({ too_vague: true }), MAP, FIELDS);
    expect(result).toMatchObject({ ok: false, reason: 'too-vague' });
  });

  it('ignores levels above the ceiling', () => {
    const result = normaliseDraft(payload({ ceiling: 3, levels: levels(6) }), MAP, FIELDS);
    expect(result.ok && result.draft.cells.map((c) => c.level)).toEqual([1, 2, 3]);
  });

  it('drops a vague check and says so', () => {
    const given = levels(4);
    given[1].checks.push('Understands CAPM well');
    const result = normaliseDraft(payload({ levels: given }), MAP, FIELDS);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.draft.cells[1].checks).toHaveLength(2);
    expect(result.draft.dropped.join(' ')).toContain('Understands CAPM well');
  });

  it('fails the draft when a level is left with fewer than two checks', () => {
    const given = levels(4);
    given[2].checks = ['Can explain beta', 'Knows the formula'];
    const result = normaliseDraft(payload({ levels: given }), MAP, FIELDS);
    expect(result).toMatchObject({ ok: false, reason: 'malformed' });
    if (!result.ok) expect(result.detail).toContain('Level 3');
  });

  it('fails the draft when a level below the ceiling is missing', () => {
    const result = normaliseDraft(payload({ levels: levels(3) }), MAP, FIELDS);
    expect(result).toMatchObject({ ok: false, reason: 'malformed' });
  });

  it('keeps at most four checks a level', () => {
    const given = levels(4);
    given[0].checks = ['Can a', 'Can b', 'Can c', 'Can d', 'Can e'];
    const result = normaliseDraft(payload({ levels: given }), MAP, FIELDS);
    expect(result.ok && result.draft.cells[0].checks).toHaveLength(4);
  });

  it('resolves links to topics on the map by name, ignoring case', () => {
    const result = normaliseDraft(
      payload({ links: [{ from_level: 3, topic: 'return', level: 2, why: 'Needs what a return is.' }] }),
      MAP,
      FIELDS,
    );
    expect(result.ok && result.draft.links).toEqual([
      {
        fromLevel: 3,
        topicId: 't-return',
        topicName: 'Return',
        level: 2,
        why: 'Needs what a return is.',
        cites: [],
        canonicality: null,
      },
    ]);
  });

  it('keeps only the lowest link from this topic to another', () => {
    const result = normaliseDraft(
      payload({
        links: [
          { from_level: 4, topic: 'Beta', level: 3 },
          { from_level: 2, topic: 'Beta', level: 2 },
          { from_level: 2, topic: 'Beta', level: 4 },
        ],
      }),
      MAP,
      FIELDS,
    );
    expect(result.ok && result.draft.links.map((l) => [l.fromLevel, l.level])).toEqual([[2, 2]]);
  });

  it('drops a link to itself, from above the ceiling, or above the other topic’s ceiling', () => {
    const result = normaliseDraft(
      payload({
        links: [
          { from_level: 2, topic: 'CAPM', level: 1 },
          { from_level: 6, topic: 'Return', level: 1 },
          { from_level: 2, topic: 'Return', level: 9 },
        ],
      }),
      MAP,
      FIELDS,
    );
    expect(result.ok && result.draft.links).toEqual([]);
    expect(result.ok && result.draft.dropped).toHaveLength(3);
  });

  it('keeps a link to a topic the map lacks as wanted when it was listed missing', () => {
    const result = normaliseDraft(
      payload({
        links: [{ from_level: 3, topic: 'Risk-free rate', level: 1, why: 'The intercept.' }],
        missing: [{ name: 'Risk-free rate', scope: 'The return on a riskless asset.', from_level: 3, level: 1 }],
      }),
      MAP,
      FIELDS,
    );
    expect(result.ok && result.draft.wanted).toEqual([
      {
        name: 'Risk-free rate',
        scope: 'The return on a riskless asset.',
        from_level: 3,
        level: 1,
        why: 'The intercept.',
        cites: [],
      },
    ]);
  });

  it('keeps the sources each row cites, drops invented ones and leaves an uncited row with none', () => {
    const given = {
      sources: [{ id: 'S1', label: 'CFA syllabus', items: ['Explain CAPM', 'Calculate beta'] }],
      performances: ['Price a stock'],
    };
    const result = normaliseDraft(
      payload({
        cites: ['S1'],
        canonicality: 'canonical',
        levels: levels(4).map((l) =>
          l.level === 1 ? { ...l, cites: ['s1.1', 'S7'], canonicality: 'folk' } : l.level === 2 ? { ...l, cites: ['S9'] } : l,
        ),
        links: [{ from_level: 2, topic: 'Return', level: 1, cites: ['P1'], canonicality: 'practitioner' }],
        performances: [{ performance: 1, level: 3 }, { performance: 2, level: 2 }],
        out_of_scope: ['S1.2', 'S4.1'],
        checklist: ['  Does level 4 cover the security market line? ', ''],
      }),
      MAP,
      FIELDS,
      given,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.draft).toMatchObject({
      topicCites: ['S1'],
      canonicality: 'canonical',
      performanceLevels: [3],
      outOfScope: ['S1.2'],
      checklist: ['Does level 4 cover the security market line?'],
    });
    // An unknown canonicality on a cited row reads as practitioner.
    expect(result.draft.cells[0]).toMatchObject({ cites: ['S1.1'], canonicality: 'practitioner' });
    expect(result.draft.cells[1]).toMatchObject({ cites: [], canonicality: null });
    expect(result.draft.links[0]).toMatchObject({ cites: ['P1'], canonicality: 'practitioner' });
  });

  it('never lists a topic already on the map as wanted', () => {
    const result = normaliseDraft(
      payload({ missing: [{ name: 'Beta', scope: 'Again.', from_level: 2, level: 1 }] }),
      MAP,
      FIELDS,
    );
    expect(result.ok && result.draft.wanted).toEqual([]);
  });
});

describe('isVagueCheck', () => {
  it('rejects a state of mind and keeps something an answer can show', () => {
    expect(isVagueCheck('Understands DCF well')).toBe(true);
    expect(isVagueCheck('Has a good grasp of discounting')).toBe(true);
    expect(isVagueCheck('Is familiar with WACC')).toBe(true);
    expect(isVagueCheck('Can explain why free cash flow is used rather than net income')).toBe(false);
  });
});

describe('checksFromText', () => {
  it('reads one check a line, dropping blank lines and spacing', () => {
    expect(checksFromText('  Can a \n\nCan   b\n')).toEqual({ ok: true, checks: ['Can a', 'Can b'] });
  });

  it('refuses fewer than two or more than four', () => {
    expect(checksFromText('Can a').ok).toBe(false);
    expect(checksFromText('a\nb\nc\nd\ne').ok).toBe(false);
  });
});

describe('sameChecks', () => {
  it('ignores spacing and notices a reworded check', () => {
    expect(sameChecks(['Can a', 'Can b'], [' Can a', 'Can  b'])).toBe(true);
    expect(sameChecks(['Can a', 'Can b'], ['Can a', 'Can c'])).toBe(false);
  });
});

describe('readWanted', () => {
  it('keeps entries of the written shape and drops the rest', () => {
    expect(
      readWanted([{ name: 'X', scope: 'Y', from_level: 1, level: 2 }, { name: 'Z' }, 'nope']),
    ).toEqual([{ name: 'X', scope: 'Y', from_level: 1, level: 2, why: null }]);
    expect(readWanted(null)).toEqual([]);
  });
});
