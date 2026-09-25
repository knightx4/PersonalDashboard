import type {
  CoreOperation,
  GoalsOperation,
  JobsOperation,
  NewsOperation,
  ShoppingOperation,
} from '@/lib/core/spend/operations';
import type { LearnOperation } from '@/lib/learn/spend';

/**
 * A written best guess at what each paid operation costs, for when the ledger
 * has too few recent runs to measure it.
 *
 * lib/core/spend/estimate.ts uses these when an operation has fewer than five
 * runs in thirty days, and the $ hint labels the figure uncertain. Each guess
 * is a model and the tokens one run (or one unit) typically sends and gets
 * back, priced through the same table the ledger uses, so a price change moves
 * the guesses with it. Where the ledger already had a few runs by September
 * 2026, the tokens were set so the guess lands near them.
 *
 * **Web search fees are not in these figures.** `enrich-company`,
 * `resolve-reference`, `estimate-resale-price` and `recommend-newsletters` call
 * the web search tool, which bills $10 per thousand searches on top of tokens. The ledger records
 * tokens only (lib/core/spend/pricing.ts), so a guess that added the fee would
 * disagree with the measured figure that later replaces it, and with the spend
 * page's comparison of estimates against the ledger. Both read about one cent
 * per search low.
 *
 * Keyed by every name in `SPEND_OPERATIONS` and `LEARN_OPERATIONS`; the type
 * makes a missing name a compile error and estimate.test.ts checks it again.
 */

export type OperationName =
  | LearnOperation
  | JobsOperation
  | ShoppingOperation
  | CoreOperation
  | NewsOperation
  | GoalsOperation;

export type OperationGuess = {
  model: string;
  /** Input tokens one run (or one unit) typically sends, prompt and context together. */
  inputTokens: number;
  /** Output tokens it typically gets back. */
  outputTokens: number;
  /**
   * `unit` when the cost grows with a count the button knows, such as items
   * to price or references to resolve: the figure is for one, and each unit
   * is one ledger row. `run` for one press, however many calls it makes.
   */
  per: 'run' | 'unit';
  /**
   * True when no button starts it: a cron sweep, inbox ingest, or work done
   * ahead of time. These get no $ hint; the spend page lists them apart.
   */
  background: boolean;
};

const HAIKU = 'claude-haiku-4-5';
const SONNET = 'claude-sonnet-5';
const OPUS = 'claude-opus-5';
const VOYAGE_LITE = 'voyage-4-lite';

function run(model: string, inputTokens: number, outputTokens: number): OperationGuess {
  return { model, inputTokens, outputTokens, per: 'run', background: false };
}

function unit(model: string, inputTokens: number, outputTokens: number): OperationGuess {
  return { model, inputTokens, outputTokens, per: 'unit', background: false };
}

function background(guess: OperationGuess): OperationGuess {
  return { ...guess, background: true };
}

export const OPERATION_GUESSES: Record<OperationName, OperationGuess> = {
  // Learn: importing a reading list. A paste is parsed once, then each
  // reference is resolved on its own with a web search, then the topic is
  // planned. The import button's estimate is the sum.
  'parse-references': run(HAIKU, 3_000, 1_500),
  'resolve-reference': unit(OPUS, 8_000, 800),
  'suggest-sources': run(OPUS, 30_000, 6_000),
  'plan-topic': run(OPUS, 40_000, 8_000),
  'name-areas': run(SONNET, 3_000, 1_000),
  'locate-passage': run(HAIKU, 3_000, 150),

  // Learn: tracks and their questions.
  'generate-chain': run(SONNET, 4_000, 3_000),
  'generate-track-from-theme': run(SONNET, 10_000, 5_000),
  'write-probe': run(HAIKU, 2_000, 200),
  'write-probe-ahead': background(unit(HAIKU, 1_800, 170)),
  'name-misconception': run(HAIKU, 1_500, 200),
  'propose-floor': run(SONNET, 3_000, 800),
  'classify-note': run(HAIKU, 1_200, 60),
  'concepts-from-note': run(HAIKU, 4_000, 1_000),
  'concepts-from-prior': run(SONNET, 3_000, 2_000),
  'concepts-from-brief': run(SONNET, 3_000, 2_000),
  'branch-from-selection': run(SONNET, 3_000, 2_000),
  'name-opening-claims': run(SONNET, 2_200, 500),
  'write-opening-question': run(HAIKU, 1_300, 55),
  'grade-opening-answer': run(HAIKU, 1_200, 50),
  'write-quiz-questions': run(HAIKU, 3_000, 2_000),
  'grade-quiz-answer': run(HAIKU, 1_500, 200),
  'write-applied-case': run(HAIKU, 2_000, 500),
  'grade-applied-answer': run(HAIKU, 2_000, 300),
  'write-curriculum': run(SONNET, 3_000, 900),
  'place-track': run(OPUS, 3_000, 400),
  'place-aim': run(OPUS, 2_500, 300),

  // Learn: the catalogue. One search press embeds the claim and judges the
  // nearest segments, up to forty of them, so the judging is priced per press.
  // The embedding is not background: the pull buttons on a track's page and
  // the transcribe buttons on the YouTube page embed what they fetched in the
  // same press (plan #917), and the sweep script records under the same name.
  'embed-catalogue': run(VOYAGE_LITE, 500_000, 0),
  'embed-claim': run(VOYAGE_LITE, 100, 0),
  'judge-segment': run(HAIKU, 60_000, 3_000),

  // Learn and vault: reading notes for the map. Reading one note from its page
  // is a press; the sweep reads the rest a chunk at a time in the background.
  'map-note': run(HAIKU, 20_000, 3_000),
  'embed-map': unit(VOYAGE_LITE, 1_000, 0),
  'map-sweep': background(unit(HAIKU, 4_000, 400)),
  'propose-theme-merges': background(unit(HAIKU, 8_000, 300)),
  'propose-position-merges': background(unit(HAIKU, 9_000, 300)),
  'link-positions': background(unit(HAIKU, 10_000, 400)),
  'check-areas': background(run(OPUS, 40_000, 5_000)),
  'place-themes': background(run(OPUS, 60_000, 6_000)),
  'write-survey-idea': background(unit(HAIKU, 6_000, 250)),
  'write-survey-question': background(unit(HAIKU, 2_500, 100)),

  // Learn now cards, written by the hourly top-up.
  'name-feed-material': background(unit(SONNET, 2_500, 100)),
  // One call per section, writing a card for each of up to three ideas.
  'write-feed-card': background(unit(SONNET, 4_000, 2_000)),
  'embed-feed-ideas': background(unit(VOYAGE_LITE, 1_500, 0)),
  // One call per lesson: the concept, its checks, and at most one catalogue section.
  'write-lesson': background(unit(SONNET, 3_500, 1_200)),
  'embed-lesson-claim': background(unit(VOYAGE_LITE, 100, 0)),
  'lay-out-lesson-unit': background(unit(SONNET, 4_000, 3_000)),
  // One unit, given the units so far and up to forty concept names in each list.
  'write-next-unit': background(unit(SONNET, 2_000, 300)),
  // One concept and the names of the others in its track.
  'add-lesson-floor': background(unit(SONNET, 3_000, 800)),

  // Jobs.
  'enrich-company': run(HAIKU, 10_000, 500),
  'write-interview-prep': run(OPUS, 8_000, 3_000),
  'classify-job-email': background(unit(HAIKU, 1_500, 100)),
  'match-evidence': run(OPUS, 10_000, 3_000),
  'draft-answer': run(OPUS, 6_000, 800),
  'propose-evidence': run(OPUS, 8_000, 3_000),

  // Shopping. Reading order emails is per email: inbox sync does it in the
  // background, and the reparse and review buttons know how many they send.
  'extract-email-order': unit(HAIKU, 3_000, 500),
  'estimate-resale-price': unit(HAIKU, 6_000, 300),
  'read-shelf-photo': run(OPUS, 2_100, 1_500),
  'read-receipt-photo': run(HAIKU, 2_000, 600),
  'parse-paste-list': run(HAIKU, 1_500, 1_000),
  'read-book-photo': run(HAIKU, 2_000, 600),

  // Core.
  'reply-to-comment': run(HAIKU, 3_000, 250),
  'suggest-from-digest': background(run(HAIKU, 5_000, 800)),

  // News. All but the last from the digest cron or a script.
  'digest-issue': background(unit(HAIKU, 3_000, 300)),
  'group-stories': background(unit(VOYAGE_LITE, 2_000, 0)),
  'score-importance': background(unit(HAIKU, 1_500, 200)),
  'measure-repeats': background(run(VOYAGE_LITE, 100_000, 0)),
  // Up to 24 searches, whose results are read back in on each round.
  'recommend-newsletters': run(OPUS, 60_000, 5_000),

  // Goals: one sentence filed against open goals and steps, which are
  // listed in the prompt. Grows with the size of the tree.
  'file-capture': run(HAIKU, 4_000, 300),
  // A pasted page or a statement read into a form. A PDF page costs about
  // two thousand tokens as text and image together, and a statement runs to
  // a few pages.
  'read-into-form': run(HAIKU, 8_000, 800),
  // A comment on a goal, with the goal's steps and collections written out.
  'reply-to-goal-comment': run(HAIKU, 6_000, 400),
};
