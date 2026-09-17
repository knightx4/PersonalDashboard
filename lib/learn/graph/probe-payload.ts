import { z } from 'zod';

/**
 * What a probe question has to be before it is worth asking, and what a
 * session's progress bar is allowed to claim.
 *
 * Pure, so both can be tested without a network. The rules come straight from
 * the spec and each one is a way a generated question is bad while looking
 * fine:
 *
 *   A question that tests recall of a name rather than use of an idea. Not
 *   mechanically checkable, so the prompt carries that one.
 *
 *   A wrong option nobody would pick, which makes the question easier than it
 *   looks. Also the prompt's job.
 *
 *   A reason that can only be written by pointing back at the question --
 *   "because option B is the only one that fits". That one *is* mechanically
 *   checkable, roughly, and it is the cheapest verification available: a
 *   reason that does not stand on its own means the item was never about the
 *   claim. Rejecting it here costs one wasted call and catches most of the bad
 *   items, which is the trade the spec asks for.
 */

export const MIN_OPTIONS = 2;
export const MAX_OPTIONS = 6;

export const probePayloadSchema = z.object({
  question: z.string().trim().min(1).max(1000),
  options: z.array(z.string().trim().min(1).max(500)).min(MIN_OPTIONS).max(MAX_OPTIONS),
  correct_index: z.number().int().min(0),
  reason: z.string().trim().min(1).max(1000),
  /** Said out loud when the claim cannot carry a question worth asking. */
  unusable: z.boolean().default(false),
});

export type ProbePayload = z.infer<typeof probePayloadSchema>;

export type Probe = {
  question: string;
  options: string[];
  correctIndex: number;
  reason: string;
  /**
   * The check of understanding the question was aimed at, as it read when the
   * question was written. Null for a concept with no checks, which is probed
   * against its claim in general the way everything was before.
   */
  masteryCheck: string | null;
};

export type ProbeRejection =
  | 'unusable'
  | 'index-out-of-range'
  | 'repeated-option'
  | 'reason-points-back';

/**
 * Phrases that only mean something while you are looking at the question.
 *
 * A reason built out of these is a reason about the multiple-choice item
 * rather than about the idea, which is exactly the item that teaches nothing
 * when it is shown back to you afterwards.
 */
const POINTS_BACK = [
  /\boption\s+[a-f1-6]\b/i,
  /\bthe (first|second|third|fourth|fifth|last) (option|answer|choice)\b/i,
  /\banswer\s+[a-f]\b/i,
  /\b(all|none) of the (above|others)\b/i,
  /\bas (stated|shown|written) (above|in the question)\b/i,
  /\bthe other (options|answers|choices)\b/i,
];

/**
 * Turn a payload into a probe, or say why it is not one.
 *
 * A rejected item is thrown away rather than repaired. Repairing it would mean
 * writing the missing half here, and the missing half is the part that decides
 * whether the question is about the claim at all.
 */
export function toProbe(
  payload: ProbePayload,
  /** What the question was aimed at. Carried in, not reported by the model. */
  masteryCheck: string | null = null,
): { ok: true; probe: Probe } | { ok: false; reason: ProbeRejection } {
  if (payload.unusable) return { ok: false, reason: 'unusable' };

  const options = payload.options.map((option) => option.trim());
  if (payload.correct_index >= options.length) {
    return { ok: false, reason: 'index-out-of-range' };
  }

  const seen = new Set(options.map((option) => option.toLowerCase()));
  if (seen.size !== options.length) return { ok: false, reason: 'repeated-option' };

  if (POINTS_BACK.some((pattern) => pattern.test(payload.reason))) {
    return { ok: false, reason: 'reason-points-back' };
  }

  return {
    ok: true,
    probe: {
      question: payload.question.trim(),
      options,
      correctIndex: payload.correct_index,
      reason: payload.reason.trim(),
      masteryCheck,
    },
  };
}

// ---------------------------------------------------------------------------
// The bar
// ---------------------------------------------------------------------------

/**
 * What one answer told us, on the spec's scale.
 *
 * Weighted by information rather than by questions answered, which is what
 * stops the bar rewarding somebody for answering ten easy questions about the
 * same node.
 */
export const WEIGHT_SETTLED_NEW = 1.0;
export const WEIGHT_REINFORCED = 0.3;
export const WEIGHT_INCONCLUSIVE = 0;

/**
 * The three rungs, hardest last, as `learn.probe_rung` holds them.
 *
 * Here rather than in session.ts because the rules below read it and this file
 * has no client in it. `defend` is in the enum and nothing returns it yet: the
 * defence rung is not built, and the picker cannot ask for a question no writer
 * can produce.
 */
export type Rung = 'recognise' | 'apply' | 'defend';

/**
 * One question already asked about a concept, as the rules here read it.
 *
 * The columns rather than a verdict, because which of them carries the answer
 * depends on the rung: a multiple-choice question is answered by picking an
 * index, and a written one by a grader's judgement on what was typed. Both are
 * null until the question is answered, which is what makes an abandoned
 * question different from a wrong one.
 */
export type AskedRung = {
  rung: Rung;
  masteryCheck: string | null;
  chosenIndex: number | null;
  /** Null on a written row, which has no options and no index that is right. */
  correctIndex: number | null;
  responseCorrect: boolean | null;
};

/** Whether a question has been answered at all. */
export function wasAnswered(probe: AskedRung): boolean {
  return probe.rung === 'recognise' ? probe.chosenIndex !== null : probe.responseCorrect !== null;
}

/** Whether the answer given was right. False for one nobody has answered. */
export function wasRight(probe: AskedRung): boolean {
  if (probe.rung === 'recognise') {
    return probe.chosenIndex !== null && probe.chosenIndex === probe.correctIndex;
  }
  return probe.responseCorrect === true;
}

/**
 * What the answers already given about one check did with it.
 *
 * `right` means one of them got it right, whatever happened before or after:
 * the check is covered from then on. `missed` means one of them got it wrong
 * and none has got it right. `untouched` means it has never been answered,
 * which includes a check that has been asked about and not answered.
 */
export type CheckStanding = 'right' | 'missed' | 'untouched';

/**
 * Where a check stands at one rung, from the questions already answered about
 * it there.
 *
 * Read off the rows rather than kept as a count, for the same reason the bar
 * is: a column saying how many checks are covered would have to be right after
 * every answer, and the answers themselves already say.
 *
 * The rung is half of the key, and #401 is why. Answering the applied case
 * about a check you got right out of four is the first time anybody has seen
 * you use that idea, so it is new information and the bar has to pay for it;
 * keyed on the check alone it read as a repeat and earned a fraction.
 */
export function standingOf(
  check: string,
  rung: Rung,
  earlier: readonly AskedRung[],
): CheckStanding {
  let missed = false;

  for (const probe of earlier) {
    if (probe.masteryCheck !== check || probe.rung !== rung || !wasAnswered(probe)) continue;
    if (wasRight(probe)) return 'right';
    missed = true;
  }

  return missed ? 'missed' : 'untouched';
}

/**
 * What one answer was worth.
 *
 * A check you get right for the first time is worth the full amount, and so is
 * a first answer about a check nobody has answered about, right or wrong: both
 * said something that was not known before. A check somebody has already got
 * right is worth the reinforced fraction however this answer goes, and missing
 * a check that was already missed is worth nothing, because the second miss
 * says exactly what the first one did.
 *
 * A concept with no checks has nothing to decide from, so it keeps the older
 * rule: full for a concept that was not settled, the fraction for one that
 * was.
 */
export function weightFor(input: {
  conclusive: boolean;
  /** Whether this answer was right. */
  correct: boolean;
  /** Where the check stood before this answer; null when there is no check. */
  standing: CheckStanding | null;
  /** Read only when there is no check: was the concept already settled. */
  wasSettled: boolean;
}): number {
  if (!input.conclusive) return WEIGHT_INCONCLUSIVE;
  if (input.standing === null) {
    return input.wasSettled ? WEIGHT_REINFORCED : WEIGHT_SETTLED_NEW;
  }
  if (input.standing === 'right') return WEIGHT_REINFORCED;
  if (input.standing === 'missed') {
    return input.correct ? WEIGHT_SETTLED_NEW : WEIGHT_INCONCLUSIVE;
  }
  return WEIGHT_SETTLED_NEW;
}

/** The decay the spec picked: fast at first, then slower and slower. */
const BASE = 0.85;

/**
 * How full the bar is, from 0 to 1.
 *
 * `filled = 1 − 0.85^w`, where w is total information weight. Ten clean
 * answers is about 80%, twenty about 96%, forty about 99.8%.
 */
export function barFraction(totalWeight: number): number {
  if (totalWeight <= 0) return 0;
  return 1 - Math.pow(BASE, totalWeight);
}

/**
 * What the bar is allowed to say, as a percentage.
 *
 * Capped at 99, and that is not a trick to avoid rounding. Nothing here can
 * establish that somebody knows a subject -- the graph is never finished and
 * the store admits it -- so a bar reading 100% would be claiming something the
 * system cannot know. It is also floored at 1 once anything at all has been
 * answered, because a bar that reads zero after a correct answer reads as
 * broken.
 */
export function barPercent(totalWeight: number): number {
  const fraction = barFraction(totalWeight);
  if (fraction <= 0) return 0;
  return Math.min(99, Math.max(1, Math.round(fraction * 100)));
}
