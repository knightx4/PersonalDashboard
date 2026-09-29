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
 * **Web search fees are not in these figures.** `enrich-company`, `find-openings`, `suggest-outreach`,
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
const JEV = 'jev-1.13.0';

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
  // A goal's whole outline (plan #1139) runs to sixteen units, where a new
  // track's opening three or four came to about 900 tokens.
  'write-curriculum': run(SONNET, 3_000, 1_500),
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
  'embed-notes': background(unit(VOYAGE_LITE, 1_500, 0)),
  'embed-note-match': unit(VOYAGE_LITE, 300, 0),
  'write-note-connections': background(run(HAIKU, 1_800, 250)),
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
  'write-outline': background(run(SONNET, 3_000, 1_500)),
  // One unit and its ten or so ideas with their claims in, the pieces out.
  'write-plan-pieces': background(unit(SONNET, 2_000, 400)),
  // One concept and the names of the others in its track.
  'add-lesson-floor': background(unit(SONNET, 3_000, 800)),
  // One unit's outcome and up to twelve of its ideas in, one question out.
  'write-unit-check': background(unit(HAIKU, 1_500, 250)),
  // The same unit, the question, the expected answer and what was written.
  'mark-unit-check': run(HAIKU, 1_500, 120),
  // One piece's few ideas and the questions already asked on it, one question out.
  'write-piece-check': run(HAIKU, 1_200, 250),
  // The same piece, the question, the expected answer and what was written.
  'mark-piece-check': run(HAIKU, 1_200, 150),
  // One piece's few ideas with their lessons' takeaways in; a task with a
  // small table, its points and a worked answer out.
  'write-piece-practice': run(SONNET, 2_500, 900),
  // The piece, the task, its points, the worked answer and the hand-in; a
  // sentence per point out.
  'mark-piece-practice': run(HAIKU, 2_000, 300),
  // The plan's outline, every unit with what it covers, in; a brief with a
  // table, its points and a worked answer out.
  'write-plan-project': run(SONNET, 3_000, 2_000),
  // The unit titles, the brief, its points, the worked answer and the
  // hand-in; a sentence per point out.
  'mark-plan-project': run(HAIKU, 4_000, 450),
  // One idea's name and claim and the questions already asked on it, one
  // question out.
  'write-review-question': run(HAIKU, 800, 200),
  // The same idea, the question, the expected answer and what was written.
  'mark-review-question': run(HAIKU, 900, 150),
  // The card's section, the conversation so far and the question in; a few
  // short paragraphs out.
  'reply-about-card': run(SONNET, 4_000, 400),
  // The card and its passage in; a few sentences and an article's name out.
  'explain-phrase': run(SONNET, 4_000, 300),
  // One Wikipedia section in, a card for each of up to three ideas out.
  'write-asked-card': run(SONNET, 4_000, 2_000),
  // One idea's claim and basis and what was written in; the marks and a
  // follow-up question out. The follow-up's marking is the same size or less.
  'mark-teach-back': run(HAIKU, 1_500, 400),
  // A description (about 800 tokens) or up to 40,000 characters of transcript
  // in, a paragraph and five points out. Weighted towards the description,
  // which every video gets and most keep.
  'summarise-video': background(unit(HAIKU, 4_000, 350)),
  // The judge (plan #1066). The screen sends the profile once with ten
  // titles and descriptions and gets ten one-line reasons back; the second
  // pass sends the profile with one video's transcript windows, up to 60,000
  // characters, or its chapter titles.
  'screen-video': background(unit(HAIKU, 5_000, 700)),
  'judge-video': background(unit(HAIKU, 12_000, 400)),

  // Jobs.
  'enrich-company': run(HAIKU, 10_000, 500),
  'write-interview-prep': run(OPUS, 8_000, 3_000),
  'classify-job-email': background(unit(HAIKU, 1_500, 100)),
  'match-evidence': run(OPUS, 10_000, 3_000),
  'draft-answer': run(OPUS, 6_000, 800),
  // The bank, the description and the thread in; a few sentences out, or a
  // whole cover letter when one is asked for.
  'reply-to-role-comment': run(SONNET, 10_000, 1_000),
  'propose-evidence': run(OPUS, 8_000, 3_000),
  'suggest-learning-tracks': run(OPUS, 4_000, 900),
  // The career goals, a CV excerpt and the names already known in, then up
  // to six searches whose results come back as input; three people with a
  // message each out.
  'suggest-outreach': run(SONNET, 50_000, 2_500),
  // The career goals and the companies already applied to, then up to six
  // searches whose results come back as input; five postings out.
  'find-openings': run(SONNET, 50_000, 2_500),
  // One opening's text, the evidence titles, thirty applied roles and the
  // eight questions in; eight answers out. 1,805 tokens a request on the trial.
  'score-openings': unit(JEV, 1_800, 0),

  // Shopping. Reading order emails is per email: inbox sync does it in the
  // background, and the reparse and review buttons know how many they send.
  'extract-email-order': unit(HAIKU, 3_000, 500),
  'read-bill-email': background(unit(HAIKU, 2_500, 150)),
  'estimate-resale-price': unit(HAIKU, 6_000, 300),
  'read-shelf-photo': run(OPUS, 2_100, 1_500),
  'read-receipt-photo': run(HAIKU, 2_000, 600),
  'parse-paste-list': run(HAIKU, 1_500, 1_000),
  'read-book-photo': run(HAIKU, 2_000, 600),

  // Core.
  'reply-to-comment': run(HAIKU, 3_000, 250),
  'suggest-from-digest': background(run(HAIKU, 5_000, 800)),
  // Four or five rounds, each resending the tools (about 3,000 tokens, most
  // of it cached) and the lookups so far; a short answer out.
  'ask-dash': run(SONNET, 30_000, 1_000),
  // Twelve weeks of the timeline, 381 events to 21 September 2026 at about
  // 30 tokens each, and the weekly lines; up to three sentences with their
  // ids out.
  'write-observations': background(run(SONNET, 12_000, 600)),
  // A year of the timeline, about 600 events to September 2026 at about 25
  // tokens each, and the totals; up to five paragraphs with their ids out.
  'write-year-review': run(SONNET, 20_000, 2_000),
  // The day's facts under their headings, at most about forty short lines;
  // three or four sentences out.
  'write-day-brief': background(run(HAIKU, 1_500, 200)),
  // One booking email in, the day, time and place out.
  'read-appointment-email': background(unit(HAIKU, 2_500, 150)),
  // The record, up to eight events and eight subject lines in; a short email out.
  'write-draft': background(unit(SONNET, 1_500, 300)),
  // A sender and subject and the eight piles in, one label out.
  'sort-email': background(unit(JEV, 250, 0)),
  // A plan row or a reply and the six questions in; six probabilities out.
  'check-writing': background(unit(JEV, 900, 0)),
  // One blocked step's ask and the two options in; one label out.
  'sort-waiting': background(unit(JEV, 150, 0)),

  // News. All but the last two from the digest cron or a script.
  'digest-issue': background(unit(HAIKU, 3_000, 300)),
  'group-stories': background(unit(VOYAGE_LITE, 2_000, 0)),
  'score-importance': background(unit(HAIKU, 1_500, 200)),
  'measure-repeats': background(run(VOYAGE_LITE, 100_000, 0)),
  // Up to 24 searches, whose results are read back in on each round.
  'recommend-newsletters': run(OPUS, 60_000, 5_000),
  // The story's summary and text, the discussion so far and the view in; a
  // counterpoint or a question out.
  'discuss-story': run(SONNET, 3_000, 300),

  // Goals: one sentence filed against open goals and steps, which are
  // listed in the prompt. Grows with the size of the tree.
  'file-capture': run(HAIKU, 4_000, 300),
  // The sentence, an outline of the goals and step titles, and the five moves
  // in; one label out. About six pauses in typing a sentence.
  'sort-capture': run(JEV, 6 * 1_500, 0),
  // A pasted page or a statement read into a form. A PDF page costs about
  // two thousand tokens as text and image together, and a statement runs to
  // a few pages.
  'read-into-form': run(HAIKU, 8_000, 800),
  // A comment on a goal, with the goal's steps and collections written out.
  'reply-to-goal-comment': run(HAIKU, 6_000, 400),
  // A morning's thirty-odd items, each read against eighty steps in two
  // requests of about three thousand tokens.
  'filter-evidence': background(run(JEV, 180_000, 0)),
};
