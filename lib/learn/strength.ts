import { KIND_CEILING, type EvidenceKind } from '@/lib/learn/evidence/kinds';
import type { KnowledgeState, StateBasis } from '@/lib/learn/graph/model';
import { isGuess } from '@/lib/learn/confidence';

/**
 * How well you know an idea on a given day, from 0 to 1 (plan #1997.1).
 *
 * Pure, and it takes the date, so the map can ask for today and the timeline
 * for any other day. The score is level times evidence times memory:
 *
 * - level: what the state says you can do (shaky 0.35 up to sharp 1).
 * - evidence: how the state came to be believed (tested 1, declared 0.75,
 *   inferred 0.5).
 * - memory: 2 to the power of minus the days since the state was set over a
 *   half-life. The state is set at `tested_at`, or at `declared_at` when the
 *   idea was never tested. A reviewed idea (`review_interval_days` set) has a
 *   half-life of 1.5 times that interval; an unreviewed one halves every 30
 *   days when tested and every 45 when declared.
 *
 * An idea with no date to measure from (inferred from something above it)
 * does not fade: its memory is 1 and the 0.5 evidence is the whole discount.
 * A misconception scores 0 and is reported by `isMisconception`, because it
 * is a different problem from a low score. `unknown` scores 0 too.
 */

export const LEVEL_WEIGHT: Record<KnowledgeState, number> = {
  unknown: 0,
  shaky: 0.35,
  recognised: 0.55,
  known: 0.8,
  sharp: 1,
  misconception: 0,
};

export const EVIDENCE_WEIGHT: Record<StateBasis, number> = {
  tested: 1,
  declared: 0.75,
  inferred: 0.5,
};

/** Half-life in days of an idea that has never been reviewed. */
export const HALF_LIFE_TESTED_DAYS = 30;
export const HALF_LIFE_DECLARED_DAYS = 45;
/** A review interval is stretched by this much to give the half-life. */
export const REVIEW_HALF_LIFE_FACTOR = 1.5;

/** The nearest known ideas an unknown idea draws haze from. */
export const SPILL_NEIGHBOURS = 6;

/** The columns of `learn.concept_state` the score reads. */
export type StrengthInput = {
  state: KnowledgeState;
  established: StateBasis;
  tested_at: string | Date | null;
  declared_at: string | Date | null;
  review_interval_days: number | null;
};

const DAY_MS = 86_400_000;

function time(value: string | Date | null): number | null {
  if (value === null) return null;
  const t = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isNaN(t) ? null : t;
}

/** The day the state was set: tested_at, else declared_at, else none. */
export function stateSetAt(row: Pick<StrengthInput, 'tested_at' | 'declared_at'>): Date | null {
  const t = time(row.tested_at) ?? time(row.declared_at);
  return t === null ? null : new Date(t);
}

/** Days for the memory of this idea to halve. */
export function halfLifeDays(
  row: Pick<StrengthInput, 'established' | 'tested_at' | 'review_interval_days'>,
): number {
  if (row.review_interval_days !== null && row.review_interval_days > 0) {
    return row.review_interval_days * REVIEW_HALF_LIFE_FACTOR;
  }
  return row.established === 'declared' || row.tested_at === null
    ? HALF_LIFE_DECLARED_DAYS
    : HALF_LIFE_TESTED_DAYS;
}

/** 1 on the day the state was set, halving every half-life after. */
export function memory(row: StrengthInput, on: Date): number {
  const set = stateSetAt(row);
  if (set === null) return 1;
  const days = Math.max(0, (on.getTime() - set.getTime()) / DAY_MS);
  return Math.pow(2, -days / halfLifeDays(row));
}

/** How well the idea is known on `on`, from 0 to 1. */
export function strength(row: StrengthInput, on: Date): number {
  const level = LEVEL_WEIGHT[row.state];
  if (level === 0) return 0;
  return level * EVIDENCE_WEIGHT[row.established] * memory(row, on);
}

/**
 * Where an answer leaves an idea once how sure you were is read (plan
 * #2522.3). `earned` is what the answer would set on its own: the rung's state
 * when right, shaky when wrong.
 *
 * A right answer given as a guess returns null: leave the idea where it was.
 * Nothing moves above recognised, a shaky idea stays shaky, an untested one
 * stays untested and a named misconception stays named, because a guess that
 * lands shows nothing about what you hold. A wrong answer moves the idea
 * whatever the confidence; a miss at Guessing is still a miss.
 */
export function stateAfterAnswer(
  earned: KnowledgeState,
  answer: { correct: boolean; confidence: number | null | undefined },
): KnowledgeState | null {
  if (answer.correct && isGuess(answer.confidence)) return null;
  return earned;
}

/** A misconception is flagged on its own, never as a low score. */
export function isMisconception(row: Pick<StrengthInput, 'state'>): boolean {
  return row.state === 'misconception';
}

/** The next day after `from` on which the strength has halved again, or null when it does not fade. */
export function halvesOn(row: StrengthInput, from: Date): Date | null {
  const set = stateSetAt(row);
  if (set === null || LEVEL_WEIGHT[row.state] === 0) return null;
  const half = halfLifeDays(row) * DAY_MS;
  const elapsed = Math.max(0, from.getTime() - set.getTime());
  const next = Math.floor(elapsed / half) + 1;
  return new Date(set.getTime() + next * half);
}

/** A known idea near an unknown one: its strength on the day and how alike they are (cosine, 0 to 1). */
export type SpillNeighbour = { strength: number; similarity: number };

/**
 * The haze an unknown idea carries from the known ideas beside it: the sum of
 * strength times similarity squared over its six nearest, capped at 1.
 * Pass any number of neighbours; the six most similar count.
 */
export function spillOver(neighbours: readonly SpillNeighbour[]): number {
  const nearest = [...neighbours]
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, SPILL_NEIGHBOURS);
  let sum = 0;
  for (const n of nearest) {
    const s = Math.max(0, n.similarity);
    sum += Math.max(0, n.strength) * s * s;
  }
  return Math.min(1, sum);
}

// -- Evidence (plan #2006.6) -------------------------------------------------------

/**
 * The most evidence alone can give an idea: the score of a recognised idea
 * held as inferred, 0.55 times 0.5, about 0.28 (decision #2006.2, A). Notes,
 * courses and work never make an idea known; the strongest of them make it
 * glow faintly until a question confirms or clears it.
 */
export const EVIDENCE_CEILING = LEVEL_WEIGHT.recognised * EVIDENCE_WEIGHT.inferred;

/** One link of learn.evidence_links as the score reads it. */
export type EvidenceWeight = {
  /** What kind of evidence it is (plan #2172.2). */
  kind: EvidenceKind;
  /** The most the link can count for, 0 to 1: its weight, never past its kind's ceiling. */
  ceiling: number;
  /** How close the match is, 0 to 1. */
  similarity: number;
  /** When the link was found; a link found after the day asked about does not count. */
  foundAt?: string | null;
};

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/** 1 - product(1 - x): each value adds to the rest without the total passing 1. */
function combined(values: readonly number[]): number {
  let missing = 1;
  for (const v of values) missing *= 1 - clamp01(v);
  return 1 - missing;
}

/**
 * What evidence is worth on `on`, 0 to EVIDENCE_CEILING (plan #2172.2).
 *
 * Each link counts its ceiling times its similarity. Links of one kind
 * combine as 1 - product(1 - each), and never read past the highest ceiling
 * among them: five clippings are still clippings. The kinds then combine the
 * same way, never past the highest ceiling of any kind present. That share
 * of EVIDENCE_CEILING is the score, so only work at full weight reaches
 * recognised, a note at most half of it, a clipping a quarter and a mention
 * nothing. Without `on` every link counts. Evidence does not fade: it
 * carries no day it was shown to you.
 */
export function evidenceStrength(links: readonly EvidenceWeight[], on?: Date): number {
  const cutoff = on?.getTime();
  const byKind = new Map<EvidenceKind, { values: number[]; top: number }>();
  for (const link of links) {
    if (cutoff !== undefined && link.foundAt) {
      const found = Date.parse(link.foundAt);
      if (!Number.isNaN(found) && found > cutoff) continue;
    }
    const ceiling = Math.min(clamp01(link.ceiling), KIND_CEILING[link.kind] ?? 0);
    if (ceiling <= 0) continue;
    const group = byKind.get(link.kind) ?? { values: [], top: 0 };
    group.values.push(ceiling * clamp01(link.similarity));
    group.top = Math.max(group.top, ceiling);
    byKind.set(link.kind, group);
  }
  let top = 0;
  const perKind: number[] = [];
  for (const group of byKind.values()) {
    perKind.push(Math.min(group.top, combined(group.values)));
    top = Math.max(top, group.top);
  }
  return EVIDENCE_CEILING * Math.min(top, combined(perKind));
}

/** An idea no question has been asked about: no state row, or one never tested. */
export function isUntested(row: Pick<StrengthInput, 'established' | 'tested_at'> | null): boolean {
  return row === null || (row.established !== 'tested' && row.tested_at === null);
}

/**
 * The strength the map shows, evidence included. A tested idea keeps its own
 * score, since a question outranks anything inferred. An untested one takes
 * the larger of its own score and its evidence's, so declaring an idea still
 * lights it more than a note does. A misconception stays at 0 whatever backs it.
 */
export function strengthWithEvidence(
  row: StrengthInput | null,
  evidence: readonly EvidenceWeight[],
  on: Date,
): number {
  const own = row ? strength(row, on) : 0;
  if (row && (row.state === 'misconception' || !isUntested(row))) return own;
  if (evidence.length === 0) return own;
  return Math.max(own, evidenceStrength(evidence, on));
}
