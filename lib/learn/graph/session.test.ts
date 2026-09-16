import { describe, expect, it } from 'vitest';
import { nextConcept, nextMasteryCheck } from './session';
import type { Concept, KnowledgeState } from './model';

/**
 * Which claim the next question is about.
 *
 * The rule is worth a test because getting it wrong is invisible: a session
 * that keeps circling the same node still asks real questions and still fills
 * a bar, it just stops finding anything out. The order below is what makes ten
 * questions worth ten questions.
 */

function concept(id: string, state: KnowledgeState, kind: Concept['kind'] = null): Concept {
  return {
    id,
    name: id,
    claim: `${id} is the case.`,
    claimOriginal: null,
    claimRewrittenAt: null,
    basis: 'Seeded.',
    kind,
    mastery: [],
    state,
    established: 'inferred',
    misconception: state === 'misconception' ? 'A wrong idea.' : null,
    testedAt: null,
  };
}

const noneAsked = new Map<string, number>();

describe('what to ask about next', () => {
  it('goes for a misconception first', () => {
    // Something actively steering you wrong is where a question is worth most:
    // it is the one thing reading more will not fix on its own.
    const picked = nextConcept(
      [concept('unknown', 'unknown'), concept('wrong', 'misconception'), concept('shaky', 'shaky')],
      noneAsked,
    );
    expect(picked?.id).toBe('wrong');
  });

  it('prefers shaky to untouched', () => {
    const picked = nextConcept([concept('untouched', 'unknown'), concept('shaky', 'shaky')], noneAsked);
    expect(picked?.id).toBe('shaky');
  });

  it('leaves what is settled until last', () => {
    const picked = nextConcept([concept('settled', 'known'), concept('untouched', 'unknown')], noneAsked);
    expect(picked?.id).toBe('untouched');
  });

  it('spreads out rather than circling one node', () => {
    // Two nodes in the same state: the one asked about least often wins, which
    // is what stops a session filling the bar off a single claim.
    const asked = new Map([
      ['a', 3],
      ['b', 1],
    ]);
    const picked = nextConcept([concept('a', 'unknown'), concept('b', 'unknown')], asked);
    expect(picked?.id).toBe('b');
  });

  it('asks about the door before what follows from it', () => {
    // Same state, so nothing else separates them. The claims downstream of a
    // door do not land until you are through it, and the question about the
    // door is the one that says whether you are.
    const picked = nextConcept(
      [
        concept('downstream', 'unknown', 'consequence'),
        concept('door', 'unknown', 'threshold'),
      ],
      noneAsked,
    );
    expect(picked?.id).toBe('door');
  });

  it('does not lift a door out of its state', () => {
    // The bands still decide first: a consequence you have got wrong beats a
    // door nothing has been found out about.
    const picked = nextConcept(
      [concept('door', 'unknown', 'threshold'), concept('wrong', 'misconception', 'consequence')],
      noneAsked,
    );
    expect(picked?.id).toBe('wrong');
  });

  it('still spreads out between two doors', () => {
    const asked = new Map([
      ['a', 3],
      ['b', 1],
    ]);
    const picked = nextConcept(
      [concept('a', 'unknown', 'threshold'), concept('b', 'unknown', 'threshold')],
      asked,
    );
    expect(picked?.id).toBe('b');
  });

  it('leaves an unmarked concept where it was', () => {
    // Nobody has judged it, so it is not sorted below a consequence -- that
    // would be the judgement the null column exists to avoid.
    const asked = new Map([['downstream', 1]]);
    const picked = nextConcept(
      [concept('downstream', 'unknown', 'consequence'), concept('unmarked', 'unknown')],
      asked,
    );
    expect(picked?.id).toBe('unmarked');
  });

  it('has nothing to say about an empty subject', () => {
    expect(nextConcept([], noneAsked)).toBeNull();
  });

  it('still finds something when everything is settled', () => {
    // Worth a fraction of the information, but better than refusing to ask.
    expect(nextConcept([concept('settled', 'known')], noneAsked)?.id).toBe('settled');
  });
});

describe('the turn a subject session gives back to old ground', () => {
  const now = new Date('2026-09-13T09:00:00.000Z');
  const daysAgo = (days: number) =>
    new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString();

  /** Settled by an answer somebody actually gave, on a date. */
  function checked(id: string, testedAt: string): Concept {
    return { ...concept(id, 'known'), established: 'tested', testedAt };
  }

  const frontier = concept('untouched', 'unknown');

  it('asks about the claim checked longest ago on every fifth question', () => {
    const picked = nextConcept(
      [frontier, checked('recent', daysAgo(45)), checked('old', daysAgo(200))],
      noneAsked,
      { answered: 4, now },
    );
    expect(picked?.id).toBe('old');
  });

  it('goes back to the frontier on the turns in between', () => {
    for (const answered of [0, 1, 2, 3, 5]) {
      const picked = nextConcept([frontier, checked('old', daysAgo(200))], noneAsked, {
        answered,
        now,
      });
      expect([answered, picked?.id]).toEqual([answered, 'untouched']);
    }
  });

  it('skips the turn when nothing has gone a month unchecked', () => {
    const picked = nextConcept([frontier, checked('tuesday', daysAgo(5))], noneAsked, {
      answered: 4,
      now,
    });
    expect(picked?.id).toBe('untouched');
  });

  it('leaves out a claim settled by inference rather than by an answer', () => {
    const inferred = { ...concept('inferred', 'known'), testedAt: daysAgo(200) };
    const picked = nextConcept([frontier, inferred], noneAsked, { answered: 4, now });
    expect(picked?.id).toBe('untouched');
  });

  it('picks as it always did when no cadence is passed', () => {
    const picked = nextConcept([frontier, checked('old', daysAgo(200))], noneAsked);
    expect(picked?.id).toBe('untouched');
  });
});

describe('which check the next question is for', () => {
  const CHECKS = ['Rules out a pay freeze.', 'Applies at 4% inflation.', 'The Lucas objection.'];

  it('takes the first one when nothing has been asked', () => {
    expect(nextMasteryCheck(CHECKS, [])).toBe('Rules out a pay freeze.');
  });

  it('moves to a check nobody has been asked about', () => {
    expect(nextMasteryCheck(CHECKS, ['Rules out a pay freeze.'])).toBe('Applies at 4% inflation.');
  });

  it('comes back round once every check has had a question', () => {
    // Only then, which is the point of the list: a second question about the
    // same check is the same information asked twice.
    expect(nextMasteryCheck(CHECKS, CHECKS)).toBe('Rules out a pay freeze.');
  });

  it('goes for the one asked about least', () => {
    const asked = ['Rules out a pay freeze.', 'Rules out a pay freeze.', 'The Lucas objection.'];
    expect(nextMasteryCheck(CHECKS, asked)).toBe('Applies at 4% inflation.');
  });

  it('ignores a question that was aimed at nothing', () => {
    expect(nextMasteryCheck(CHECKS, [null, null])).toBe('Rules out a pay freeze.');
  });

  it('has nothing to aim at on a concept with no checks', () => {
    // That concept is probed against its claim, the way everything was before.
    expect(nextMasteryCheck([], [])).toBeNull();
  });
});
