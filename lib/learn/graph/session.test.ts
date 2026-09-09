import { describe, expect, it } from 'vitest';
import { nextConcept } from './session';
import type { Concept, KnowledgeState } from './model';

/**
 * Which claim the next question is about.
 *
 * The rule is worth a test because getting it wrong is invisible: a session
 * that keeps circling the same node still asks real questions and still fills
 * a bar, it just stops finding anything out. The order below is what makes ten
 * questions worth ten questions.
 */

function concept(id: string, state: KnowledgeState): Concept {
  return {
    id,
    name: id,
    claim: `${id} is the case.`,
    basis: 'Seeded.',
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

  it('has nothing to say about an empty subject', () => {
    expect(nextConcept([], noneAsked)).toBeNull();
  });

  it('still finds something when everything is settled', () => {
    // Worth a fraction of the information, but better than refusing to ask.
    expect(nextConcept([concept('settled', 'known')], noneAsked)?.id).toBe('settled');
  });
});
