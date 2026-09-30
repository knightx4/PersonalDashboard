import { TRIAGE_FLOOR } from '@/lib/feedback/triage';

/**
 * Jev's score on an idea (plan #1326, under feature #1320).
 *
 * How much the idea helps what its workspace is for, effort left out
 * (decision #1325): a five-level answer scaled to 0 to 100, with Jev's
 * confidence, stored in `ideas.score` (migration 0138). An answer under the
 * same 0.8 floor triage uses is kept and shown as unsure.
 *
 * Null on the row means no score yet, whether the idea predates scoring or
 * Jev failed on it; the catch-up retries every null.
 *
 * Pure and without a `server-only` guard, so a script can read and write
 * scores under plain `tsx`.
 */
export type IdeaScore = {
  /** 0 to 100. */
  value: number;
  /** Jev's confidence in the answer, 0 to 1. */
  confidence: number;
  /** When it was asked, as an ISO time. */
  at: string;
};

export const SCORE_FLOOR = TRIAGE_FLOOR;

export function isSureScore(score: IdeaScore | null): boolean {
  return score !== null && score.confidence >= SCORE_FLOOR;
}

/** A stored `score` value read back, or null when it is missing or not this shape. */
export function scoreFrom(value: unknown): IdeaScore | null {
  if (!value || typeof value !== 'object') return null;
  const { value: v, confidence, at } = value as Record<string, unknown>;
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 100) return null;
  if (typeof confidence !== 'number' || !Number.isFinite(confidence)) return null;
  if (typeof at !== 'string') return null;
  return { value: v, confidence, at };
}
