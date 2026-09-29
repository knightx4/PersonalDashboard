import type { SpendSink } from '@/lib/core/spend/pricing';
import { askJevAll, type JevFailure, type JevQuestion, type JevResult, type JevScoreAnswer } from '@/lib/jev/wire';
import type { RequirementMatch } from '../evidence/match-payload';
import type { Requirement } from '../jd/requirements';
import { TERMINAL_STATUSES } from '../pipeline';
import { titleLevel } from './history';
import {
  OPENING_QUESTIONS,
  PERCENT_SCORES,
  SENIORITY_LABELS,
  historyState,
  scaleScore,
  type PercentScore,
  type Scored,
  type ScoringContext,
} from './scores';

/**
 * Fit and chance on each open application (plan #1203).
 *
 * The same two numbers the openings on Roles carry (#1202), asked of the
 * applications still in play: every status but the four closed ones. Jev
 * reads the role as it is on file (title, company, level, work mode, pay,
 * the extracted requirements with their evidence verdicts where the match has
 * run, and the start of the description) beside the person's evidence and
 * how their past applications to similar roles went.
 *
 * Stored on the application row in `scores` (migration job_search 0038) with
 * the same shape as an opening's fit_score and chance, so #1206 can show both
 * with one reader. A change to the role's description or match clears
 * `scored_at` in the database, and the next run scores it again.
 *
 * No `server-only` guard, so a script can score real rows under plain `tsx`.
 */

/** The statuses an application is not scored in. Everything else is open. */
export const CLOSED_APPLICATION_STATUSES = TERMINAL_STATUSES;

export function isOpenApplication(status: string): boolean {
  return !(CLOSED_APPLICATION_STATUSES as readonly string[]).includes(status);
}

/** How much of the description Jev reads. The requirements carry the detail when they exist. */
export const APPLICATION_JD_CHARS = 2_000;

/** At most this many requirements go in; a long posting's tail is mostly repetition. */
export const APPLICATION_REQUIREMENT_LIMIT = 40;

export const APPLICATION_QUESTIONS = {
  fit_score: {
    type: 'score',
    question:
      'How much of what this role asks for is covered by the person\'s evidence items (your_evidence) ' +
      'and target titles (your_target_titles)? Where the requirements carry a verdict from matching them ' +
      'against the evidence (strong, partial or gap), weigh those verdicts, the must-haves most.',
    levels: OPENING_QUESTIONS.fit_score.levels,
  },
  chance: {
    type: 'score',
    question:
      'How likely is this application to reach an interview? Read how the person\'s past applications to ' +
      'similar roles went (your_history_with_similar_roles) against their record as a whole ' +
      '(your_history_overall), and weigh how well their evidence matches the role. ' +
      'Few past interviews for similar roles is a reason to score low whatever the role says.',
    levels: OPENING_QUESTIONS.chance.levels,
  },
} as const satisfies Record<PercentScore, JevQuestion>;

/** What `applications.scores` holds. A question Jev gave no readable answer to is missing. */
export type ApplicationScores = Partial<Record<PercentScore, Scored<number>>>;

/** One open application as Jev is told about it. */
export type ApplicationText = {
  id: string;
  status: string;
  title: string;
  company: string | null;
  seniority: string | null;
  location: string | null;
  workMode: string | null;
  compMinCents: number | null;
  compMaxCents: number | null;
  requirements: readonly Requirement[] | null;
  requirementMatches: readonly RequirementMatch[] | null;
  jdText: string | null;
};

function dollars(cents: number): string {
  return `$${Math.round(cents / 100).toLocaleString('en-US')}`;
}

/** The pay as one line, or null when none is on file. */
export function payLine(min: number | null, max: number | null): string | null {
  if (min && max) return min === max ? dollars(min) : `${dollars(min)} to ${dollars(max)}`;
  if (min) return `from ${dollars(min)}`;
  if (max) return `up to ${dollars(max)}`;
  return null;
}

/**
 * The requirements as Jev reads them: with the match verdict and its reason
 * where the match has run, otherwise the extracted list alone. Null when
 * neither is on file, so the description stands in for them.
 */
export function requirementsState(app: ApplicationText): { requirement: string; kind: string; verdict?: string; why?: string }[] | null {
  const matches = app.requirementMatches ?? [];
  if (matches.length > 0) {
    return matches.slice(0, APPLICATION_REQUIREMENT_LIMIT).map((match) => ({
      requirement: match.requirement,
      kind: match.kind,
      verdict: match.verdict,
      ...(match.why ? { why: match.why } : {}),
    }));
  }
  const requirements = app.requirements ?? [];
  if (requirements.length === 0) return null;
  return requirements.slice(0, APPLICATION_REQUIREMENT_LIMIT).map((req) => ({ requirement: req.text, kind: req.kind }));
}

/** The state Jev reads for one application. */
export function applicationState(app: ApplicationText, context: ScoringContext): Record<string, unknown> {
  const jd = app.jdText?.trim() ?? '';
  const level = app.seniority?.trim() || SENIORITY_LABELS[titleLevel(app.title)];
  return {
    role: {
      title: app.title,
      company: app.company ?? 'not named',
      level,
      work_mode: app.workMode?.replace(/_/g, ' ') ?? 'not given',
      location: app.location ?? 'not given',
      pay: payLine(app.compMinCents, app.compMaxCents) ?? 'not given',
      stage: app.status.replace(/_/g, ' '),
      requirements: requirementsState(app) ?? 'none extracted; read the description',
      description_start: jd ? jd.slice(0, APPLICATION_JD_CHARS) : 'no description on file',
    },
    your_evidence: context.evidence,
    your_target_titles: context.targetTitles,
    ...historyState(app.title, context.history, { excludeId: app.id }),
  };
}

function percent(result: JevResult<JevScoreAnswer>, levels: number): Scored<number> | undefined {
  if (!result.ok) return undefined;
  return { value: scaleScore(result.answer.score, levels), confidence: Math.round(result.answer.confidence * 1000) / 1000 };
}

export type ScoreApplicationInput = {
  application: ApplicationText;
  context: ScoringContext;
  onSpend?: SpendSink;
  apiKey?: string | null;
  fetch?: typeof fetch;
  timeoutMs?: number;
};

/** Ask the two questions about one application. Never throws. */
export async function scoreApplication(
  input: ScoreApplicationInput,
): Promise<{ ok: true; scores: ApplicationScores } | JevFailure> {
  const asked = await askJevAll({
    state: applicationState(input.application, input.context),
    questions: APPLICATION_QUESTIONS,
    onSpend: input.onSpend,
    apiKey: input.apiKey,
    fetch: input.fetch,
    timeoutMs: input.timeoutMs,
  });
  if (!asked.ok) return asked;
  const scores: ApplicationScores = {};
  for (const key of PERCENT_SCORES) {
    const scored = percent(asked.answers[key], APPLICATION_QUESTIONS[key].levels.length);
    if (scored) scores[key] = scored;
  }
  return { ok: true, scores };
}

/** The stored jsonb as scores, dropping anything that is not a whole number from 0 to 100 with a confidence. */
export function parseApplicationScores(raw: unknown): ApplicationScores | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const row = raw as Record<string, unknown>;
  const out: ApplicationScores = {};
  for (const key of PERCENT_SCORES) {
    const entry = row[key] as Record<string, unknown> | undefined;
    if (!entry || typeof entry !== 'object') continue;
    const { value, confidence } = entry;
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 100) continue;
    if (typeof confidence !== 'number' || confidence < 0 || confidence > 1) continue;
    out[key] = { value, confidence };
  }
  return out;
}
