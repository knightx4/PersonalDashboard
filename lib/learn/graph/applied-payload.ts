import { z } from 'zod';

import { contentWords, givesAwayAnswer } from '@/lib/learn/graph/opening-payload';

/**
 * What an applied case has to be before it is worth asking.
 *
 * The second rung of #386: a short situation the reader has not seen, answered
 * in a sentence or two of their own. Pure, so the rules can be checked without
 * a network, the way the multiple-choice rules in probe-payload.ts are.
 *
 * Two rules, and each one is a way a case comes back looking fine and
 * measures nothing:
 *
 *   The case carries its own answer. Somebody who can read the answer out of
 *   the situation has shown that they can read.
 *
 *   The case is the claim asked back. A situation built only out of the words
 *   of the claim is the recognise rung with a text box on it, and the whole
 *   point of this rung is a situation the claim does not already describe.
 *
 * A case that fails either is thrown away rather than repaired, the same as a
 * probe: writing the missing half here would mean inventing the situation the
 * answer is then graded against.
 */

export const appliedPayloadSchema = z.object({
  /** The situation, in a few sentences. Longer than a question, hence the room. */
  situation: z.string().trim().min(1).max(1200),
  /** What to say about the situation, in a phrase or a sentence. */
  question: z.string().trim().min(1).max(600),
  /** The answer expected, which is what a typed one is graded against. */
  expected: z.string().trim().min(1).max(600),
  /** Said out loud when the claim cannot carry a case worth asking. */
  unusable: z.boolean().default(false),
});

export type AppliedPayload = z.infer<typeof appliedPayloadSchema>;

/** One applied case, once it has passed its own check. */
export type AppliedCase = {
  situation: string;
  question: string;
  expected: string;
  /**
   * The check of understanding the case was aimed at, as it read when the case
   * was written. Null for a concept with no checks, which is asked about its
   * claim in general. Carried in rather than reported by the model, the same as
   * a probe's.
   */
  masteryCheck: string | null;
};

export type AppliedRejection = 'unusable' | 'gives-away-answer' | 'asks-the-claim-back';

/**
 * A case that says nothing the claim did not.
 *
 * Every distinctive word of the situation having to appear in the claim is a
 * deliberately strict bar, the same one `givesAwayAnswer` sets: a case about
 * the same subject shares two or three words with the claim as a matter of
 * course, and that is not this. What this catches is the situation that is the
 * claim with the word "suppose" in front of it.
 */
export function asksTheClaimBack(
  situation: string,
  claim: string,
): boolean {
  const words = contentWords(situation);
  if (words.length < 2) return false;

  const inClaim = new Set(contentWords(claim));
  return words.every((word) => inClaim.has(word));
}

/**
 * Turn a payload into a case, or say why it is not one.
 *
 * The situation and the question are checked together for the answer being
 * given away, because they are read together: a question that repeats the
 * expected answer gives it away whichever half of the case it sits in.
 */
export function toAppliedCase(
  payload: AppliedPayload,
  /** The claim the case is about, which the second rule is measured against. */
  claim: string,
  /** What the case was aimed at. Carried in, not reported by the model. */
  masteryCheck: string | null = null,
): { ok: true; case: AppliedCase } | { ok: false; reason: AppliedRejection } {
  if (payload.unusable) return { ok: false, reason: 'unusable' };

  const situation = payload.situation.trim();
  const question = payload.question.trim();
  const expected = payload.expected.trim();

  if (givesAwayAnswer({ question: `${situation}\n${question}`, expected })) {
    return { ok: false, reason: 'gives-away-answer' };
  }

  if (asksTheClaimBack(situation, claim)) {
    return { ok: false, reason: 'asks-the-claim-back' };
  }

  return { ok: true, case: { situation, question, expected, masteryCheck } };
}

/**
 * A case as one piece of text, and back out of it.
 *
 * `learn.probes` keeps one question per row, and an applied case is two parts:
 * the situation and what to say about it. They are stored joined by a blank
 * line and read back by splitting on the last one, so nothing but the question
 * column is needed to show the case again or to grade an answer to it.
 *
 * The question half is flattened to a single line on the way in, which is what
 * makes the split exact rather than a guess about where the situation ended.
 */
export function joinCase(situation: string, question: string): string {
  const flattened = question.replace(/\s*\n\s*/g, ' ').trim();
  return `${situation.trim()}\n\n${flattened}`;
}

/**
 * The two halves of a stored case.
 *
 * Text with no blank line in it is all question: that is what a row written by
 * anything but `joinCase` looks like, and showing it as the question shows all
 * of it rather than half.
 */
export function splitCase(stored: string): { situation: string; question: string } {
  const at = stored.lastIndexOf('\n\n');
  if (at === -1) return { situation: '', question: stored.trim() };
  return { situation: stored.slice(0, at).trim(), question: stored.slice(at + 2).trim() };
}
