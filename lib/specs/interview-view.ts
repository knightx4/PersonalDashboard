import type { DevComment } from '@/lib/comments/load';
import { specChangeHref, visionDraftHref } from './interview-draft';
import { interviewExchanges, nextMove, questionsAsked, type SpecInterview } from './interviews';
import type { VisionScope } from './vision';

/**
 * What the interview card on /dev/specs draws for one workspace (plan #1641),
 * worked out on the server from the interview and what is still waiting on
 * the page, so the card and the gallery take the same plain shape.
 *
 * A workspace shows its open interview. With none open, it shows the last
 * drafted one while either of its drafts is still waiting for the person;
 * once both are decided the card has nothing left to point at, and the
 * workspace offers a new interview instead.
 */

export type InterviewCardView = {
  id: string;
  module: VisionScope;
  status: 'open' | 'drafted';
  /** Whose move it is while open; null once drafted. */
  move: 'ask' | 'answer' | 'draft' | null;
  questionLimit: number;
  asked: number;
  answered: number;
  /** Every turn, oldest first: Dash's questions and the person's answers. */
  turns: DevComment[];
  /** What Dash took from the answers, once drafted. */
  summary: string | null;
  finishedAt: string | null;
  /** Where the drafted vision waits, or null once it has been decided. */
  visionHref: string | null;
  /** Where the drafted spec change waits, or null once it has been decided. */
  specChangeHref: string | null;
};

/** The ids of the drafts still waiting on the specs page. */
export type WaitingDrafts = {
  visionEditIds: ReadonlySet<string>;
  specChangeIds: ReadonlySet<string>;
};

export function interviewCardView(interview: SpecInterview, waiting: WaitingDrafts): InterviewCardView {
  const exchanges = interviewExchanges(interview.turns);
  const drafted = interview.status === 'drafted';
  return {
    id: interview.id,
    module: interview.module,
    status: drafted ? 'drafted' : 'open',
    move: nextMove(interview),
    questionLimit: interview.questionLimit,
    asked: questionsAsked(interview),
    answered: exchanges.filter((exchange) => exchange.answer).length,
    turns: interview.turns,
    summary: interview.summary,
    finishedAt: interview.finishedAt,
    visionHref:
      drafted && interview.visionReviewId && waiting.visionEditIds.has(interview.visionReviewId)
        ? visionDraftHref(interview.module)
        : null,
    specChangeHref:
      drafted && interview.specChangeId && waiting.specChangeIds.has(interview.specChangeId)
        ? specChangeHref(interview.specChangeId)
        : null,
  };
}

/**
 * The card for each workspace that has one, from every interview of the
 * account's, newest first (loadSpecInterviews' order).
 */
export function interviewCards(
  interviews: readonly SpecInterview[],
  waiting: WaitingDrafts,
): Partial<Record<VisionScope, InterviewCardView>> {
  const cards: Partial<Record<VisionScope, InterviewCardView>> = {};
  for (const interview of interviews) {
    if (interview.status !== 'open') continue;
    cards[interview.module] = interviewCardView(interview, waiting);
  }
  // Newest first, so the first drafted one met for a workspace is its latest.
  // It is shown while a draft of its waits; older ones are not looked at.
  const seen = new Set<VisionScope>(Object.keys(cards) as VisionScope[]);
  for (const interview of interviews) {
    if (interview.status !== 'drafted' || seen.has(interview.module)) continue;
    seen.add(interview.module);
    const view = interviewCardView(interview, waiting);
    if (view.visionHref || view.specChangeHref) cards[interview.module] = view;
  }
  return cards;
}
