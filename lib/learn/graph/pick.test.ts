import { describe, expect, it } from 'vitest';
import { pickOneToAsk } from './pick';
import type { ReadyConcept } from './ready';
import type { Concept, KnowledgeState } from './model';

/**
 * What a five-minute session asks about when nobody picks a subject.
 *
 * The ordering itself is tested in ready.test.ts; what is tested here is that
 * one row comes back with everything the screen needs on it, and that the two
 * ways of having nothing to ask are told apart.
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
    established: 'inferred',
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

const optics = { id: 'subject-1', name: 'Optics' };
const rigging = { id: 'subject-2', name: 'Rigging' };

describe('picking the one claim to ask about', () => {
  it('returns the concept with its claim and its subject', () => {
    const picked = pickOneToAsk([row('refraction', optics, 1)], 1);

    expect(picked.kind).toBe('ask');
    if (picked.kind !== 'ask') return;
    expect(picked.row.concept.claim).toBe('refraction is the case, for a reason.');
    expect(picked.row.subjectId).toBe(optics.id);
    expect(picked.row.subjectName).toBe('Optics');
  });

  it('takes the top-ranked row when several subjects have something ready', () => {
    const picked = pickOneToAsk(
      [row('bowline', rigging, 4), row('refraction', optics, 1), row('splice', rigging, 2)],
      2,
    );

    expect(picked.kind).toBe('ask');
    if (picked.kind !== 'ask') return;
    expect(picked.row.concept.name).toBe('refraction');
    expect(picked.row.subjectName).toBe('Optics');
  });

  it('says every claim is settled when there are subjects but nothing ready', () => {
    expect(pickOneToAsk([], 2)).toEqual({ kind: 'nothing', because: 'all-settled' });
  });

  it('says no subjects when none have been named', () => {
    expect(pickOneToAsk([], 0)).toEqual({ kind: 'nothing', because: 'no-subjects' });
  });
});
