import type { RequirementMatch } from '../evidence/match-payload';
import { summariseHistory, titleLevel, wasSent, type PastApplication } from './history';
import {
  SCORE_CONFIDENCE_FLOOR,
  SENIORITIES,
  type Fit,
  type OpeningScores,
  type Seniority,
} from './scores';

/**
 * One line on what drove each score (plan #1205).
 *
 * Jev returns a number and a confidence, never text, so the reason is built
 * here from what is already stored or on file: requirement verdicts, the fit
 * label, the level against the applications already sent, red flags, and how
 * similar applications went. Each function picks the single most telling of
 * those and fills a sentence of twelve words or fewer.
 *
 * Chance shows as a band (#1204: it did not predict interviews), so its
 * reason names what it rests on, as counts, and claims no precision.
 *
 * Pure: the openings list and the Roles table and pipeline cards call the
 * same two functions with the same input, at read time.
 */

/** What both reasons read. An opening and an application fill it differently; see each field. */
export type ScoreReasonInput = {
  kind: 'opening' | 'application';
  /** The opening's headline or the role's title. */
  title: string;
  /** `parseOpeningScores` or `parseApplicationScores` of the stored `scores`. */
  scores: OpeningScores;
  /** Applications: roles.seniority as stored. Openings leave it out and the seniority answer is read. */
  seniority?: string | null;
  /** Applications: roles.requirement_matches. Openings have none. */
  requirementMatches?: readonly RequirementMatch[] | null;
  /** Whether the job's text is on file: roles.jd_text for an application, the read posting for an opening. */
  hasDescription?: boolean;
  /** `ScoringContext.history` from `loadScoringContext`. */
  history: readonly PastApplication[];
  /** Applications: the application's own id, so it is not counted as its own history. */
  excludeId?: string;
};

const LEVEL_RANK: Record<Seniority, number> = { entry: 0, mid: 1, senior: 2, executive: 3 };

const LEVEL_NAMES: Record<Seniority, string> = {
  entry: 'Entry level',
  mid: 'Mid level',
  senior: 'Senior level',
  executive: 'Director level',
};

function confident(scored: { confidence: number } | undefined): boolean {
  return scored !== undefined && scored.confidence >= SCORE_CONFIDENCE_FLOOR;
}

/** The job's level: the stored seniority for an application, the seniority answer for an opening, else the title. */
export function jobLevel(input: Pick<ScoreReasonInput, 'title' | 'scores' | 'seniority'>): Seniority {
  const stored = input.seniority?.trim().toLowerCase();
  if (stored && (SENIORITIES as readonly string[]).includes(stored)) return stored as Seniority;
  if (input.scores.seniority && confident(input.scores.seniority)) return input.scores.seniority.value;
  return titleLevel(input.title);
}

/** Under this share of past applications at or beyond the job's level, the level is unusual for the person. */
export const UNUSUAL_LEVEL_SHARE = 0.2;

/** Fewer sent applications than this say nothing about a usual level. */
export const LEVEL_HISTORY_MIN = 5;

/**
 * Where the job's level sits against the applications already sent, by the
 * level each title reads as. Above: fewer than a fifth were at its level or
 * higher. Below: fewer than a fifth were at its level or lower. Target titles
 * are not used: they name the kind of work ("Strategic Finance"), not a level.
 */
export function levelAgainstHistory(
  level: Seniority,
  history: readonly PastApplication[],
  excludeId?: string,
): 'above' | 'below' | 'within' | null {
  const ranks = history.filter((app) => wasSent(app) && app.id !== excludeId).map((app) => LEVEL_RANK[titleLevel(app.title)]);
  if (ranks.length < LEVEL_HISTORY_MIN) return null;
  const rank = LEVEL_RANK[level];
  if (ranks.filter((r) => r >= rank).length / ranks.length < UNUSUAL_LEVEL_SHARE) return 'above';
  if (ranks.filter((r) => r <= rank).length / ranks.length < UNUSUAL_LEVEL_SHARE) return 'below';
  return 'within';
}

const FIT_SENTENCES: Record<Fit, string> = {
  strong: 'Several of your evidence items speak to the core of the job',
  partial: 'Some evidence is relevant, but the core of the job is new',
  weak: 'Little of your evidence bears on this job',
};

/** The fit_score levels, shortened from the question's five to fit the line. */
const FIT_LEVEL_SENTENCES = [
  'None of your evidence bears on this job',
  'A little evidence bears on it, the core is new to you',
  'Your evidence covers some of the core of the job',
  'Direct evidence covers most of the core of the job',
  'Direct evidence covers all of the core, at its level',
] as const;

/** The fit_score level sentence nearest the stored figure. */
function fitLevelSentence(value: number): string {
  const top = FIT_LEVEL_SENTENCES.length - 1;
  const index = Math.round((Math.min(Math.max(value, 0), 100) / 100) * top);
  return FIT_LEVEL_SENTENCES[index];
}

/**
 * Why the fit is what it is, in order of how much each says:
 * the requirement verdicts where the match has run, a level unusual for
 * the person's applications, the fit label, the fit_score level, and last what little
 * the score was read from. Null when there is no fit answer at all.
 */
export function fitReason(input: ScoreReasonInput): string | null {
  const { scores } = input;
  if (!scores.fit && !scores.fit_score) return null;

  const matches = input.requirementMatches ?? [];
  if (matches.length > 0) {
    const mustHaves = matches.filter((match) => match.kind === 'must_have');
    const counted = mustHaves.length > 0 ? mustHaves : matches;
    const met = counted.filter((match) => match.verdict === 'strong').length;
    const partly = counted.filter((match) => match.verdict === 'partial').length;
    const noun = mustHaves.length > 0 ? 'must-haves' : 'requirements';
    return `${met} of ${counted.length} ${noun} met by your evidence${partly > 0 ? `, ${partly} partly` : ''}`;
  }

  const level = jobLevel(input);
  const against = levelAgainstHistory(level, input.history, input.excludeId);
  if (against === 'above' || against === 'below') {
    return `${LEVEL_NAMES[level]}, ${against} most of your applications`;
  }

  if (input.kind === 'opening' && scores.fit && confident(scores.fit)) return FIT_SENTENCES[scores.fit.value];

  const sure = scores.fit_score ? confident(scores.fit_score) : confident(scores.fit);
  if (input.kind === 'application' && input.hasDescription === false) {
    return 'Read from the title and level only, no description on file';
  }
  if (!sure) {
    if (input.kind === 'application') return 'Unsure, read from the description without matched requirements';
    if (input.hasDescription) return 'Unsure, read from the posting without matched requirements';
    return scores.fit
      ? `Probably a ${scores.fit.value} match, from Dash's short summary alone`
      : "Unsure, read from Dash's short summary of the opening";
  }
  if (scores.fit_score) return fitLevelSentence(scores.fit_score.value);
  return scores.fit ? FIT_SENTENCES[scores.fit.value] : null;
}

function plural(count: number, one: string, many: string): string {
  return count === 1 ? one : many;
}

/**
 * What the chance band rests on: how many similar applications there are
 * and how many reached an interview, with a red flag or a level above the
 * level of past applications put first when either applies. With no similar ones it falls
 * back to the whole record, and with no record it says there is nothing to
 * compare. Null when there is no chance answer.
 */
export function chanceReason(input: ScoreReasonInput): string | null {
  if (!input.scores.chance) return null;
  const summary = summariseHistory(input.title, input.history, { excludeId: input.excludeId });
  const similar = summary.similar;

  let lead: string | null = null;
  if (input.scores.red_flags?.value && confident(input.scores.red_flags)) lead = 'Red flags in the posting';
  else if (levelAgainstHistory(jobLevel(input), input.history, input.excludeId) === 'above') lead = 'Above your usual level';

  if (similar.applied > 0) {
    const counts = `${similar.reached_an_interview} of ${similar.applied} similar reached an interview`;
    if (lead) return `${lead}, ${counts}`;
    // Waiting ones are in the count; saying so keeps a low figure honest.
    if (similar.still_waiting > 0) return `${counts}, ${similar.still_waiting} still waiting`;
    return `${similar.reached_an_interview} of ${similar.applied} similar ${plural(similar.applied, 'application', 'applications')} reached an interview`;
  }

  const all = summary.all_applications;
  if (all.applied > 0) {
    return `No similar applications yet, ${all.reached_an_interview} of ${all.applied} overall reached an interview`;
  }
  if (input.kind === 'application' && input.hasDescription === false) {
    return 'No past applications to compare, and no description on file';
  }
  return lead ?? 'No past applications to compare against yet';
}

