import { describe, expect, it } from 'vitest';
import {
  barFraction,
  barPercent,
  probePayloadSchema,
  standingOf,
  toProbe,
  weightFor,
  WEIGHT_INCONCLUSIVE,
  WEIGHT_REINFORCED,
  WEIGHT_SETTLED_NEW,
} from './probe-payload';
import type { CheckStanding } from './probe-payload';

/**
 * Two things that must not be allowed to lie.
 *
 * A probe item that cannot teach anything when its reason is shown back to
 * you, and a progress bar that claims more than the system can know. The
 * second is the one worth being strict about: a bar is read as a fact about
 * the person rather than about the evidence, and one that reaches 100% is
 * saying "you know this subject", which nothing here can establish.
 */

const good = {
  question: 'Expectations adjust fully to the new inflation rate. What happens to employment?',
  options: ['It stays high', 'It returns to where it was', 'It falls below where it started'],
  correct_index: 1,
  reason:
    'Once the inflation is expected, wages are set with it in mind, so the real wage returns to where it was and so does employment.',
};

const parse = (input: unknown) => probePayloadSchema.parse(input);

describe('a question worth asking', () => {
  it('comes through with its options and its reason', () => {
    const result = toProbe(parse(good));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.probe.options).toHaveLength(3);
      expect(result.probe.correctIndex).toBe(1);
      expect(result.probe.reason).toContain('real wage');
    }
  });
});

describe('a question thrown away', () => {
  it('is thrown away when the reason only points back at the question', () => {
    // The cheapest verification available. A reason like this means the item
    // was never about the claim, and it teaches nothing when shown back.
    const result = toProbe(parse({ ...good, reason: 'Because option B is the only one that fits.' }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('reason-points-back');
  });

  it('catches the other ways of pointing back', () => {
    for (const reason of [
      'The second option is correct.',
      'Answer C, as stated above.',
      'The other options are all wrong.',
    ]) {
      const result = toProbe(parse({ ...good, reason }));
      expect(result.ok).toBe(false);
    }
  });

  it('is thrown away when the correct answer is not one of the options', () => {
    const result = toProbe(parse({ ...good, correct_index: 7 }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('index-out-of-range');
  });

  it('is thrown away when an option is repeated', () => {
    // A repeated distractor makes the question easier than it looks, and if
    // the repeat is the right answer it makes it unanswerable.
    const result = toProbe(
      parse({ ...good, options: ['It stays high', 'it stays HIGH', 'It falls'] }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('repeated-option');
  });

  it('is thrown away when the model says the claim cannot carry one', () => {
    const result = toProbe(parse({ ...good, unusable: true }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('unusable');
  });

  it('never accepts fewer than two options', () => {
    expect(() => parse({ ...good, options: ['Only this'], correct_index: 0 })).toThrow();
  });
});

describe('where a check stands', () => {
  const answered = (check: string | null, chosenIndex: number | null) => ({
    masteryCheck: check,
    chosenIndex,
    correctIndex: 1,
  });

  it('is untouched when nothing has been answered about it', () => {
    expect(standingOf('Explains the long run.', [])).toBe('untouched');
    expect(standingOf('Explains the long run.', [answered('Explains the long run.', null)])).toBe(
      'untouched',
    );
  });

  it('ignores what was answered about a different check', () => {
    expect(
      standingOf('Explains the long run.', [
        answered('Says what it rules out.', 0),
        answered(null, 1),
      ]),
    ).toBe('untouched');
  });

  it('is missed after a wrong answer and nothing right', () => {
    expect(standingOf('Explains the long run.', [answered('Explains the long run.', 0)])).toBe(
      'missed',
    );
  });

  it('is right once one answer got it right, whatever else happened', () => {
    expect(
      standingOf('Explains the long run.', [
        answered('Explains the long run.', 0),
        answered('Explains the long run.', 1),
      ]),
    ).toBe('right');
  });
});

describe('what an answer was worth', () => {
  const worth = (input: {
    correct?: boolean;
    standing?: CheckStanding | null;
    wasSettled?: boolean;
    conclusive?: boolean;
  }) =>
    weightFor({
      conclusive: input.conclusive ?? true,
      correct: input.correct ?? true,
      standing: input.standing ?? null,
      wasSettled: input.wasSettled ?? false,
    });

  it('is a full point for getting a check right that nobody had got right', () => {
    expect(worth({ standing: 'untouched', correct: true })).toBe(WEIGHT_SETTLED_NEW);
    expect(worth({ standing: 'missed', correct: true })).toBe(WEIGHT_SETTLED_NEW);
  });

  it('is a full point for a first miss on a check', () => {
    // #352: the first wrong answer said something nobody knew either -- that
    // the part was missing.
    expect(worth({ standing: 'untouched', correct: false })).toBe(WEIGHT_SETTLED_NEW);
  });

  it('is a fraction for answering again about a check already got right', () => {
    // What stops the bar rewarding ten easy questions about the same part.
    expect(worth({ standing: 'right', correct: true })).toBe(WEIGHT_REINFORCED);
    expect(worth({ standing: 'right', correct: false })).toBe(WEIGHT_REINFORCED);
    expect(WEIGHT_REINFORCED).toBeLessThan(WEIGHT_SETTLED_NEW);
  });

  it('is nothing for missing a check that was already missed', () => {
    expect(worth({ standing: 'missed', correct: false })).toBe(WEIGHT_INCONCLUSIVE);
  });

  it('falls back to the concept for a question written against no check', () => {
    expect(worth({ standing: null, wasSettled: false })).toBe(WEIGHT_SETTLED_NEW);
    expect(worth({ standing: null, wasSettled: true })).toBe(WEIGHT_REINFORCED);
    expect(worth({ standing: null, wasSettled: false, correct: false })).toBe(WEIGHT_SETTLED_NEW);
  });

  it('is nothing at all for an inconclusive answer', () => {
    expect(worth({ standing: 'untouched', conclusive: false })).toBe(WEIGHT_INCONCLUSIVE);
  });
});

describe('the bar', () => {
  it('is empty before anything has been answered', () => {
    expect(barPercent(0)).toBe(0);
    expect(barFraction(0)).toBe(0);
  });

  it('reaches about 80% after ten clean answers', () => {
    // The number the spec picked the curve for: fast at first, then slower.
    expect(barPercent(10)).toBeGreaterThanOrEqual(78);
    expect(barPercent(10)).toBeLessThanOrEqual(82);
  });

  it('is around 96% after twenty', () => {
    expect(barPercent(20)).toBeGreaterThanOrEqual(94);
    expect(barPercent(20)).toBeLessThanOrEqual(97);
  });

  it('never reads 100%, however many questions are answered', () => {
    // Not a rounding trick. Nothing here can establish that somebody knows a
    // subject, so a full bar would be claiming something the system cannot.
    expect(barPercent(40)).toBe(99);
    expect(barPercent(1000)).toBe(99);
  });

  it('is short of complete at any answerable number of questions', () => {
    // The curve approaches 1 and never arrives. Asserted at forty rather than
    // at a thousand: 1 − 0.85^1000 is not representable as a double and comes
    // back as exactly 1, which is a fact about floating point rather than
    // about the bar. The cap above is what carries the promise regardless.
    expect(barFraction(40)).toBeLessThan(1);
    expect(barFraction(100)).toBeLessThan(1);
  });

  it('shows something as soon as anything is answered', () => {
    // A bar reading zero right after a correct answer reads as broken.
    expect(barPercent(0.3)).toBeGreaterThan(0);
  });

  it('rises more slowly the further along it is', () => {
    const first = barPercent(1) - barPercent(0);
    const later = barPercent(21) - barPercent(20);
    expect(later).toBeLessThan(first);
  });
});
