import type { JevChoiceAnswer, JevQuestion, JevResult, JevScoreAnswer, JevYesNoAnswer } from '@/lib/jev/wire';
import type { RequirementMatch } from '../evidence/match-payload';
import { channelOf, isSimilarTitle, reachedInterview, titleLevel, wasSent, type Channel, type PastApplication } from './history';
import type { Scored, Seniority } from './scores';

/**
 * The rubric behind fit and the chance of an interview (17 November 2026).
 *
 * Each score used to be one question to Jev: a fit level from "none of the
 * evidence bears on the job" to "all of it does", and a chance band read off
 * the history. One broad question left Jev unsure (average confidence about
 * 0.5) and left the weighing of everything to it. Here Jev answers one narrow
 * question per factor, and this file combines the answers.
 *
 * Fit is how much the person would want the role, not whether they could do
 * it: the kind of work against their career goals, ambition, direction, the
 * prestige of the company and of the position, interest, level, setup and
 * pay. A dealbreaker (an excluded industry, or something their career goals
 * rule out) caps it.
 *
 * Chance starts from the person's own interview rate, worked out here from
 * the applications sent the same way (`baseRate`), and each factor moves it
 * in log-odds: how much of the job the evidence covers, the level against the
 * levels they have reached interviews at, whether their background is what
 * the employer hires, a hard requirement they lack, how crowded the posting
 * is, and how the application goes in. The weights are in CHANCE_WEIGHTS,
 * fitted on the closed applications by scripts/chance-check.ts.
 *
 * Pure apart from the types, so the tests and the back-test share it.
 */

// ---------------------------------------------------------------------------
// Fit: how much the person would want it.

/** Five levels each, lowest first, so every fit factor reads 0 to 4. */
export const FIT_QUESTIONS = {
  fit_work: {
    type: 'score',
    question:
      'How much of the day-to-day work in this job is the kind the person says they want in your_career_goals, ' +
      'and how little is the kind they say they do not want?',
    levels: [
      'Mostly work their career goals say they do not want',
      'More of the unwanted work than the wanted',
      'A mix of the two',
      'Mostly the work they want',
      'Almost entirely the work they want',
    ],
  },
  fit_direction: {
    type: 'score',
    question:
      'How far would this job move the person toward where your_career_goals and your_target_titles say they want ' +
      'their career to go?',
    levels: [
      'Away from it',
      'Sideways, no closer',
      'A little closer',
      'Clearly closer',
      'Straight onto the path they describe',
    ],
  },
  fit_ambition: {
    type: 'score',
    question:
      'How ambitious and entrepreneurial is the setting: a company building something new and growing fast, close to ' +
      'the cutting edge, where the person would see how the business is built?',
    levels: [
      'A slow, settled organisation',
      'Steady and conventional',
      'Some growth or new work',
      'A fast-growing or ambitious company',
      'At the cutting edge, building something new',
    ],
  },
  fit_company_prestige: {
    type: 'score',
    question:
      'How prestigious is the company: how well known and respected it is, how selective its hiring is, and how ' +
      'strong its backers, brand or results are?',
    levels: [
      'Unknown or poorly regarded',
      'Little known',
      'Respected in its field',
      'Widely known and respected',
      'Among the most sought-after employers',
    ],
  },
  fit_role_prestige: {
    type: 'score',
    question:
      'How prestigious is the position itself: its scope, who it reports to, how visible it is to leadership, and ' +
      'how the title would read on the person\'s résumé?',
    levels: [
      'A back-office role with little scope',
      'A narrow role, far from leadership',
      'A solid role with ordinary visibility',
      'Wide scope or close to leadership',
      'A high-profile role working with the top of the company',
    ],
  },
  fit_interest: {
    type: 'score',
    question:
      'How interesting would the person find what this company makes or does, going by your_career_goals and ' +
      'your_target_titles?',
    levels: ['Not at all', 'A little', 'Somewhat', 'Clearly interesting to them', 'Exactly what they are drawn to'],
  },
  fit_level: {
    type: 'score',
    question:
      'Against the levels of your_evidence and roles_you_applied_to, is this job a step up or a step back for the person?',
    levels: ['A clear step back', 'A slight step back', 'The same level', 'A step up', 'A big step up'],
  },
  fit_setup: {
    type: 'score',
    question:
      'How well do the location and the way of working (remote, hybrid, on-site) suit your_preferences? ' +
      'Where no preference is set, answer the middle level.',
    levels: [
      'Breaks a stated preference',
      'Strains a preference, such as a long commute',
      'No preference either way, or not given',
      'Suits the preferences',
      'Exactly what they asked for',
    ],
  },
  fit_pay: {
    type: 'choice',
    question:
      'How does the pay given in the text compare with the lowest pay in your_preferences, or where none is set, ' +
      'with pay for this level and place?',
    options: {
      strong: 'Clearly above it.',
      fair: 'About at it.',
      low: 'Below it.',
      not_given: 'No pay figure is given.',
    },
  },
  fit_excluded_industry: {
    type: 'yes-no',
    question: 'Is the company in one of your_excluded_industries? Answer no when that list is empty.',
  },
  fit_ruled_out: {
    type: 'yes-no',
    question:
      'Is this job mostly something your_career_goals say the person will not or cannot do? Answer no when the goals ' +
      'rule nothing out, or when the job only touches on it.',
  },
} as const satisfies Record<string, JevQuestion>;

export type FitFactor = Exclude<keyof typeof FIT_QUESTIONS, 'fit_excluded_industry' | 'fit_ruled_out'>;

/**
 * How much each factor counts in fit. The kind of work counts most: the
 * career goals say a job that is mostly accounting will not do, whatever its
 * other merits. Set by hand; there is no outcome to fit wanting against.
 */
export const FIT_WEIGHTS: Record<FitFactor, number> = {
  fit_work: 3,
  fit_direction: 2,
  fit_ambition: 1.5,
  fit_company_prestige: 1.5,
  fit_role_prestige: 1.5,
  fit_interest: 1,
  fit_level: 1,
  fit_setup: 1,
  fit_pay: 1,
};

/** Fit can be no higher than this when a dealbreaker is more likely than not. */
export const DEALBREAKER_CAP = 15;

/** The pay answer as a level on the same 0 to 4 scale; not_given drops the factor. */
const PAY_LEVELS: Record<string, number | null> = { strong: 4, fair: 2, low: 0, not_given: null };

/** The fit factor labels, for the reason line. */
export const FIT_FACTOR_LABELS: Record<FitFactor, { high: string; low: string }> = {
  fit_work: { high: 'the work you want', low: 'work you said you do not want' },
  fit_direction: { high: 'moves you where you want to go', low: 'does not move you forward' },
  fit_ambition: { high: 'an ambitious, fast-moving company', low: 'a settled, slow company' },
  fit_company_prestige: { high: 'a prestigious company', low: 'a little-known company' },
  fit_role_prestige: { high: 'a high-profile position', low: 'a low-profile position' },
  fit_interest: { high: 'a business you find interesting', low: 'a business of little interest to you' },
  fit_level: { high: 'a step up', low: 'a step back' },
  fit_setup: { high: 'the setup you asked for', low: 'a setup against your preferences' },
  fit_pay: { high: 'good pay', low: 'low pay' },
};

// ---------------------------------------------------------------------------
// Chance: how likely an interview is.

export const CHANCE_QUESTIONS = {
  chance_requirements: {
    type: 'score',
    question:
      'How much of what this job requires is covered by the person\'s evidence items (your_evidence)? Weigh the ' +
      'must-haves most.',
    levels: [
      'None of the requirements',
      'A few, and none of the core',
      'Some of the core',
      'Most of the core',
      'All of the core, at the level asked',
    ],
  },
  chance_level: {
    type: 'score',
    question:
      'Against your_interview_levels, the levels at which the person has reached interviews before, where does this ' +
      'job\'s level sit?',
    levels: [
      'Two or more levels above any of them',
      'One level above',
      'At a level they have reached interviews at',
      'Below the levels they have reached interviews at',
    ],
  },
  chance_background: {
    type: 'score',
    question:
      'How closely does the person\'s background (your_evidence, and the roles in your_history_with_similar_roles ' +
      'that reached an interview) match the kind of candidate this employer seems to hire for this job?',
    levels: [
      'Nothing like who they hire',
      'A stretch',
      'A plausible candidate',
      'A good match',
      'Exactly who they hire',
    ],
  },
  chance_blocker: {
    type: 'yes-no',
    question:
      'Does the job require something the person plainly lacks: far more years of experience than they have, a ' +
      'license or certification not in your_evidence, or living somewhere other than your_preferences says? ' +
      'Answer no when nothing like that is stated.',
  },
  chance_competition: {
    type: 'score',
    question:
      'How many people is a posting like this likely to draw? A remote role, a famous company, an entry-level title ' +
      'or a posting open for weeks draws more.',
    levels: [
      'A very large pool',
      'A large pool',
      'An ordinary number',
      'Fewer than most',
      'Very few',
    ],
  },
} as const satisfies Record<string, JevQuestion>;

export type ChanceFactor = keyof typeof CHANCE_QUESTIONS;

/**
 * The log-odds each factor adds, per level above its middle (or, for a yes,
 * at full probability), on top of the base rate in log-odds times `base`.
 *
 * Fitted on 17 November 2026 by scripts/chance-check.ts on 419 closed direct
 * applications, 31 of which reached an interview, each scored against only
 * the history sent before it (ridge 0.01 toward hand-set starting weights).
 * Cross-validated AUC 0.60, against 0.56 for one Jev question; the mean
 * predicted chance, 7.7%, matches the 7.4% that reached an interview. How
 * crowded the posting is ranked best alone (0.63); requirements and
 * background ranked at 0.69 and 0.68 where a description was on file.
 * No closed application had a referral, so its weight is the starting guess.
 */
export type ChanceWeights = Record<
  | 'intercept'
  | 'base'
  | 'chance_requirements'
  | 'chance_level'
  | 'chance_background'
  | 'chance_blocker'
  | 'chance_competition'
  | 'referral'
  | 'cover_letter',
  number
>;

export const CHANCE_WEIGHTS: Readonly<ChanceWeights> = {
  intercept: -0.25,
  base: 0.67,
  chance_requirements: 0.62,
  chance_level: 0.29,
  chance_background: 0.22,
  chance_blocker: -1.08,
  chance_competition: 0.74,
  referral: 0.9,
  cover_letter: 0.02,
};

/** The middle level of each chance score question, where it moves nothing. */
const CHANCE_MIDDLE: Record<Exclude<ChanceFactor, 'chance_blocker'>, number> = {
  chance_requirements: 2,
  chance_level: 2,
  chance_background: 2,
  chance_competition: 2,
};

/** The chance never shows below or above these, in percent. */
export const CHANCE_FLOOR = 1;
export const CHANCE_CEILING = 90;

// ---------------------------------------------------------------------------
// The base rate.

/** A sent application still waiting this long is counted as a no. */
export const WAITING_DAYS = 45;
/** An application this many months old counts half as much as one sent today. */
export const HALF_LIFE_MONTHS = 6;
/** How many applications' worth of pull toward the overall rate the similar rate gets. */
export const SIMILAR_PRIOR = 10;
/** The rate assumed before any history, and how many applications' worth it counts for. */
export const PRIOR_RATE = 0.08;
export const PRIOR_WEIGHT = 10;

const WAITING = new Set(['submitted', 'acknowledged']);
const DAY = 24 * 60 * 60 * 1000;

export type BaseRate = {
  /** The interview rate the factors start from, 0 to 1. */
  rate: number;
  /** Decided applications behind it, weighted by age. */
  similar: number;
  overall: number;
};

/**
 * The interview rate an application starts from: similar applications sent
 * the same way, pulled toward the overall rate when there are few of them,
 * the overall rate itself pulled toward PRIOR_RATE. Recent applications
 * count more. One still waiting is left out until it is WAITING_DAYS old,
 * then counted as a no. `asOf` leaves out everything sent on or after it,
 * for a back-test that must not see the future.
 */
export function baseRate(
  title: string,
  history: readonly PastApplication[],
  options: { excludeId?: string; channel?: Channel; now?: Date; asOf?: string | null } = {},
): BaseRate {
  const channel = options.channel ?? 'direct';
  const now = (options.asOf ? new Date(options.asOf) : options.now ?? new Date()).getTime();
  let simN = 0;
  let simI = 0;
  let allN = 0;
  let allI = 0;
  for (const app of history) {
    if (app.id === options.excludeId || !wasSent(app) || channelOf(app) !== channel) continue;
    const sent = app.sentAt ? new Date(app.sentAt).getTime() : null;
    if (options.asOf && (sent === null || sent >= now)) continue;
    const interviewed = reachedInterview(app);
    const age = sent === null ? 365 : Math.max(0, (now - sent) / DAY);
    if (!interviewed && WAITING.has(app.status) && age < WAITING_DAYS) continue;
    const weight = Math.pow(0.5, age / 30.44 / HALF_LIFE_MONTHS);
    allN += weight;
    if (interviewed) allI += weight;
    if (isSimilarTitle(title, app.title)) {
      simN += weight;
      if (interviewed) simI += weight;
    }
  }
  const overall = (allI + PRIOR_RATE * PRIOR_WEIGHT) / (allN + PRIOR_WEIGHT);
  const rate = (simI + overall * SIMILAR_PRIOR) / (simN + SIMILAR_PRIOR);
  return { rate, similar: round(simN, 1), overall: round(allN, 1) };
}

/** The levels at which the person has reached interviews, with how many, for the level question. */
export function interviewLevels(history: readonly PastApplication[], excludeId?: string): Partial<Record<Seniority, number>> {
  const out: Partial<Record<Seniority, number>> = {};
  for (const app of history) {
    if (app.id === excludeId || !reachedInterview(app)) continue;
    const level = titleLevel(app.title);
    out[level] = (out[level] ?? 0) + 1;
  }
  return out;
}

/**
 * The share of the requirements the evidence covers, from the match verdicts:
 * strong counts 1, partial a half; a must-have weighs 2, a nice-to-have 1 and
 * a responsibility a half. Null when the match has not run. The level
 * equivalent is this times 4.
 */
export function requirementCoverage(matches: readonly RequirementMatch[] | null | undefined): number | null {
  if (!matches || matches.length === 0) return null;
  let total = 0;
  let met = 0;
  for (const match of matches) {
    const weight = match.kind === 'must_have' ? 2 : match.kind === 'nice_to_have' ? 1 : 0.5;
    total += weight;
    met += weight * (match.verdict === 'strong' ? 1 : match.verdict === 'partial' ? 0.5 : 0);
  }
  return total > 0 ? met / total : null;
}

// ---------------------------------------------------------------------------
// Combining the answers.

/** One factor as stored: its level (0 to the top level, or a probability for a yes/no) and its spread. */
export type FactorAnswer = { score: number; sd: number };

/** What is kept on the row under `scores.rubric`, so the figures can be explained and re-weighed. */
export type RubricBreakdown = {
  fit: Partial<Record<keyof typeof FIT_QUESTIONS, FactorAnswer>>;
  chance: Partial<Record<ChanceFactor, FactorAnswer>> & {
    base?: number;
    referral?: boolean;
    cover_letter?: boolean;
    /** Whether requirements came from the match verdicts rather than Jev. */
    from_matches?: boolean;
    /**
     * Whether Jev had the job's own text to read: a description, a read
     * posting or extracted requirements. Without it the job-reading factors
     * are guesses from the title, and count for nothing (`chanceFeatures`).
     */
    described?: boolean;
  };
};

/** A score answer's level and its standard deviation across Jev's level probabilities. */
export function scoreFactor(result: JevResult<JevScoreAnswer>): FactorAnswer | undefined {
  if (!result.ok) return undefined;
  const { score, probabilities } = result.answer;
  const total = probabilities.reduce((a, b) => a + b, 0);
  const variance =
    total > 0 ? probabilities.reduce((sum, p, level) => sum + (p / total) * (level - score) ** 2, 0) : 0;
  return { score: round(score, 3), sd: round(Math.sqrt(variance), 3) };
}

/** A yes/no answer as the probability of yes, with the spread of a coin with that probability. */
export function yesNoFactor(result: JevResult<JevYesNoAnswer>): FactorAnswer | undefined {
  if (!result.ok) return undefined;
  const p = result.answer.probability;
  return { score: round(p, 3), sd: round(Math.sqrt(p * (1 - p)), 3) };
}

/** The pay choice on the 0 to 4 scale, or undefined when no pay is given. */
export function payFactor(result: JevResult<JevChoiceAnswer>): FactorAnswer | undefined {
  if (!result.ok) return undefined;
  const level = PAY_LEVELS[result.answer.choice];
  if (level === null || level === undefined) return undefined;
  const probs = result.answer.probabilities as Record<string, number>;
  let mass = 0;
  let mean = 0;
  for (const [choice, value] of Object.entries(PAY_LEVELS)) {
    if (value === null) continue;
    mass += probs[choice] ?? 0;
    mean += (probs[choice] ?? 0) * value;
  }
  if (mass <= 0) return { score: level, sd: 0 };
  mean /= mass;
  let variance = 0;
  for (const [choice, value] of Object.entries(PAY_LEVELS)) {
    if (value === null) continue;
    variance += ((probs[choice] ?? 0) / mass) * (value - mean) ** 2;
  }
  return { score: round(mean, 3), sd: round(Math.sqrt(variance), 3) };
}

/** The top level index of a question: levels - 1 for a score, 4 for pay. */
function topLevel(key: FitFactor): number {
  const question = FIT_QUESTIONS[key];
  return question.type === 'score' ? question.levels.length - 1 : 4;
}

/**
 * Turn the spread of a figure into a confidence from 0 to 1: none is full
 * confidence, `scale` or more is none. Fit uses 40 points, so a fit of 65
 * give or take 8 reaches the 0.8 floor and shows plainly; chance uses one
 * unit of log-odds, so it shows as unsure unless Jev's answers agree closely,
 * which matches how loosely it ranks (cross-validated AUC 0.60).
 * Several answers averaged pin a figure tighter than any one of them, so the
 * combined figure is often surer than Jev was of a single answer.
 */
export function confidenceFromSpread(sd: number, scale: number): number {
  return round(Math.min(1, Math.max(0, 1 - sd / scale)), 3);
}

/**
 * Fit from 0 to 100: the weighted mean of the answered factors, each scaled
 * to 0 to 100, capped at DEALBREAKER_CAP when either dealbreaker is more
 * likely than not. Undefined when no factor was answered.
 */
export function combineFit(fit: RubricBreakdown['fit']): Scored<number> | undefined {
  let weights = 0;
  let sum = 0;
  let variance = 0;
  const parts: { w: number; sd: number }[] = [];
  for (const key of Object.keys(FIT_WEIGHTS) as FitFactor[]) {
    const answer = fit[key];
    if (!answer) continue;
    const top = topLevel(key);
    const w = FIT_WEIGHTS[key];
    weights += w;
    sum += w * (answer.score / top) * 100;
    parts.push({ w, sd: (answer.sd / top) * 100 });
  }
  if (weights === 0) return undefined;
  for (const part of parts) variance += (part.w / weights) ** 2 * part.sd ** 2;
  let value = sum / weights;
  const dealbreaker = Math.max(fit.fit_excluded_industry?.score ?? 0, fit.fit_ruled_out?.score ?? 0);
  if (dealbreaker >= 0.5) value = Math.min(value, DEALBREAKER_CAP);
  return { value: Math.round(value), confidence: confidenceFromSpread(Math.sqrt(variance), 40) };
}

function logit(p: number): number {
  const q = Math.min(Math.max(p, 1e-4), 1 - 1e-4);
  return Math.log(q / (1 - q));
}

function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

/**
 * The factors read from the job's own text. On the back-test of 17 November
 * 2026, with a description on file, requirements alone ranked the closed
 * applications at AUC 0.69 and background at 0.68; with none, at 0.28 and
 * 0.34, worse than a coin. So without a description they count for nothing.
 */
const JOB_READING = new Set<keyof typeof CHANCE_MIDDLE>(['chance_requirements', 'chance_level', 'chance_background']);

/**
 * The inputs the chance model reads, in the order of CHANCE_WEIGHTS: a
 * constant for the intercept, the base rate in log-odds, each score factor as levels from its middle, the
 * blocker as a probability, and referral and cover letter as 0 or 1. The
 * back-test fits weights on these same numbers.
 */
export function chanceFeatures(chance: RubricBreakdown['chance']): Record<keyof ChanceWeights, number> {
  const fromMiddle = (key: keyof typeof CHANCE_MIDDLE) => {
    const answer = chance[key];
    if (!answer) return 0;
    if (chance.described === false && JOB_READING.has(key) && !chance.from_matches) return 0;
    return answer.score - CHANCE_MIDDLE[key];
  };
  return {
    intercept: 1,
    base: logit(chance.base ?? PRIOR_RATE),
    chance_requirements: fromMiddle('chance_requirements'),
    chance_level: fromMiddle('chance_level'),
    chance_background: fromMiddle('chance_background'),
    chance_blocker: chance.chance_blocker?.score ?? 0,
    chance_competition: fromMiddle('chance_competition'),
    referral: chance.referral ? 1 : 0,
    cover_letter: chance.cover_letter ? 1 : 0,
  };
}

/**
 * The chance of an interview in percent: the base rate in log-odds plus each
 * factor times its weight, back through the logistic, held between
 * CHANCE_FLOOR and CHANCE_CEILING. The confidence comes from how widely
 * Jev's level probabilities spread the total, in log-odds.
 */
export function combineChance(chance: RubricBreakdown['chance'], weights: Readonly<ChanceWeights> = CHANCE_WEIGHTS): Scored<number> {
  const x = chanceFeatures(chance);
  let total = 0;
  for (const key of Object.keys(weights) as (keyof ChanceWeights)[]) total += weights[key] * x[key];
  let variance = 0;
  for (const key of ['chance_requirements', 'chance_level', 'chance_background', 'chance_blocker', 'chance_competition'] as const) {
    const answer = chance[key];
    if (answer) variance += (weights[key] * answer.sd) ** 2;
  }
  const percent = Math.round(sigmoid(total) * 100);
  return {
    value: Math.min(CHANCE_CEILING, Math.max(CHANCE_FLOOR, percent)),
    confidence: confidenceFromSpread(Math.sqrt(variance), 1),
  };
}

/**
 * The fit factors that most explain the figure: the dealbreaker if one
 * applies, else the strongest and weakest answered factor by weight times
 * distance from the middle.
 */
export function fitDrivers(
  fit: RubricBreakdown['fit'],
): { dealbreaker: 'excluded_industry' | 'ruled_out' | null; best: FitFactor | null; worst: FitFactor | null } {
  if ((fit.fit_excluded_industry?.score ?? 0) >= 0.5) return { dealbreaker: 'excluded_industry', best: null, worst: null };
  if ((fit.fit_ruled_out?.score ?? 0) >= 0.5) return { dealbreaker: 'ruled_out', best: null, worst: null };
  let best: { key: FitFactor; pull: number } | null = null;
  let worst: { key: FitFactor; pull: number } | null = null;
  for (const key of Object.keys(FIT_WEIGHTS) as FitFactor[]) {
    const answer = fit[key];
    if (!answer) continue;
    const pull = FIT_WEIGHTS[key] * (answer.score / topLevel(key) - 0.5);
    if (pull > 0 && (!best || pull > best.pull)) best = { key, pull };
    if (pull < 0 && (!worst || pull < worst.pull)) worst = { key, pull };
  }
  return { dealbreaker: null, best: best?.key ?? null, worst: worst?.key ?? null };
}

/** The stored breakdown read back, or null when it is not one. Only the shape is checked. */
export function parseRubric(raw: unknown): RubricBreakdown | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const row = raw as Record<string, unknown>;
  const part = (value: unknown) => (value && typeof value === 'object' && !Array.isArray(value) ? value : {});
  return { fit: part(row.fit) as RubricBreakdown['fit'], chance: part(row.chance) as RubricBreakdown['chance'] };
}

function round(value: number, places: number): number {
  const f = 10 ** places;
  return Math.round(value * f) / f;
}
