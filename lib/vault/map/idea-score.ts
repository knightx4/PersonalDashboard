import { createHash } from 'node:crypto';
import {
  askJevAll,
  type JevChoiceAnswer,
  type JevFailure,
  type JevResult,
  type JevScoreAnswer,
} from '@/lib/jev/client';
import type { SpendSink } from '@/lib/core/spend/pricing';
import type { NoteVoice } from '@/lib/vault/notes/voice';
import { DEFAULT_VAULT_RULES, whyNotRead, type VaultRules } from './rules';

/**
 * Sorting an idea from the map by kind and scoring it for usefulness and
 * novelty, all with Jev (plan #2947.2, under #2947).
 *
 * One request per idea carries three questions: what kind of idea it is, how
 * useful it is and how new it is. Only the writer's own ideas and designs
 * keep their scores; the other three kinds are stored with their type and
 * null scores, since the 4 November trial found story motifs, product
 * requirements and ideas credited to someone else among the sampled rows.
 *
 * Each score question has ten levels, Jev's most, and Jev answers with a
 * probability for each. The score out of 100 is the probability-weighted
 * level, 0 to 9, times 100 / 9, rounded (scoreOutOf100).
 *
 * The trial scored novelty from the map's one-sentence statement alone and
 * found it bunched at the bottom, since a summary flattens an idea into a
 * textbook point. So Jev also reads up to three passages the idea was taken
 * from, and the novelty question tells it to judge from those.
 *
 * Nothing here writes to the database. The job that scores the map
 * (#2947.3) reads the position and its sources, calls scoreIdea and stores
 * the result in obsidian.position_scores.
 */

/**
 * Stored with every score. A change to any question's wording below takes a
 * new version, so scores made under the old wording can be told apart and
 * asked again.
 *
 * The trial's 1-to-5 rubric was not kept with the plan, so these ten levels
 * were written from the step's own description of it: what each question
 * asks and the novelty anchors (0-1 a textbook point, 4-5 a fresh
 * combination of known parts, 8-9 no clear precedent).
 */
export const IDEA_SCORE_RUBRIC_VERSION = 'idea-score-2026-11-v1';

export const IDEA_TYPES = [
  'own_idea',
  'project_design',
  'requirement',
  'others_idea',
  'description',
] as const;
export type IdeaType = (typeof IDEA_TYPES)[number];

/** The kinds that keep their scores. */
export const SCORED_IDEA_TYPES: ReadonlySet<IdeaType> = new Set<IdeaType>(['own_idea', 'project_design']);

/** At most this many passages go to Jev with the idea. */
export const IDEA_SCORE_MAX_PASSAGES = 3;

/** A passage longer than this is cut, so one long quote cannot crowd the state. */
const PASSAGE_CHARS = 1_500;

const IDEA_TYPE_OPTIONS: Readonly<Record<IdeaType, string>> = {
  own_idea:
    'The writer\'s own idea: a view they argue, a method they propose or a claim they hold, in their own words. "Neighbourhoods should be planned so a school is a ten-minute walk from every home."',
  project_design:
    'A design for something the writer is building or imagining: an app, a building, a city, a game, a story world. It says how the thing should work or be made. "The reading app shows one paragraph at a time and asks a question before the next."',
  requirement:
    'A task, a spec item or a deliverable, with nothing argued: what has to be done or what a product must do, not why. "The export must include the date column."',
  others_idea:
    'Someone else\'s idea: the note credits it to a person, book, course or article, or it summarises what a source says rather than what the writer holds. "Jacobs argues that mixed-use streets are safer."',
  description:
    'A definition, a motif, an observation or a record, with no view or proposal in it: what a term means, a recurring image in a story, what happened, what something looks like. "A sonnet has fourteen lines."',
};

export const IDEA_TYPE_QUESTION = {
  type: 'choice',
  question:
    "`idea` is one idea taken from somebody's personal notes, with `basis` saying how it was found and `passages` quoting the notes it was taken from, each with the note's title. What kind of idea is it? Judge from the passages as well as the summary: a summary can make a quoted source or a story motif read like the writer's own view.",
  options: IDEA_TYPE_OPTIONS,
} as const;

const USEFULNESS_LEVELS = [
  'Level 0. Changes nothing anyone does or decides: a truism, a mood or a remark with no bearing on any choice. Example: "Time goes faster as you get older."',
  'Level 1. Touches a choice only in principle, and is too vague for anyone to act on. Example: "Life is about balance."',
  'Level 2. Bears on a small choice for the writer alone, and says little about what to do. Example: "I should read more."',
  'Level 3. Changes a small habit or choice for the writer or a few people, with enough said to try it tomorrow. Example: "Leave the phone in another room for the first hour of writing."',
  'Level 4. Bears on a real decision for a group of people, such as a team, a household or a class, but loosely stated: the reader has to work out how. Example: "Meetings should end with who does what."',
  'Level 5. Changes a real decision for a group of people, with enough detail to act on next week. Example: "Cap planning meetings at 25 minutes and end each one by naming an owner for every action."',
  'Level 6. Would change how many people in a field or role work or decide, stated as a direction more than a method. Example: "Cities should charge for street parking what the space costs."',
  'Level 7. Would change how many people in a field or role work or decide, with a method or proposal concrete enough to adopt. Example: "Price each block\'s parking so one space in eight stays free, and adjust the price every month."',
  'Level 8. Bears on large or important decisions, such as a policy, a career or a big investment, for a large number of people, and is concrete enough to act on with some working out. Example: "Let any lot within ten minutes\' walk of a station be built to six storeys without a hearing."',
  'Level 9. Would change important decisions for very many people, and says exactly what to do. Example: "Doctors should wash their hands in chlorinated water between the autopsy room and the delivery ward."',
] as const;

export const USEFULNESS_QUESTION = {
  type: 'score',
  question:
    "`idea` is one of somebody's own ideas or designs, taken from their personal notes; `passages` quote the notes it came from. How useful is it? Ask whether taking the idea seriously would change what someone does or decides, for how many people, and whether it says enough to act on. Judge the idea as written, not a better version it could become.",
  levels: USEFULNESS_LEVELS,
} as const;

const NOVELTY_LEVELS = [
  'Level 0. A common saying, or the first thing any textbook on the subject says. Example: "Practice makes perfect."',
  'Level 1. A textbook point in its field, known to anyone who has studied the subject at all. Example: "Prices rise when demand outruns supply."',
  'Level 2. Well known to people who work in the field, stated in the usual way. Example: "Widening a road fills it with new traffic."',
  'Level 3. A known idea given a personal twist or an unusual setting, where the twist itself is familiar. Example: "Induced demand applies to email too: answering faster brings more email."',
  'Level 4. A fresh combination of known parts: two or more familiar ideas joined in a way a well-read person in the field has not usually seen, though each part is standard. Example: "Run a city\'s budget consultation as a board game residents play in the library."',
  'Level 5. A fresh combination of known parts whose joining yields a consequence of its own, one neither part gives alone. Example: "Because a game\'s rules force trade-offs, residents who play the budget game accept cuts they would reject in a survey."',
  'Level 6. Departs from what the field holds on one point, with a reason; a well-read person would know the neighbourhood but not this view. Example: "Walkable towns need fewer shops, not more, so each one gets the footfall to survive."',
  'Level 7. An original view or design that a well-read person in the field would not have met, though close relatives exist in a neighbouring field. Example: a way of zoning streets borrowed from how hospitals lay out wards.',
  'Level 8. No clear precedent: a well-read person could not name where it comes from, and it frames the problem in a new way. Example: an argument that a city\'s traffic is best read as a market for time, priced by queueing.',
  'Level 9. No clear precedent, and it opens a new line of thought or a new kind of thing, as a founding paper or invention does. Example: "Treat money as a ledger anyone can keep, with no bank holding it."',
] as const;

export const NOVELTY_QUESTION = {
  type: 'score',
  question:
    "`idea` is one of somebody's own ideas or designs, taken from their personal notes; `passages` quote the notes it came from. How new is it to the world? Ask whether someone well read in the idea's field would already know it. Judge from the passages, not the one-line summary in `idea`: a summary flattens an idea into its most familiar form, and what is new is often in the particulars the passage gives. Anchors: levels 0 and 1 are a textbook point or a common saying, 4 and 5 a fresh combination of known parts, 8 and 9 have no clear precedent.",
  levels: NOVELTY_LEVELS,
} as const;

/** The three questions, sent together in one request. */
export const IDEA_SCORE_QUESTIONS = {
  type: IDEA_TYPE_QUESTION,
  usefulness: USEFULNESS_QUESTION,
  novelty: NOVELTY_QUESTION,
} as const;

/** One sentence an idea was taken from, with the note it is in. */
export type IdeaSource = {
  quote: string;
  note: { title: string; path: string; voice: NoteVoice | null };
};

export type IdeaToScore = {
  /** obsidian.positions.statement */
  statement: string;
  /** obsidian.positions.basis: how the map found it. */
  basis: string;
  /** obsidian.position_sources, each with its note. */
  sources: readonly IdeaSource[];
};

export type IdeaScoreState = {
  idea: string;
  basis: string;
  passages: { note: string; text: string }[];
};

/**
 * Whether a source's passage may go to Jev. Never one from a secret note, one
 * written only for somebody else (an application, an essay: what it argues
 * may not be what the writer holds), or one in a journal folder or a folder
 * the person left out of the map. A passage that looks like it holds a key is
 * held back too, whatever its note.
 */
export function passageMaySend(source: IdeaSource, rules: VaultRules = DEFAULT_VAULT_RULES): boolean {
  if (source.note.voice === 'secret' || source.note.voice === 'audience') return false;
  return whyNotRead({ path: source.note.path, body: source.quote }, rules) === null;
}

/**
 * What Jev reads about one idea, and the hash of it. The note's path is
 * never sent, only its title. Passages are taken in a fixed order (by note
 * title, then quote), so the same idea always sends the same state and
 * hashes the same.
 */
export function ideaScoreState(
  idea: IdeaToScore,
  rules: VaultRules = DEFAULT_VAULT_RULES,
): { state: IdeaScoreState; inputHash: string } {
  const seen = new Set<string>();
  const passages = idea.sources
    .filter((source) => passageMaySend(source, rules))
    .map((source) => ({ note: source.note.title.trim(), text: cut(source.quote.trim()) }))
    .filter((passage) => {
      const key = `${passage.note}\u0000${passage.text}`;
      if (passage.text === '' || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => compare(a.note, b.note) || compare(a.text, b.text))
    .slice(0, IDEA_SCORE_MAX_PASSAGES);
  const state: IdeaScoreState = { idea: idea.statement.trim(), basis: idea.basis.trim(), passages };
  return { state, inputHash: ideaInputHash(state) };
}

/**
 * Of exactly what Jev read, so an idea whose statement or passages changed is
 * scored again and one that did not is skipped. The rubric version is stored
 * beside it rather than mixed in, so a new rubric can be spotted on its own.
 */
export function ideaInputHash(state: IdeaScoreState): string {
  return createHash('sha256').update(JSON.stringify(state)).digest('hex');
}

/**
 * A ten-level answer as a score out of 100: the probability-weighted level,
 * 0 to 9, times 100 / 9, rounded. Weighted from the probabilities when Jev
 * gave them, normalised so they sum to one; from its own weighted score
 * otherwise.
 */
export function scoreOutOf100(answer: Pick<JevScoreAnswer, 'score' | 'probabilities'>): number {
  const top = NOVELTY_LEVELS.length - 1;
  const total = answer.probabilities.reduce((sum, p) => sum + p, 0);
  const weighted =
    total > 0
      ? answer.probabilities.reduce((sum, p, level) => sum + p * level, 0) / total
      : answer.score;
  return Math.round((Math.min(top, Math.max(0, weighted)) * 100) / top);
}

/** One idea's answer, in the shape obsidian.position_scores stores. */
export type IdeaScore = {
  ideaType: IdeaType;
  typeConfidence: number;
  typeProbabilities: Record<IdeaType, number>;
  /** 0 to 100; null unless the type is scored. */
  usefulness: number | null;
  usefulnessConfidence: number | null;
  /** Jev's ten probabilities, lowest level first; null unless the type is scored. */
  usefulnessLevels: number[] | null;
  novelty: number | null;
  noveltyConfidence: number | null;
  noveltyLevels: number[] | null;
  /** The versioned Jev model that answered. */
  model: string;
  rubricVersion: string;
  inputHash: string;
};

export type IdeaScoreResult = { ok: true; score: IdeaScore } | JevFailure;

type ScoreAnswers = {
  type: JevResult<JevChoiceAnswer<IdeaType>>;
  usefulness: JevResult<JevScoreAnswer>;
  novelty: JevResult<JevScoreAnswer>;
};

/**
 * Jev's three answers as one idea's score. The type has to be readable; the
 * two scores have to be readable only when the type keeps them. A failure is
 * handed back so the caller leaves the idea unscored and asks again later.
 */
export function readIdeaScore(answers: ScoreAnswers, inputHash: string): IdeaScoreResult {
  if (!answers.type.ok) return answers.type;
  const type = answers.type.answer;
  const base = {
    ideaType: type.choice,
    typeConfidence: type.confidence,
    typeProbabilities: type.probabilities,
    model: answers.type.model,
    rubricVersion: IDEA_SCORE_RUBRIC_VERSION,
    inputHash,
  };
  if (!SCORED_IDEA_TYPES.has(type.choice)) {
    return {
      ok: true,
      score: {
        ...base,
        usefulness: null,
        usefulnessConfidence: null,
        usefulnessLevels: null,
        novelty: null,
        noveltyConfidence: null,
        noveltyLevels: null,
      },
    };
  }
  if (!answers.usefulness.ok) return answers.usefulness;
  if (!answers.novelty.ok) return answers.novelty;
  const usefulness = answers.usefulness.answer;
  const novelty = answers.novelty.answer;
  return {
    ok: true,
    score: {
      ...base,
      usefulness: scoreOutOf100(usefulness),
      usefulnessConfidence: usefulness.confidence,
      usefulnessLevels: usefulness.probabilities,
      novelty: scoreOutOf100(novelty),
      noveltyConfidence: novelty.confidence,
      noveltyLevels: novelty.probabilities,
    },
  };
}

export type ScoreIdeaInput = {
  idea: IdeaToScore;
  /** The person's private-folder rules (loadVaultRules); the defaults otherwise. */
  rules?: VaultRules;
  onSpend?: SpendSink;
  apiKey?: string | null;
  fetch?: typeof fetch;
  timeoutMs?: number;
};

/**
 * Sort and score one idea with Jev, in one request. Never throws. There is no
 * Haiku fallback: the person chose Jev for both scores, so a failure leaves
 * the idea for the next run. Whether the account has Jev turned on
 * (lib/jev/enabled.ts) is the caller's to check before calling.
 */
export async function scoreIdea(input: ScoreIdeaInput): Promise<IdeaScoreResult> {
  const { state, inputHash } = ideaScoreState(input.idea, input.rules);
  const result = await askJevAll({
    state,
    questions: IDEA_SCORE_QUESTIONS,
    onSpend: input.onSpend,
    apiKey: input.apiKey,
    fetch: input.fetch,
    timeoutMs: input.timeoutMs,
  });
  if (!result.ok) return result;
  return readIdeaScore(result.answers as ScoreAnswers, inputHash);
}

function cut(text: string): string {
  return text.length > PASSAGE_CHARS ? `${text.slice(0, PASSAGE_CHARS - 1)}…` : text;
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
