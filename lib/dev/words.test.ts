import { describe, expect, it } from 'vitest';
import {
  DEV_STATES,
  DEV_STATE_WORD,
  DISMISSED_WORD,
  FEEDBACK_HEALTH_WORD,
  FINDING_HEALTH_WORD,
  IDEA_HEALTH_WORD,
  RAISED_HEALTH_WORD,
  planState,
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
      FEEDBACK_HEALTH_WORD.dropped,
      RAISED_HEALTH_WORD.dropped,
      FINDING_HEALTH_WORD.dropped,
      DEV_STATE_WORD[planState('dropped') ?? 'waiting'],
    ];
    expect(new Set(words)).toEqual(new Set(['Dropped']));
  });

  it('calls an idea put aside dismissed, which is not the same thing', () => {
    expect(IDEA_HEALTH_WORD.dropped).toBe(DISMISSED_WORD);
  });
});

describe('a row waiting on the person', () => {
  it('reads the same wherever it is waiting', () => {
    const words = [
      FEEDBACK_HEALTH_WORD.waiting,
      RAISED_HEALTH_WORD.waiting,
      FINDING_HEALTH_WORD.waiting,
      IDEA_HEALTH_WORD.waiting,
      DEV_STATE_WORD[planState('blocked') ?? 'ready'],
    ];
    expect(new Set(words)).toEqual(new Set(['Waiting on you']));
  });
});

describe('a row somebody is working', () => {
  it('reads the same on the plan and in the notes queue', () => {
    expect(FEEDBACK_HEALTH_WORD.working).toBe(DEV_STATE_WORD.working);
    expect(planState('in_progress')).toBe('working');
  });
});

/**
 * A state a queue genuinely owns keeps its own word, and saying which those are
 * is the other half of the rule: a queue that mapped everything onto five words
 * would lose what it knows that the others do not.
 */
describe('what each queue keeps for itself', () => {
  it('leaves the notes queue its planned notes and its answered ones', () => {
    expect(FEEDBACK_HEALTH_WORD.planned).toBe('Planned');
    expect(FEEDBACK_HEALTH_WORD.answered).toBe('Answered');
  });

  it('leaves a raise the one state it exists to show', () => {
    expect(RAISED_HEALTH_WORD.unfinished).toBe('Nothing done');
  });

  it('leaves a finding its confirmation', () => {
    expect(FINDING_HEALTH_WORD.ready).toBe('Confirmed');
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
