import type { SpendSink } from '@/lib/core/spend/pricing';
import { formatMoney } from '@/lib/money';
import { askJevAll, type JevFailure, type JevQuestion } from '@/lib/jev/wire';
import type { RequirementMatch } from '../evidence/match-payload';
import type { Requirement } from '../jd/requirements';
import { TERMINAL_STATUSES } from '../pipeline';
import { CHANNEL_LABELS, channelOf, titleLevel } from './history';
import { preferenceState } from './preferences';
import {
  CHANCE_QUESTIONS,
  FIT_QUESTIONS,
  baseRate,
  combineChance,
  combineFit,
  parseRubric,
  requirementCoverage,
  type RubricBreakdown,
} from './rubric';
import {
  APPLIED_LIMIT,
  PERCENT_SCORES,
  SENIORITY_LABELS,
  chanceFactors,
  fitFactors,
  historyState,
  personState,
  type PercentScore,
  type Scored,
  type ScoringContext,
} from './scores';

/**
 * Fit and chance on each open application (plan #1203).
 *
 * The same two numbers the openings on Roles carry (#1202), built from the
 * same rubric of factors (rubric.ts), asked of the applications still in
 * play: every status but the four closed ones. Jev reads the role as it is on
 * file (title, company, level, work mode, pay, the extracted requirements
 * with their evidence verdicts where the match has run, and the start of the
 * description) beside the person's evidence, career goals and how their past
 * applications to similar roles went. Where the match has run, its verdicts
 * stand in for Jev's answer on requirements, and a referral or cover letter
 * on the application moves the chance.
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

/** The rubric's factor questions, the same as an opening's. */
export const APPLICATION_QUESTIONS = { ...FIT_QUESTIONS, ...CHANCE_QUESTIONS } as const satisfies Record<string, JevQuestion>;

/** What `applications.scores` holds: the two figures, and the factor answers behind them. */
export type ApplicationScores = Partial<Record<PercentScore, Scored<number>>> & { rubric?: RubricBreakdown };

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
  /** applications.source; `linkedin` on a sent application is Easy Apply. */
  source?: string | null;
  /** Whether a referral contact is on the application. */
  referral?: boolean;
  /** Whether a cover letter is on the application or ticked as sent. */
  coverLetter?: boolean;
};

function dollars(cents: number): string {
  return formatMoney(Math.round(cents / 100) * 100, 'USD', { showCents: false });
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

/** How the application goes in, as Jev reads it beside the history it is compared against. */
export function howItGoesIn(app: ApplicationText): Record<string, unknown> {
  const sent = !['lead', 'drafting'].includes(app.status);
  return {
    channel: sent ? CHANNEL_LABELS[channelOf(app)] : `not sent yet; read as ${CHANNEL_LABELS.direct}`,
    referral: app.referral ?? false,
    cover_letter: app.coverLetter ?? false,
  };
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
      how_it_goes_in: howItGoesIn(app),
      requirements: requirementsState(app) ?? 'none extracted; read the description',
      description_start: jd ? jd.slice(0, APPLICATION_JD_CHARS) : 'no description on file',
    },
    ...(context.preferences && preferenceState(context.preferences)
      ? { your_preferences: preferenceState(context.preferences) }
      : {}),
    your_evidence: context.evidence,
    your_target_titles: context.targetTitles,
    roles_you_applied_to: context.applied.slice(0, APPLIED_LIMIT),
    ...personState(context, app.id),
    ...historyState(app.title, context.history, { excludeId: app.id, channel: channelOf(app) }),
  };
}

/** At least this much description counts as the job's own text. */
export const DESCRIBED_CHARS = 200;

/** Whether Jev had the job's own text: a description, or requirements extracted from one. */
export function isDescribed(app: Pick<ApplicationText, 'jdText' | 'requirements' | 'requirementMatches'>): boolean {
  return (app.jdText?.trim().length ?? 0) >= DESCRIBED_CHARS || (app.requirements?.length ?? 0) > 0 || (app.requirementMatches?.length ?? 0) > 0;
}

/**
 * The application's chance factors: Jev's answers, the match verdicts in place
 * of its requirements answer where the match has run, the base rate of
 * applications sent the same way, and the referral and cover letter.
 * `asOf` is for the back-test, which must see only the history before it.
 */
export function applicationChance(
  app: ApplicationText,
  context: ScoringContext,
  jev: RubricBreakdown['chance'],
  asOf?: string | null,
): RubricBreakdown['chance'] {
  const base = baseRate(app.title, context.history, { excludeId: app.id, channel: channelOf(app), asOf });
  const coverage = requirementCoverage(app.requirementMatches);
  return {
    base: Math.round(base.rate * 10000) / 10000,
    ...jev,
    described: isDescribed(app),
    ...(coverage !== null ? { chance_requirements: { score: Math.round(coverage * 4 * 1000) / 1000, sd: 0 }, from_matches: true } : {}),
    referral: app.referral ?? false,
    cover_letter: app.coverLetter ?? false,
  };
}

export type ScoreApplicationInput = {
  application: ApplicationText;
  context: ScoringContext;
  onSpend?: SpendSink;
  apiKey?: string | null;
  fetch?: typeof fetch;
  timeoutMs?: number;
};

/** Ask the rubric's questions about one application and build fit and chance. Never throws. */
export async function scoreApplication(
  input: ScoreApplicationInput & { asOf?: string | null },
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
  const rubric: RubricBreakdown = {
    fit: fitFactors(asked.answers),
    chance: applicationChance(input.application, input.context, chanceFactors(asked.answers), input.asOf),
  };
  const scores: ApplicationScores = { chance: combineChance(rubric.chance), rubric };
  const fit = combineFit(rubric.fit);
  if (fit) scores.fit_score = fit;
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
  const rubric = parseRubric(row.rubric);
  if (rubric) out.rubric = rubric;
  return out;
}
