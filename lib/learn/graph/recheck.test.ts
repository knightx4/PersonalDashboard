import { describe, expect, it } from 'vitest';
import {
  claimToRecheck,
  isRecheckTurn,
  rankByLastChecked,
  RECHECK_AFTER_DAYS,
  settledInSubject,
  type SettledConcept,
} from './recheck';
import type { Concept, Graph, KnowledgeState, StateBasis } from './model';

/**
 * Which settled claim has gone longest without being asked about.
 *
 * Two rules, and both are about not inventing a date: a claim carrying no date
 * of either kind is not in the list at all, and among the ones that are, the
 * oldest date wins whether it came from an answer or from your word.
 */

function concept(
  id: string,
  state: KnowledgeState,
  established: StateBasis,
  testedAt: string | null,
  declaredAt: string | null = null,
): Concept {
  return {
    id,
    name: id,
    claim: `${id} is the case, for a reason.`,
    claimOriginal: null,
    claimRewrittenAt: null,
    catalogueSearchedAt: null,
    basis: 'Written by hand for this test.',
    kind: null,
    mastery: [],
    state,
    established,
    misconception: null,
    testedAt,
    declaredAt,
  };
}

function graphOf(concepts: Concept[]): Graph {
  return { concepts, edges: [], mentions: [] };
}

const subject = { id: 'subject-1', name: 'Optics' };
const names = (rows: SettledConcept[]) => rows.map((row) => row.concept.name);

describe('which settled claims are up for a re-check', () => {
  it('takes the ones you have answered about, with the subject and the date', () => {
    const rows = settledInSubject(
      graphOf([concept('refraction', 'known', 'tested', '2026-03-14T10:00:00.000Z')]),
      subject,
    );

    expect(rows).toEqual([
      {
        concept: expect.objectContaining({ name: 'refraction' }),
        subjectId: 'subject-1',
        subjectName: 'Optics',
        established: 'tested',
        settledAt: '2026-03-14T10:00:00.000Z',
      },
    ]);
  });

  it('leaves out a claim that is not settled', () => {
    const rows = settledInSubject(
      graphOf([
        concept('shaky-one', 'shaky', 'tested', '2026-03-14T10:00:00.000Z'),
        concept('wrong-one', 'misconception', 'tested', '2026-03-14T10:00:00.000Z'),
        concept('unknown-one', 'unknown', 'tested', '2026-03-14T10:00:00.000Z'),
      ]),
      subject,
    );

    expect(rows).toEqual([]);
  });

  it('takes a claim you said you knew, with the day you said it', () => {
    const rows = settledInSubject(
      graphOf([concept('waved-through', 'known', 'declared', null, '2026-03-14T10:00:00.000Z')]),
      subject,
    );

    expect(rows).toEqual([
      {
        concept: expect.objectContaining({ name: 'waved-through' }),
        subjectId: 'subject-1',
        subjectName: 'Optics',
        established: 'declared',
        settledAt: '2026-03-14T10:00:00.000Z',
      },
    ]);
  });

  it('leaves out one known by inference, and one you waved through with no date', () => {
    const rows = settledInSubject(
      graphOf([
        concept('inferred-one', 'known', 'inferred', null),
        concept('undated-declared', 'known', 'declared', null),
        concept('tested-one', 'known', 'tested', '2026-03-14T10:00:00.000Z'),
      ]),
      subject,
    );

    expect(names(rows)).toEqual(['tested-one']);
  });

  it('leaves out a claim with no date on it, or one that will not parse', () => {
    const rows = settledInSubject(
      graphOf([
        concept('no-date', 'known', 'tested', null),
        concept('bad-date', 'known', 'tested', 'the fourteenth'),
        concept('bad-declared-date', 'known', 'declared', null, 'the fourteenth'),
      ]),
      subject,
    );

    expect(rows).toEqual([]);
  });
});

describe('the order they come back in', () => {
  function row(name: string, testedAt: string, subjectName = 'Optics'): SettledConcept {
    return {
      concept: concept(name, 'known', 'tested', testedAt),
      subjectId: subjectName.toLowerCase(),
      subjectName,
      established: 'tested',
      settledAt: testedAt,
    };
  }

  function waved(name: string, declaredAt: string, subjectName = 'Optics'): SettledConcept {
    return {
      concept: concept(name, 'known', 'declared', null, declaredAt),
      subjectId: subjectName.toLowerCase(),
      subjectName,
      established: 'declared',
      settledAt: declaredAt,
    };
  }

  it('puts the longest unchecked first', () => {
    const ranked = rankByLastChecked([
      row('yesterday', '2026-09-12T10:00:00.000Z'),
      row('march', '2026-03-14T10:00:00.000Z'),
      row('june', '2026-06-01T10:00:00.000Z'),
    ]);

    expect(names(ranked)).toEqual(['march', 'june', 'yesterday']);
  });

  it('mixes the ones you waved through in with the ones you answered', () => {
    const ranked = rankByLastChecked([
      row('answered in june', '2026-06-01T10:00:00.000Z'),
      waved('waved through in march', '2026-03-14T10:00:00.000Z'),
      waved('waved through in august', '2026-08-02T10:00:00.000Z'),
    ]);

    expect(names(ranked)).toEqual([
      'waved through in march',
      'answered in june',
      'waved through in august',
    ]);
  });

  it('mixes subjects together rather than grouping them', () => {
    const ranked = rankByLastChecked([
      row('newer optics', '2026-06-01T10:00:00.000Z', 'Optics'),
      row('older greek', '2026-03-14T10:00:00.000Z', 'Greek'),
    ]);

    expect(names(ranked)).toEqual(['older greek', 'newer optics']);
  });

  it('breaks a tie on the name, then on the subject', () => {
    const same = '2026-03-14T10:00:00.000Z';
    const ranked = rankByLastChecked([
      row('lenses', same, 'Optics'),
      row('diffraction', same, 'Optics'),
      row('lenses', same, 'Greek'),
    ]);

    expect(ranked.map((r) => `${r.concept.name}/${r.subjectName}`)).toEqual([
      'diffraction/Optics',
      'lenses/Greek',
      'lenses/Optics',
    ]);
  });

  it('reads the dates as instants rather than as text', () => {
    const ranked = rankByLastChecked([
      row('utc', '2026-03-14T10:00:00.000Z'),
      // An hour earlier than the other one, and later than it as text.
      row('offset', '2026-03-14T11:00:00.000+02:00'),
    ]);

    expect(names(ranked)).toEqual(['offset', 'utc']);
  });

  it('leaves the rows it was given alone', () => {
    const rows = [row('june', '2026-06-01T10:00:00.000Z'), row('march', '2026-03-14T10:00:00.000Z')];
    rankByLastChecked(rows);

    expect(names(rows)).toEqual(['june', 'march']);
  });
});

describe('how often an old claim comes back', () => {
  it('is every fifth question, counted from the ones you have answered', () => {
    expect([0, 1, 2, 3, 4, 5, 8, 9].map(isRecheckTurn)).toEqual([
      false,
      false,
      false,
      false,
      true,
      false,
      false,
      true,
    ]);
  });

  function settled(name: string, testedAt: string): SettledConcept {
    return {
      concept: concept(name, 'known', 'tested', testedAt),
      subjectId: 'subject-1',
      subjectName: 'Optics',
      established: 'tested',
      settledAt: testedAt,
    };
  }

  function wavedThrough(name: string, declaredAt: string): SettledConcept {
    return {
      concept: concept(name, 'known', 'declared', null, declaredAt),
      subjectId: 'subject-1',
      subjectName: 'Optics',
      established: 'declared',
      settledAt: declaredAt,
    };
  }

  const now = new Date('2026-09-13T09:00:00.000Z');
  const daysAgo = (days: number) =>
    new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString();

  it('takes the claim you were asked about longest ago', () => {
    const claim = claimToRecheck([settled('recent', daysAgo(40)), settled('old', daysAgo(90))], now);
    expect(claim?.concept.name).toBe('old');
  });

  it('leaves alone anything checked inside the month', () => {
    expect(claimToRecheck([settled('tuesday', daysAgo(5))], now)).toBeNull();
    expect(claimToRecheck([settled('nearly', daysAgo(RECHECK_AFTER_DAYS - 1))], now)).toBeNull();
  });

  it('takes one that has been unchecked exactly a month', () => {
    const claim = claimToRecheck([settled('a-month', daysAgo(RECHECK_AFTER_DAYS))], now);
    expect(claim?.concept.name).toBe('a-month');
  });

  it('takes one you waved through a month ago and leaves a newer one alone', () => {
    const old = claimToRecheck([wavedThrough('a-month', daysAgo(RECHECK_AFTER_DAYS))], now);
    expect(old?.concept.name).toBe('a-month');

    const nearly = [wavedThrough('nearly', daysAgo(RECHECK_AFTER_DAYS - 1))];
    expect(claimToRecheck(nearly, now)).toBeNull();
    expect(claimToRecheck([wavedThrough('yesterday', daysAgo(1))], now)).toBeNull();
  });

  it('offers a waved-through claim ahead of one answered about more recently', () => {
    const claim = claimToRecheck(
      [settled('answered', daysAgo(40)), wavedThrough('waved', daysAgo(90))],
      now,
    );
    expect(claim?.concept.name).toBe('waved');
  });

  it('has nothing to offer when nothing is settled', () => {
    expect(claimToRecheck([], now)).toBeNull();
  });
});
