import { describe, expect, it } from 'vitest';
import {
  DEV_STATES,
  DEV_STATE_WORD,
  DISMISSED_WORD,
  feedbackState,
  findingState,
  planState,
  raisedState,
} from '@/lib/dev/words';
import { PLAN_HEALTHS } from '@/lib/plan/tree';

describe('the shared words', () => {
  it('gives every state exactly one word', () => {
    const words = DEV_STATES.map((state) => DEV_STATE_WORD[state]);
    expect(words.filter((word) => word.trim().length > 0)).toHaveLength(DEV_STATES.length);
    expect(new Set(words).size).toBe(DEV_STATES.length);
  });

  it('does not use the put-aside word for a state', () => {
    // Dismissing a row is "not right now" and it hides the row; dropping one is
    // a decision with a reason. Two ideas, and the plan and the ideas page both
    // already keep them apart.
    expect(Object.values(DEV_STATE_WORD)).not.toContain(DISMISSED_WORD);
  });
});

/**
 * The four names for one fact this step exists to remove: a step decided
 * against was "dropped", a note "declined", a raise and a finding "dismissed".
 */
describe('a row decided against', () => {
  it('reads the same on every queue', () => {
    const words = [
      DEV_STATE_WORD[feedbackState('declined') ?? 'waiting'],
      DEV_STATE_WORD[raisedState('dismissed') ?? 'waiting'],
      DEV_STATE_WORD[findingState('dismissed') ?? 'waiting'],
      DEV_STATE_WORD[planState('dropped') ?? 'waiting'],
    ];
    expect(new Set(words)).toEqual(new Set(['Dropped']));
  });
});

describe('a row somebody is working', () => {
  it('reads the same on the plan and in the notes queue', () => {
    expect(feedbackState('in_progress')).toBe('working');
    expect(planState('in_progress')).toBe('working');
  });
});

describe('a row waiting on the person', () => {
  it('reads the same wherever it is waiting', () => {
    expect(feedbackState('blocked')).toBe('waiting');
    expect(raisedState('open')).toBe('waiting');
    expect(findingState('open')).toBe('waiting');
    expect(planState('blocked')).toBe('waiting');
  });
});

/**
 * A state a queue genuinely owns keeps its own word, and saying which those are
 * is the other half of the rule: a queue that mapped everything onto five words
 * would lose what it knows that the others do not.
 */
describe('what each queue keeps for itself', () => {
  it('leaves the notes queue its planned notes', () => {
    expect(feedbackState('planned')).toBeNull();
  });

  it('leaves a raise its answer and a finding its confirmation', () => {
    expect(raisedState('answered')).toBeNull();
    expect(findingState('confirmed')).toBeNull();
  });

  it('leaves the plan its questions, proposals and waits', () => {
    expect(planState('unanswered')).toBeNull();
    expect(planState('answered')).toBeNull();
    expect(planState('proposed')).toBeNull();
    expect(planState('waiting')).toBeNull();
    expect(planState('not_started')).toBeNull();
  });

  it('places every plan health, so a new one cannot slip through unplaced', () => {
    for (const health of PLAN_HEALTHS) {
      expect(() => planState(health)).not.toThrow();
    }
  });
});
