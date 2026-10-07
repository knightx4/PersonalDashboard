import { TRIAGE_FLOOR, isSure, type Triage, type TriageAnswer } from '@/lib/feedback/triage';
import type { JevResult, JevScoreAnswer } from '@/lib/jev/wire';
import { moduleById, type ModuleId } from '@/lib/modules';
import { APP_VISION } from '@/lib/specs/vision';

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
 * scores under plain `tsx`, and the Ideas tab can import the labels. The
 * question, what Jev reads and how the answer is read back are here (plan
 * #1324); the call itself is in lib/ideas/score-ask.ts.
 */
export type IdeaScore = {
  /** 0 to 100. */
  value: number;
  /** Jev's confidence in the answer, 0 to 1. */
  confidence: number;
  /** When it was asked, as an ISO time. */
  at: string;
  /**
   * Which wording of IDEA_SCORE_QUESTION it was asked under. Missing on a
   * score asked before the wording was numbered, which counts as version 1.
   */
  question?: number;
};

/**
 * The wording IDEA_SCORE_QUESTION is at. Raise it whenever the question or a
 * level changes: a score asked under other words is not comparable, so the
 * catch-up asks every live idea again (plan #1644). Version 2 moved small
 * fixes to often-used parts from "helps a little" to "helps somewhat".
 */
export const IDEA_SCORE_VERSION = 2;

/**
 * Whether a stored score has to be asked (again): there is none, or it was
 * asked under an older wording. The same rule as SCORE_DUE_FILTER, for code
 * that already has the row.
 */
export function needsScore(value: unknown): boolean {
  const score = scoreFrom(value);
  return score === null || (score.question ?? 1) !== IDEA_SCORE_VERSION;
}

/**
 * needsScore as a PostgREST `or` filter on `ideas.score`, for the catch-up's
 * read and for the guard on its write.
 */
export const SCORE_DUE_FILTER = `score.is.null,score->>question.is.null,score->>question.neq.${IDEA_SCORE_VERSION}`;

export const SCORE_FLOOR = TRIAGE_FLOOR;

/**
 * The score a suggestion needs to be offered (note 073cacdf).
 *
 * A session writes follow-ons by the handful, and one Jev scores under 40
 * barely helps its workspace. It goes in a fold of its own rather than
 * nowhere, so "did a session already think of that" still has an answer. Only
 * a suggestion: an idea you wrote down yourself is never hidden by a score.
 * An unscored suggestion is offered until it is scored.
 */
export const SUGGESTION_SCORE_FLOOR = 40;

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
  const { question } = value as Record<string, unknown>;
  return typeof question === 'number' ? { value: v, confidence, at, question } : { value: v, confidence, at };
}

/**
 * The question, five levels from lowest to highest. Benefit to the
 * workspace's vision only: Jev reads text and cannot judge how hard an idea
 * is to build, so effort is left out (decision #1325).
 */
export const IDEA_SCORE_QUESTION = {
  type: 'score',
  question:
    'How much would building this idea (idea) help what its workspace is for, as its vision ' +
    '(vision) describes it? Judge only how much it helps, and leave out how hard it would be to build. ' +
    'When no vision is written, judge it against what the workspace plainly does.',
  levels: [
    'Does nothing for what the workspace is for, or works against it',
    'Helps a little: a convenience at the edge of the workspace, in a part used now and then',
    'Helps somewhat: a real improvement to one part of the workspace, including a small fix to how a part used most days looks, moves or responds',
    'Helps a lot: moves a central part of the vision forward',
    'Essential: the workspace falls well short of its vision without it',
  ],
} as const;

/**
 * Jev's answer as a whole number from 0 to 100: its probability-weighted
 * score (0 to levels - 1, and it can fall between levels) over the top level,
 * as lib/jobs/suggest/scores.ts scales the opening scores. Five levels put
 * "helps somewhat" at 50.
 */
export function scaleIdeaScore(
  score: number,
  levels: number = IDEA_SCORE_QUESTION.levels.length,
): number {
  if (levels < 2 || !Number.isFinite(score)) return 0;
  return Math.round((Math.min(Math.max(score, 0), levels - 1) / (levels - 1)) * 100);
}

/** What Jev is told when the idea's workspace has no vision written. */
export const NO_VISION = 'No vision has been written for this workspace yet.';
/** What Jev is told when the idea was not triaged when it was filed. */
export const NOT_TRIAGED = 'Not triaged: it was filed without the triage questions.';

const PRIORITY_WORDS = { 1: 'do it next', 2: 'normal', 3: 'someday' } as const;

/** How the idea was triaged, in one line Jev can read. Unsure answers say so. */
export function triageLineForScore(triage: Triage | null): string {
  if (!triage) return NOT_TRIAGED;
  const parts: string[] = [];
  const unsure = (answer: TriageAnswer<unknown> | null) => (isSure(answer) ? '' : ' (unsure)');
  if (triage.module) {
    const scope =
      triage.module.value === 'app'
        ? 'the app as a whole'
        : (moduleById(triage.module.value)?.label ?? triage.module.value);
    parts.push(`about ${scope}${unsure(triage.module)}`);
  }
  if (triage.priority) {
    parts.push(`priority ${PRIORITY_WORDS[triage.priority.value]}${unsure(triage.priority)}`);
  }
  if (triage.duplicate?.value) {
    parts.push(`may repeat "${triage.duplicate.value.line}"${unsure(triage.duplicate)}`);
  }
  return parts.length > 0
    ? `Triaged as ${parts.join(', ')}.`
    : 'Triaged, but Jev gave no usable answers.';
}

/**
 * The vision an idea is read against, from what `loadModuleVisions` returns:
 * its workspace's, or the app's when it has none. A workspace with nothing
 * written gets null, never the app's.
 */
export function visionForIdea(
  visions: Readonly<Partial<Record<string, { body: string }>>>,
  module: ModuleId | null,
): string | null {
  return visions[module ?? APP_VISION]?.body?.trim() || null;
}

/**
 * What Jev reads about one idea: its text, the workspace it is filed under,
 * that workspace's vision, and how it was triaged. An idea with no workspace
 * is the app's and is read against the app's vision. A workspace with no
 * vision written says so and does not fall back to the app's, which would
 * score a Learn idea against goals Learn does not have.
 */
export function ideaScoreState(input: {
  body: string;
  /** The workspace, or null for the app as a whole. */
  module: ModuleId | null;
  /** The vision for that workspace (the app's when `module` is null), or null when none is written. */
  vision: string | null;
  triage: Triage | null;
}): Record<string, string> {
  const found = moduleById(input.module);
  const workspace = found
    ? `${found.label}: ${found.description}`
    : (input.module ?? 'The app as a whole');
  return {
    idea: input.body.trim(),
    workspace,
    vision: input.vision?.trim() || NO_VISION,
    triage: triageLineForScore(input.triage),
  };
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/** Jev's answer read into what is stored, or null when there is none to store. */
export function readIdeaScore(
  result: JevResult<JevScoreAnswer>,
  at: Date = new Date(),
): IdeaScore | null {
  if (!result.ok) return null;
  return {
    value: scaleIdeaScore(result.answer.score),
    confidence: round(result.answer.confidence),
    at: at.toISOString(),
    question: IDEA_SCORE_VERSION,
  };
}

/** One idea's score as the person reads it on the Ideas tab. */
export type IdeaScoreView = {
  /** "72", "72?" when Jev was unsure, "Unscored" when there is none. */
  text: string;
  /** The longer form, for a tooltip or a screen reader. */
  title: string;
  state: 'sure' | 'unsure' | 'unscored';
};

export function ideaScoreView(score: IdeaScore | null): IdeaScoreView {
  if (!score) {
    return { text: 'Unscored', title: 'Jev has not scored this idea yet', state: 'unscored' };
  }
  const value = Math.round(score.value);
  if (isSureScore(score)) {
    return { text: String(value), title: `Jev's score: ${value} out of 100`, state: 'sure' };
  }
  return {
    text: `${value}?`,
    title: `Jev's score: ${value} out of 100, unsure (confidence ${score.confidence.toFixed(2)})`,
    state: 'unsure',
  };
}
