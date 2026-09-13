import { describe, expect, it } from 'vitest';
import { pickOneToAsk, type PickInput } from './pick';
import type { ReadyConcept } from './ready';
import type { SettledConcept } from './recheck';
import type { Concept, KnowledgeState } from './model';

/**
 * What a five-minute session asks about when nobody picks a subject.
 *
 * The ordering itself is tested in ready.test.ts and recheck.test.ts; what is
 * tested here is that one row comes back with everything the screen needs on
 * it, that the two ways of having nothing to ask are told apart, and that
 * every fifth question goes back over old ground.
 */

function concept(id: string, state: KnowledgeState = 'unknown'): Concept {
  return {
    id,
    name: id,
    claim: `${id} is the case, for a reason.`,
    basis: 'Written by hand for this test.',
    kind: null,
    mastery: [],
    state,
    established: state === 'known' ? 'tested' : 'inferred',
    misconception: null,
    testedAt: null,
  };
}

function row(
  name: string,
  subject: { id: string; name: string },
  stepsToGoal: number | null,
): ReadyConcept {
  return {
    concept: concept(name),
    subjectId: subject.id,
    subjectName: subject.name,
    stepsToGoal,
  };
}

function settled(
  name: string,
  subject: { id: string; name: string },
  testedAt: string,
): SettledConcept {
  return {
    concept: { ...concept(name, 'known'), testedAt },
    subjectId: subject.id,
    subjectName: subject.name,
    testedAt,
  };
}

const optics = { id: 'subject-1', name: 'Optics' };
const rigging = { id: 'subject-2', name: 'Rigging' };

const now = new Date('2026-09-13T09:00:00.000Z');

/** An ordinary turn: four answered, so the next one is not the fifth. */
function ask(input: Partial<PickInput> = {}) {
  return pickOneToAsk({
    ready: [],
    settled: [],
    subjectCount: 1,
    answered: 0,
    now,
    ...input,
  });
}

describe('picking the one claim to ask about', () => {
  it('returns the concept with its claim and its subject', () => {
    const picked = ask({ ready: [row('refraction', optics, 1)] });

    expect(picked.kind).toBe('ask');
    if (picked.kind !== 'ask') return;
    expect(picked.row.concept.claim).toBe('refraction is the case, for a reason.');
    expect(picked.row.subjectId).toBe(optics.id);
    expect(picked.row.subjectName).toBe('Optics');
  });

  it('takes the top-ranked row when several subjects have something ready', () => {
    const picked = ask({
      ready: [row('bowline', rigging, 4), row('refraction', optics, 1), row('splice', rigging, 2)],
      subjectCount: 2,
    });

    expect(picked.kind).toBe('ask');
    if (picked.kind !== 'ask') return;
    expect(picked.row.concept.name).toBe('refraction');
    expect(picked.row.subjectName).toBe('Optics');
  });

  it('says every claim is settled when there are subjects but nothing ready', () => {
    expect(ask({ subjectCount: 2 })).toEqual({ kind: 'nothing', because: 'all-settled' });
  });

  it('says no subjects when none have been named', () => {
    expect(ask({ subjectCount: 0 })).toEqual({ kind: 'nothing', because: 'no-subjects' });
  });
});

describe('the turn that goes back over old ground', () => {
  const march = settled('refraction', optics, '2026-03-14T10:00:00.000Z');
  const tuesday = settled('bowline', rigging, '2026-09-08T10:00:00.000Z');

  it('asks about the longest-unchecked claim on every fifth question', () => {
    const picked = ask({ ready: [row('splice', rigging, 1)], settled: [march], answered: 4 });

    expect(picked.kind).toBe('recheck');
    if (picked.kind !== 'recheck') return;
    expect(picked.row.concept.name).toBe('refraction');
    expect(picked.row.testedAt).toBe('2026-03-14T10:00:00.000Z');
  });

  it('asks an ordinary question on the four turns in between', () => {
    for (const answered of [0, 1, 2, 3]) {
      const picked = ask({ ready: [row('splice', rigging, 1)], settled: [march], answered });
      expect([answered, picked.kind]).toEqual([answered, 'ask']);
    }
  });

  it('comes round again five answers later', () => {
    const picked = ask({ ready: [row('splice', rigging, 1)], settled: [march], answered: 9 });
    expect(picked.kind).toBe('recheck');
  });

  it('skips the turn when nothing has gone a month unchecked', () => {
    const picked = ask({ ready: [row('splice', rigging, 1)], settled: [tuesday], answered: 4 });

    expect(picked.kind).toBe('ask');
    if (picked.kind !== 'ask') return;
    expect(picked.row.concept.name).toBe('splice');
  });

  it('takes the oldest of the claims that are old enough', () => {
    const picked = ask({ settled: [tuesday, march], answered: 4 });

    expect(picked.kind).toBe('recheck');
    if (picked.kind !== 'recheck') return;
    expect(picked.row.concept.name).toBe('refraction');
  });

  it('re-checks even when there is nothing on the frontier left', () => {
    const picked = ask({ settled: [march], answered: 4 });
    expect(picked.kind).toBe('recheck');
  });
});
