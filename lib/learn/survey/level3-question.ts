import 'server-only';

import type Anthropic from '@anthropic-ai/sdk';
import type { SpendSink } from '@/lib/core/spend/pricing';
import { assertSchemaExposed } from '@/lib/core/db/schema-errors';
import { LEARN_SCHEMA, type LearnSupabaseClient } from '@/lib/learn/db/schema-name';
import { loadConcept } from '@/lib/learn/graph/load';
import { PROBE_MODEL, writeProbe } from '@/lib/learn/graph/probe';
import { nextMasteryCheck, recordProbe } from '@/lib/learn/graph/session';
import type { SurveyIdea } from './idea';
import { goalQuestionDepth, ideaForGoal, type GoalCardSource } from './goal-idea';
import {
  unusedCard,
  type GoalAim,
  type GoalQuestion,
  type WrittenGoalQuestion,
} from './goal-question';
import {
  crossList,
  loadArticleCards,
  loadLevel3Claims,
  loadLevel3Ideas,
  subjectForArticle,
  type Level3Claim,
  type Level3Idea,
} from './level3-load';
import { surveySubjectForAim } from './subject';

/**
 * Write one Practice Flow question for the Level 3 goal (plan #1386).
 *
 * The Level 3 goal is a list of articles, so its questions are about the
 * articles you claimed (a Got it or a save) and have not yet been tested on,
 * read from `learn.level3_untested_claims`. The pick is `pickLevel3Article`.
 * The idea is written from a section of the article that one of its cards
 * was cut from, as an open goal's is from a goal card, and from the article's
 * title when no card has text.
 *
 * The idea goes in the goal's hidden survey subject, so the queue reads it as
 * a goal question by the subject's `aim_id` like any other goal's, and it is
 * cross-listed into the subject named after the article. That cross-listing
 * is what `learn.article_evidence` counts: a right answer on the idea makes
 * the article tested, so the tested count on the Goals page rises with no
 * change to the view.
 */

/** What the idea call is told the "goal" is about when it is an article. */
const ARTICLE_ABOUT = "One of Wikipedia's Level 3 vital articles.";

type Idea = {
  conceptId: string;
  name: string;
  claim: string;
  mastery: string[];
  source: GoalQuestion['source'];
  cardTitle: string | null;
};

const key = (title: string) => title.trim().toLowerCase();

/**
 * The claimed article to ask about next, or null when there is none.
 *
 * `claims` are untested articles, the longest claimed first. An article with
 * a question still waiting in the queue is skipped, so two waiting questions
 * are never about one article. Of the rest, the one asked about least goes
 * first, so a wrong answer does not bring the same article straight back
 * while others wait; between equals, the longest claimed.
 */
export function pickLevel3Article(
  claims: readonly Level3Claim[],
  ideas: readonly Pick<Level3Idea, 'article' | 'asked' | 'waiting'>[],
): string | null {
  const asked = new Map<string, number>();
  const waiting = new Set<string>();
  for (const idea of ideas) {
    if (!idea.article) continue;
    const article = key(idea.article);
    asked.set(article, (asked.get(article) ?? 0) + idea.asked);
    if (idea.waiting > 0) waiting.add(article);
  }
  let best: { title: string; asked: number } | null = null;
  for (const claim of claims) {
    const article = key(claim.title);
    if (waiting.has(article)) continue;
    const count = asked.get(article) ?? 0;
    if (!best || count < best.asked) best = { title: claim.title, asked: count };
  }
  return best?.title ?? null;
}

async function insertIdea(
  supabase: LearnSupabaseClient,
  userId: string,
  subjectId: string,
  idea: SurveyIdea,
): Promise<string> {
  const { data, error } = await supabase
    .from('concepts')
    .insert({
      user_id: userId,
      subject_id: subjectId,
      name: idea.name,
      claim: idea.claim,
      basis: idea.basis,
      origin: 'reading',
      mastery: idea.mastery,
      kind: idea.kind,
    })
    .select('id')
    .single();
  assertSchemaExposed(error, LEARN_SCHEMA);
  if (error || !data) {
    throw new Error(`Writing the idea failed: ${(error ?? { message: 'no row' }).message}`);
  }
  return (data as { id: string }).id;
}

export async function writeLevel3Question(input: {
  supabase: LearnSupabaseClient;
  userId: string;
  aim: GoalAim;
  anthropicApiKey: string;
  /** As for `writeGoalQuestion`: set to store it as one of Practice Flow's. */
  flow?: { shownAt: string | null };
  client?: Anthropic;
  /** The idea's model call. Record it as 'write-survey-idea'. */
  onIdeaSpend?: SpendSink;
  /** The question's model call. Record it as 'write-survey-question'. */
  onSpend?: SpendSink;
}): Promise<WrittenGoalQuestion> {
  const { supabase, userId, aim } = input;

  const subject = await surveySubjectForAim(supabase, userId, aim);
  if (!subject)
    return { ok: false, reason: 'tracked', detail: `"${aim.name}" already has a subject.` };

  const [claims, ideas] = await Promise.all([
    loadLevel3Claims(supabase),
    loadLevel3Ideas(supabase, userId, subject.id),
  ]);
  const article = pickLevel3Article(claims, ideas);
  if (!article) {
    return {
      ok: false,
      reason: 'nothing-in-it',
      detail: 'No claimed Level 3 article is waiting to be asked about.',
    };
  }
  const onArticle = ideas.filter((idea) => idea.article && key(idea.article) === key(article));
  const depth = goalQuestionDepth(aim.depth, 0);

  let idea: Idea;
  const unasked = onArticle.find((candidate) => candidate.asked === 0);
  if (unasked) {
    idea = { ...unasked, source: 'earlier', cardTitle: null };
  } else {
    const cards = await loadArticleCards(supabase, userId, article);
    // Every section already used: ask about the newest again, at a new idea.
    const card: GoalCardSource | null = unusedCard(cards, onArticle) ?? cards[0] ?? null;
    const ask = (from: GoalCardSource | null) =>
      ideaForGoal({
        source: { aim: { id: aim.id, name: article, about: ARTICLE_ABOUT }, depth, card: from },
        existing: onArticle.map((candidate) => candidate.name),
        anthropicApiKey: input.anthropicApiKey,
        client: input.client,
        onSpend: input.onIdeaSpend,
      });
    let result = await ask(card);
    let source: Idea['source'] = card ? 'card' : 'wording';
    if (!result.ok && card && result.reason !== 'error') {
      result = await ask(null);
      source = 'wording';
    }
    if (!result.ok) return result;

    const written: SurveyIdea =
      source === 'wording'
        ? { ...result.idea, basis: `From "${article}", a Level 3 article you claimed` }
        : result.idea;
    const conceptId = await insertIdea(supabase, userId, subject.id, written);
    idea = {
      conceptId,
      name: written.name,
      claim: written.claim,
      mastery: written.mastery ?? [],
      source,
      cardTitle: source === 'card' ? card!.title : null,
    };
  }
  // Filed under the article as well, which is what makes a right answer count
  // as tested. An idea reused from last time is already filed; this is a no-op.
  const articleSubjectId = await subjectForArticle(supabase, userId, article);
  await crossList(supabase, userId, idea.conceptId, articleSubjectId, article);

  const check = nextMasteryCheck(idea.mastery, []);
  const written = await writeProbe({
    concept: idea.name,
    claim: idea.claim,
    check,
    otherChecks: idea.mastery.filter((other) => other !== check),
    anthropicApiKey: input.anthropicApiKey,
    client: input.client,
    onSpend: input.onSpend,
  });
  // The idea stays, unasked, and the next call uses it.
  if (!written.ok) {
    return {
      ok: false,
      reason: written.reason === 'error' ? 'error' : 'ungrounded',
      detail: written.detail,
    };
  }

  let flow;
  if (input.flow) {
    const concept = await loadConcept(supabase, idea.conceptId);
    flow = {
      pickedState: concept?.state ?? 'unknown',
      pickedRecheck: null,
      shownAt: input.flow.shownAt,
    };
  }
  const probeId = await recordProbe(supabase, userId, {
    conceptId: idea.conceptId,
    probe: written.probe,
    model: PROBE_MODEL,
    flow,
  });

  return {
    ok: true,
    question: {
      probeId,
      conceptId: idea.conceptId,
      conceptName: idea.name,
      subjectId: subject.id,
      aimId: aim.id,
      aimName: aim.name,
      depth,
      source: idea.source,
      cardTitle: idea.cardTitle,
      question: written.probe.question,
      options: written.probe.options,
    },
  };
}
