import type { SpendSink } from '@/lib/core/spend/pricing';
import {
  askJevAll,
  type JevChoiceAnswer,
  type JevFailure,
  type JevQuestion,
  type JevResult,
  type JevScoreAnswer,
  type JevYesNoAnswer,
} from '@/lib/jev/wire';
import { summariseHistory, type PastApplication } from './history';
import { companyKey, titleKey } from './payload';
import { POSTING_TEXT_FOR_SCORING } from './posting-text';
import { preferenceState, type JobPreferences } from './preferences';

export { companyKey };
import { CHANCE_DISPLAY, chanceBand, type ChanceBand } from './chance-check';

/**
 * Ten fixed questions about each opening Dash recommends (plan #1178; fit
 * and chance scores added by #1202).
 *
 * The openings on Roles come from a web search that writes a title, a
 * location, why it fits and how to go about it (job_search.suggestions, kind
 * `apply`). Jev reads that text, the posting itself once posting.ts has read
 * it from the link (job_search 0039), the person's evidence titles, the roles
 * they have applied to and what they want from a job, and answers ten
 * questions in one request, so the list can be sorted and filtered without a
 * model reading every posting at length.
 *
 * The answers and Jev's confidence in each are kept on the suggestion row in
 * `scores` (migration job_search 0037). An answer under the confidence floor
 * is kept and shown as unsure rather than sent to Haiku: these are labels to
 * sort by, and a second model reading the same text would not know more.
 *
 * No `server-only` guard, so a script can try the questions on real rows
 * under plain `tsx`.
 */

export const WORKPLACES = ['remote', 'hybrid', 'on_site', 'unclear'] as const;
export type Workplace = (typeof WORKPLACES)[number];

export const SENIORITIES = ['entry', 'mid', 'senior', 'executive'] as const;
export type Seniority = (typeof SENIORITIES)[number];

export const FITS = ['strong', 'partial', 'weak'] as const;
export type Fit = (typeof FITS)[number];

/** Lowest to highest, as Jev's score levels. */
export const CLOSENESS_LEVELS = ['unlike', 'somewhat', 'close', 'same'] as const;

/** The score questions stored as a whole number from 0 to 100 rather than a level. */
export const PERCENT_SCORES = ['fit_score', 'chance'] as const;
export type PercentScore = (typeof PERCENT_SCORES)[number];

/** How the chance score is named wherever it shows (decided on #1201). */
export const CHANCE_LABEL = 'Chance of an interview';
export const FIT_SCORE_LABEL = 'Fit';

export const OPENING_QUESTIONS = {
  workplace: {
    type: 'choice',
    question: 'Where is the work done, going by the location and the text about the opening?',
    options: {
      remote: 'Fully remote. A remote role that names a country or region still counts.',
      hybrid: 'Some days in an office and some at home.',
      on_site: 'In an office every working day. A city with no mention of remote or hybrid counts.',
      unclear: 'No location or arrangement is given at all.',
    },
  },
  seniority: {
    type: 'choice',
    question: 'What level is the job, going by its title and what it asks for?',
    options: {
      entry: 'Analyst, associate, staff or specialist, for someone early in their career.',
      mid: 'Senior associate, senior specialist, consultant or manager of their own work.',
      senior: 'Senior manager, lead, principal or head of a small team.',
      executive: 'Director, vice president, controller, head of a function or above.',
    },
  },
  salary: {
    type: 'yes-no',
    question:
      'Does the text give the pay as a figure: a salary, a range or an hourly rate? ' +
      'Answer no when pay is only mentioned without a number, such as "competitive pay" or "plus equity", ' +
      'and no when the text says pay is not posted or gives only a typical, reported or estimated range from elsewhere.',
  },
  fit: {
    type: 'choice',
    question:
      'How well do the person\'s evidence items (your_evidence) and target titles match what this opening asks for?',
    options: {
      strong: 'Several evidence items speak directly to the core of the job.',
      partial: 'Some evidence is relevant, but the core of the job is new to them.',
      weak: 'Little or none of the evidence bears on the job.',
    },
  },
  red_flags: {
    type: 'yes-no',
    question:
      'Does the text give a concrete reason to be wary of this opening, such as the posting being old or possibly ' +
      'closed, pay by commission only, a company in trouble, or a title that does not match the work? ' +
      'Answer no when the text raises no concern about the posting or the company. A poor fit with the person, ' +
      'such as asking for more experience than they have, is asked separately and is not a red flag here.',
  },
  cover_letter: {
    type: 'yes-no',
    question:
      'Does the text say the application asks for a cover letter or a written note, or advise writing one? ' +
      'Answer no when a cover letter is not mentioned, or is mentioned only as something to hold off on.',
  },
  duplicate: {
    type: 'yes-no',
    question:
      'Is this opening the same job as one in your_roles_at_this_company: the same company and the same or ' +
      'nearly the same title? Answer no when that list is empty, and no when the titles are for different ' +
      'work at the same company.',
  },
  closeness: {
    type: 'score',
    question:
      'How close is this opening to the roles the person has applied to (roles_you_applied_to), ' +
      'by the kind of work and the level?',
    levels: [
      'Unlike any of them',
      'Somewhat like some of them',
      'Close to several of them',
      'Nearly the same as one of them',
    ],
  },
  fit_score: {
    type: 'score',
    question:
      'How much of what this opening asks for is covered by the person\'s evidence items (your_evidence) ' +
      'and target titles (your_target_titles)?',
    levels: [
      'None of the evidence bears on the job',
      'A little of the evidence bears on the job, and its core is new to them',
      'Some of the core of the job is covered by evidence',
      'Most of the core of the job is covered by direct evidence',
      'All of the core of the job is covered by direct evidence, at the level asked for',
    ],
  },
  chance: {
    type: 'score',
    question:
      'How likely is an application from this person to this opening to reach an interview? ' +
      'Read how their past applications to similar roles went (your_history_with_similar_roles) against ' +
      'their record as a whole (your_history_overall), and weigh how well their evidence matches the opening. ' +
      'Few past interviews for similar roles is a reason to score low whatever the text says.',
    levels: [
      'Almost no chance of an interview',
      'Unlikely to reach an interview',
      'About an even chance of an interview',
      'Likely to reach an interview',
      'Very likely to reach an interview',
    ],
  },
} as const satisfies Record<string, JevQuestion>;

export type OpeningQuestion = keyof typeof OPENING_QUESTIONS;
export const OPENING_QUESTION_KEYS = Object.keys(OPENING_QUESTIONS) as OpeningQuestion[];

/** One answer as stored: the value and how sure Jev was. */
export type Scored<T> = { value: T; confidence: number };

/** What `scores` holds. A question Jev gave no readable answer to is missing. */
export type OpeningScores = {
  workplace?: Scored<Workplace>;
  seniority?: Scored<Seniority>;
  salary?: Scored<boolean>;
  fit?: Scored<Fit>;
  red_flags?: Scored<boolean>;
  cover_letter?: Scored<boolean>;
  duplicate?: Scored<boolean>;
  /** The level index, 0 to 3, rounded from Jev's weighted score. */
  closeness?: Scored<number>;
  /** How well the evidence and target titles match the job, 0 to 100 (see `scaleScore`). */
  fit_score?: Scored<number>;
  /** The chance of reaching an interview, 0 to 100 (see `scaleScore`). */
  chance?: Scored<number>;
};

/** At or above this, an answer is shown plainly; below it, as unsure. */
export const SCORE_CONFIDENCE_FLOOR = 0.8;

/** What Jev is told about one opening. */
export type OpeningText = {
  title: string;
  company: string | null;
  location: string | null;
  why: string;
  move: string;
  /** The posting as read from its link (posting.ts); null until it has been read. */
  postingText?: string | null;
};

/** What Jev is told about the person, the same for every opening in a run. */
export type ScoringContext = {
  evidence: string[];
  targetTitles: string[];
  /** "Title at Company", newest first. */
  applied: string[];
  /** Every role on file, for the duplicate question. */
  roles: { title: string; company: string | null; status: string }[];
  /** Every application on file with how it went, newest first, for the chance question. */
  history: PastApplication[];
  /** What they want from a job, from /jobs/settings; absent reads as none set. */
  preferences?: JobPreferences;
};

/** How many applied roles Jev reads. Enough to show the pattern, cheap enough for a cent per hundred. */
export const APPLIED_LIMIT = 30;

function sameCompany(a: string | null, b: string | null): boolean {
  const x = companyKey(a);
  const y = companyKey(b);
  if (!x || !y) return false;
  return x === y || x.startsWith(y) || y.startsWith(x);
}

function rolesAtCompany(opening: OpeningText, context: ScoringContext) {
  return context.roles.filter((role) => sameCompany(role.company, opening.company));
}

/**
 * The duplicate answer where no model is needed: no role on file at the
 * company means no, and one with the same title means yes. Jev answers the
 * rest. On the trial it put an exact title match at only 0.53.
 */
export function duplicateByRule(opening: OpeningText, context: ScoringContext): Scored<boolean> | null {
  const roles = rolesAtCompany(opening, context);
  if (roles.length === 0) return { value: false, confidence: 1 };
  const key = titleKey(opening.title);
  if (roles.some((role) => titleKey(role.title) === key)) return { value: true, confidence: 1 };
  return null;
}

/** The state Jev reads for one opening. */
export function openingState(opening: OpeningText, context: ScoringContext): Record<string, unknown> {
  return {
    opening: {
      title: opening.title,
      company: opening.company ?? 'not named',
      location: opening.location ?? 'not given',
      why_it_fits: opening.why,
      how_to_apply: opening.move,
      ...(opening.postingText?.trim()
        ? { posting_text: opening.postingText.trim().slice(0, POSTING_TEXT_FOR_SCORING) }
        : {}),
    },
    ...(context.preferences && preferenceState(context.preferences)
      ? { your_preferences: preferenceState(context.preferences) }
      : {}),
    your_evidence: context.evidence,
    your_target_titles: context.targetTitles,
    roles_you_applied_to: context.applied.slice(0, APPLIED_LIMIT),
    your_roles_at_this_company: rolesAtCompany(opening, context).map((role) => `${role.title} (${role.status.replace(/_/g, ' ')})`),
    ...historyState(opening.title, context.history),
  };
}

/**
 * The history fields of the state, under the names the chance question
 * reads. Exported for #1203, which asks the same question of an application.
 */
export function historyState(
  title: string,
  history: readonly PastApplication[],
  options: { excludeId?: string } = {},
): { your_history_with_similar_roles: unknown; your_history_overall: unknown } {
  const summary = summariseHistory(title, history, options);
  return { your_history_with_similar_roles: summary.similar, your_history_overall: summary.all_applications };
}

function choice<T extends string>(result: JevResult<JevChoiceAnswer>): Scored<T> | undefined {
  if (!result.ok) return undefined;
  return { value: result.answer.choice as T, confidence: round(result.answer.confidence) };
}

function yesNo(result: JevResult<JevYesNoAnswer>): Scored<boolean> | undefined {
  if (!result.ok) return undefined;
  return { value: result.answer.yes, confidence: round(result.answer.confidence) };
}

function level(result: JevResult<JevScoreAnswer>): Scored<number> | undefined {
  if (!result.ok) return undefined;
  return { value: result.answer.level, confidence: round(result.answer.confidence) };
}

/**
 * A score question's answer as a whole number from 0 to 100: Jev's
 * probability-weighted score (0 to levels - 1, and it can fall between
 * levels) divided by the top level. Five levels put "even" at 50.
 */
export function scaleScore(score: number, levels: number): number {
  if (levels < 2 || !Number.isFinite(score)) return 0;
  return Math.round((Math.min(Math.max(score, 0), levels - 1) / (levels - 1)) * 100);
}

function percent(result: JevResult<JevScoreAnswer>, levels: number): Scored<number> | undefined {
  if (!result.ok) return undefined;
  return { value: scaleScore(result.answer.score, levels), confidence: round(result.answer.confidence) };
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

export type ScoreOpeningInput = {
  opening: OpeningText;
  context: ScoringContext;
  onSpend?: SpendSink;
  apiKey?: string | null;
  fetch?: typeof fetch;
  timeoutMs?: number;
};

/**
 * Ask the ten questions about one opening. Never throws. A failed request
 * comes back as the failure; otherwise every readable answer is kept, so one
 * malformed answer costs that question only.
 */
export async function scoreOpening(
  input: ScoreOpeningInput,
): Promise<{ ok: true; scores: OpeningScores } | JevFailure> {
  const asked = await askJevAll({
    state: openingState(input.opening, input.context),
    questions: OPENING_QUESTIONS,
    onSpend: input.onSpend,
    apiKey: input.apiKey,
    fetch: input.fetch,
    timeoutMs: input.timeoutMs,
  });
  if (!asked.ok) return asked;
  const a = asked.answers;
  const scores: OpeningScores = {
    workplace: choice<Workplace>(a.workplace),
    seniority: choice<Seniority>(a.seniority),
    salary: yesNo(a.salary),
    fit: choice<Fit>(a.fit),
    red_flags: yesNo(a.red_flags),
    cover_letter: yesNo(a.cover_letter),
    duplicate: duplicateByRule(input.opening, input.context) ?? yesNo(a.duplicate),
    closeness: level(a.closeness),
    fit_score: percent(a.fit_score, OPENING_QUESTIONS.fit_score.levels.length),
    chance: percent(a.chance, OPENING_QUESTIONS.chance.levels.length),
  };
  for (const key of OPENING_QUESTION_KEYS) if (scores[key] === undefined) delete scores[key];
  return { ok: true, scores };
}

// ---------------------------------------------------------------------------
// Reading stored scores back, and sorting and filtering by them.

function isScored(value: unknown): value is Scored<unknown> {
  if (!value || typeof value !== 'object') return false;
  const confidence = (value as Record<string, unknown>).confidence;
  return typeof confidence === 'number' && confidence >= 0 && confidence <= 1;
}

/** The stored jsonb as scores, dropping anything that does not fit its question. */
export function parseOpeningScores(raw: unknown): OpeningScores | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const row = raw as Record<string, unknown>;
  const out: OpeningScores = {};
  const pick = <T>(key: OpeningQuestion, ok: (value: unknown) => value is T) => {
    const entry = row[key];
    if (isScored(entry) && ok(entry.value)) {
      (out as Record<string, Scored<T>>)[key] = { value: entry.value, confidence: entry.confidence };
    }
  };
  const inList =
    <T extends string>(list: readonly T[]) =>
    (value: unknown): value is T =>
      typeof value === 'string' && (list as readonly string[]).includes(value);
  const isBool = (value: unknown): value is boolean => typeof value === 'boolean';
  pick('workplace', inList(WORKPLACES));
  pick('seniority', inList(SENIORITIES));
  pick('fit', inList(FITS));
  pick('salary', isBool);
  pick('red_flags', isBool);
  pick('cover_letter', isBool);
  pick('duplicate', isBool);
  pick('closeness', (value): value is number =>
    typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < CLOSENESS_LEVELS.length,
  );
  const isPercent = (value: unknown): value is number =>
    typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 100;
  for (const key of PERCENT_SCORES) pick(key, isPercent);
  return out;
}

export const WORKPLACE_LABELS: Record<Workplace, string> = {
  remote: 'Remote',
  hybrid: 'Hybrid',
  on_site: 'On-site',
  unclear: 'Workplace not given',
};

export const SENIORITY_LABELS: Record<Seniority, string> = {
  entry: 'Entry level',
  mid: 'Mid level',
  senior: 'Senior',
  executive: 'Director and up',
};

export const FIT_LABELS: Record<Fit, string> = {
  strong: 'Strong match to your evidence',
  partial: 'Partial match to your evidence',
  weak: 'Weak match to your evidence',
};

export const CLOSENESS_LABELS: readonly string[] = [
  'Unlike your applications',
  'Somewhat like your applications',
  'Close to your applications',
  'Same as one you applied to',
];

/** One answer as a row shows it. `unsure` when Jev's confidence was under the floor. */
export type ScoreChip = { key: OpeningQuestion; label: string; unsure: boolean; tone: 'plain' | 'good' | 'warn' };

/**
 * The eight label answers as short labels, in question order. A missing
 * answer is left out. Fit and chance are figures, shown by #1206.
 */
export function scoreChips(scores: OpeningScores): ScoreChip[] {
  const chips: ScoreChip[] = [];
  const add = (key: OpeningQuestion, scored: Scored<unknown> | undefined, label: string, tone: ScoreChip['tone'] = 'plain') => {
    if (!scored) return;
    chips.push({ key, label, unsure: scored.confidence < SCORE_CONFIDENCE_FLOOR, tone });
  };
  const s = scores;
  add('workplace', s.workplace, s.workplace ? WORKPLACE_LABELS[s.workplace.value] : '');
  add('seniority', s.seniority, s.seniority ? SENIORITY_LABELS[s.seniority.value] : '');
  add('salary', s.salary, s.salary?.value ? 'Salary shown' : 'No salary given');
  add('fit', s.fit, s.fit ? FIT_LABELS[s.fit.value] : '', s.fit?.value === 'strong' ? 'good' : 'plain');
  add('red_flags', s.red_flags, s.red_flags?.value ? 'Red flags' : 'No red flags', s.red_flags?.value ? 'warn' : 'plain');
  add('cover_letter', s.cover_letter, s.cover_letter?.value ? 'Cover letter' : 'No cover letter');
  add('duplicate', s.duplicate, s.duplicate?.value ? 'Already on file' : 'New to you', s.duplicate?.value ? 'warn' : 'plain');
  add('closeness', s.closeness, s.closeness ? (CLOSENESS_LABELS[s.closeness.value] ?? '') : '');
  return chips;
}

export const OPENING_SORTS = ['newest', 'fit_score', 'chance', 'fit', 'closeness', 'seniority'] as const;
export type OpeningSort = (typeof OPENING_SORTS)[number];

export const OPENING_SORT_LABELS: Record<OpeningSort, string> = {
  newest: 'Newest first',
  fit_score: 'Best fit',
  chance: 'Best chance',
  fit: 'Best match first',
  closeness: 'Most like your applications',
  seniority: 'Most senior first',
};

export type OpeningFilter = {
  workplace: Workplace | 'any';
  fit: 'any' | 'strong' | 'partial_up';
  salary: boolean;
  hideRedFlags: boolean;
  hideDuplicates: boolean;
  coverLetter: 'any' | 'yes' | 'no';
  /** The fit figure an opening must reach; 0 for any (plan #1206). */
  minFit: number;
  /** The chance band an opening must reach, chosen by band while chance shows as one. */
  minChance: ChanceBand | 'any';
};

export const NO_OPENING_FILTER: OpeningFilter = {
  workplace: 'any',
  fit: 'any',
  salary: false,
  hideRedFlags: false,
  hideDuplicates: false,
  coverLetter: 'any',
  minFit: 0,
  minChance: 'any',
};

const BAND_RANK: Record<ChanceBand, number> = { low: 0, medium: 1, high: 2 };

/** The band a stored chance falls in, on CHANCE_DISPLAY's edges (the #1204 terciles when it shows the number). */
export function chanceBandOf(value: number): ChanceBand {
  return chanceBand(value, CHANCE_DISPLAY.kind === 'band' ? CHANCE_DISPLAY.edges : { medium: 27, high: 38 });
}

/** Whether a chance clears a minimum band. */
export function reachesBand(value: number, minimum: ChanceBand | 'any'): boolean {
  return minimum === 'any' || BAND_RANK[chanceBandOf(value)] >= BAND_RANK[minimum];
}

type Sortable = { scores: OpeningScores | null; createdAt: string };

/**
 * Whether an opening passes the filter. An unscored opening passes every
 * filter, so nothing vanishes because Jev has not read it yet.
 */
export function passesFilter(opening: Sortable, filter: OpeningFilter): boolean {
  const s = opening.scores;
  if (!s) return true;
  if (filter.workplace !== 'any' && s.workplace && s.workplace.value !== filter.workplace) return false;
  if (filter.fit === 'strong' && s.fit && s.fit.value !== 'strong') return false;
  if (filter.fit === 'partial_up' && s.fit && s.fit.value === 'weak') return false;
  if (filter.salary && s.salary && !s.salary.value) return false;
  if (filter.hideRedFlags && s.red_flags?.value) return false;
  if (filter.hideDuplicates && s.duplicate?.value) return false;
  if (filter.coverLetter === 'yes' && s.cover_letter && !s.cover_letter.value) return false;
  if (filter.coverLetter === 'no' && s.cover_letter?.value) return false;
  if (filter.minFit > 0 && s.fit_score && s.fit_score.value < filter.minFit) return false;
  if (s.chance && !reachesBand(s.chance.value, filter.minChance)) return false;
  return true;
}

const FIT_RANK: Record<Fit, number> = { strong: 2, partial: 1, weak: 0 };
const SENIORITY_RANK: Record<Seniority, number> = { entry: 0, mid: 1, senior: 2, executive: 3 };

function rankFor(opening: Sortable, sort: OpeningSort): number {
  const s = opening.scores;
  switch (sort) {
    case 'fit_score':
      return s?.fit_score ? s.fit_score.value : -1;
    case 'chance':
      return s?.chance ? s.chance.value : -1;
    case 'fit':
      return s?.fit ? FIT_RANK[s.fit.value] : -1;
    case 'closeness':
      return s?.closeness ? s.closeness.value : -1;
    case 'seniority':
      return s?.seniority ? SENIORITY_RANK[s.seniority.value] : -1;
    case 'newest':
      return 0;
  }
}

/** Sorted by the chosen answer, highest first, newest first within a tie; unscored last. */
export function sortOpenings<T extends Sortable>(openings: readonly T[], sort: OpeningSort): T[] {
  return [...openings].sort((a, b) => {
    const diff = rankFor(b, sort) - rankFor(a, sort);
    if (diff !== 0) return diff;
    return b.createdAt.localeCompare(a.createdAt);
  });
}
