import 'server-only';

import type Anthropic from '@anthropic-ai/sdk';
import type { SpendSink } from '@/lib/core/spend/pricing';
import { assertSchemaExposed } from '@/lib/core/db/schema-errors';
import { LEARN_SCHEMA, type LearnSupabaseClient } from '@/lib/learn/db/schema-name';
import type { AimDepth } from '@/lib/learn/aims';
import type { Depth } from '@/lib/learn/feed/depth';
import { loadConcept } from '@/lib/learn/graph/load';
import { PROBE_MODEL, writeProbe } from '@/lib/learn/graph/probe';
import { nextMasteryCheck, recordProbe } from '@/lib/learn/graph/session';
import type { SurveyIdea } from './idea';
import { cardBasisPrefix, goalQuestionDepth, ideaForGoal, type GoalCardSource } from './goal-idea';
import { loadGoalCards, loadGoalSubjectState, type GoalSubjectIdea } from './goal-load';
import { surveySubjectForAim } from './subject';

/**
 * Write one Practice Flow question about an open learning goal (plan #1383).
 *
 * The question goes in the goal's hidden survey subject (#1384) as an ordinary
 * idea and probe, written with `recordProbe`, so `recordAnswer` grades it
 * unchanged. In order:
 *
 * 1. An idea already in the subject with no question on it is used again, as
 *    for theme questions: its question failed last time.
 * 2. Otherwise a new idea, from the newest goal card marked Got it or saved
 *    that no idea has been written from yet, read from the card's section.
 * 3. With no such card, or when that card holds nothing to test, from the
 *    goal's own name and about line.
 *
 * A new idea is pitched at `goalQuestionDepth`: the goal's own depth, a level
 * up for every two right answers on it at first.
 *
 * The Level 3 goal is not written here: its questions are about the articles
 * claimed on it (#1386), so it is refused as `list`.
 */

export type GoalAim = {
  id: string;
  name: string;
  about: string | null;
  depth: AimDepth;
  listSource: string | null;
};

/** What the flow shows for a goal question. */
export type GoalQuestion = {
  probeId: string;
  conceptId: string;
  conceptName: string;
  /** The goal's hidden survey subject. Not one of your tracks. */
  subjectId: string;
  aimId: string;
  aimName: string;
  /** The level the idea was pitched at, when it was written now. */
  depth: Depth;
  /** Where the idea came from: a goal card's section, or the goal's wording. */
  source: 'card' | 'wording' | 'earlier';
  /** "Article: Section" of the card it came from, when it did. */
  cardTitle: string | null;
  question: string;
  options: string[];
};

export type WrittenGoalQuestion =
  | { ok: true; question: GoalQuestion }
  | {
      ok: false;
      /**
       * `list`: the Level 3 goal, written elsewhere. `tracked`: the goal has a
       * real track, where its questions belong. The rest are from the idea or
       * question call.
       */
      reason: 'list' | 'tracked' | 'nothing-in-it' | 'ungrounded' | 'error';
      detail: string;
    };

type Idea = {
  conceptId: string;
  name: string;
  claim: string;
  mastery: string[];
  source: GoalQuestion['source'];
  cardTitle: string | null;
};

/** The newest card no idea in the subject was written from, or null. */
export function unusedCard(
  cards: readonly GoalCardSource[],
  ideas: readonly Pick<GoalSubjectIdea, 'basis'>[],
): GoalCardSource | null {
  return (
    cards.find(
      (card) => !ideas.some((idea) => idea.basis?.startsWith(cardBasisPrefix(card.title))),
    ) ?? null
  );
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

export async function writeGoalQuestion(input: {
  supabase: LearnSupabaseClient;
  userId: string;
  aim: GoalAim;
  anthropicApiKey: string;
  /** As for `writeSurveyQuestion`: set to store it as one of Practice Flow's. */
  flow?: { shownAt: string | null };
  client?: Anthropic;
  /** The idea's model call. Record it as 'write-survey-idea'. */
  onIdeaSpend?: SpendSink;
  /** The question's model call. Record it as 'write-survey-question'. */
  onSpend?: SpendSink;
}): Promise<WrittenGoalQuestion> {
  const { supabase, userId, aim } = input;
  if (aim.listSource) {
    return { ok: false, reason: 'list', detail: `"${aim.name}" is asked about by its articles.` };
  }

  const subject = await surveySubjectForAim(supabase, userId, aim);
  if (!subject) return { ok: false, reason: 'tracked', detail: `"${aim.name}" already has a track.` };

  const state = await loadGoalSubjectState(supabase, userId, subject.id);
  const depth = goalQuestionDepth(aim.depth, state.rightAnswers);

  let idea: Idea;
  const unasked = state.ideas.find((candidate) => candidate.asked === 0);
  if (unasked) {
    idea = { ...unasked, source: 'earlier', cardTitle: null };
  } else {
    const existing = state.ideas.map((candidate) => candidate.name);
    const card = unusedCard(await loadGoalCards(supabase, userId, aim.id), state.ideas);
    const ask = (from: GoalCardSource | null) =>
      ideaForGoal({
        source: { aim, depth, card: from },
        existing,
        anthropicApiKey: input.anthropicApiKey,
        client: input.client,
        onSpend: input.onIdeaSpend,
      });
    let result = await ask(card);
    let source: Idea['source'] = card ? 'card' : 'wording';
    // A card with nothing to test in it falls back to the goal's wording,
    // rather than leaving the goal with no question this turn.
    if (!result.ok && card && result.reason !== 'error') {
      result = await ask(null);
      source = 'wording';
    }
    if (!result.ok) return result;

    const conceptId = await insertIdea(supabase, userId, subject.id, result.idea);
    idea = {
      conceptId,
      name: result.idea.name,
      claim: result.idea.claim,
      mastery: result.idea.mastery ?? [],
      source,
      cardTitle: source === 'card' ? card!.title : null,
    };
  }

  // A new idea, or one whose question failed, has had nothing asked about it.
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
    return { ok: false, reason: written.reason === 'error' ? 'error' : 'ungrounded', detail: written.detail };
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
