/**
 * The lowest Jev fit score a recommended role may have and still be shown
 * (job_search 0052). Set on /jobs/settings; 0 turns it off.
 *
 * Every source is held to it: a role Jev scores below it comes off the list
 * as expired with reason 'low_fit' (score-run.ts), and a role at a
 * discovered startup is scored before it is written and is never written
 * below it (discover/roles-run.ts). Pure, so both share the rule.
 */
import type { OpeningScores } from './scores';

export const DEFAULT_MIN_FIT_SCORE = 25;

/** The stored setting as a number from 0 to 100, the default when unreadable. */
export function readMinFitScore(value: unknown): number {
  const n = typeof value === 'string' ? Number(value) : value;
  if (typeof n !== 'number' || !Number.isFinite(n)) return DEFAULT_MIN_FIT_SCORE;
  return Math.min(100, Math.max(0, Math.round(n)));
}

/**
 * Below the gate: Jev gave a fit score and it is under the minimum. A role
 * Jev could not give a fit score to is not held back on that account.
 */
export function belowFitGate(scores: OpeningScores | null | undefined, minimum: number): boolean {
  if (minimum <= 0) return false;
  const fit = scores?.fit_score?.value;
  return typeof fit === 'number' && fit < minimum;
}
