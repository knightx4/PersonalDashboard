import 'server-only';

import type { SpendSink } from '@/lib/core/spend/pricing';
import type { LearnSupabaseClient } from '@/lib/learn/db/schema-name';
import {
  markExplanation,
  markFollowUp,
  TEACH_BACK_MODEL,
  type TeachBackIdea,
} from '@/lib/learn/feed/mark-teach-back';
import { teachBackState } from '@/lib/learn/feed/teach-back';
import { settleTeachBackState } from '@/lib/learn/feed/teach-back-store';
import type { Explained, FollowedUp } from './explain';

/**
 * Answering an explain question in Practice Flow (plan #2164.2), through the
 * teach-back grader.
 *
 * The explanation is kept on the question's own row (`response`, marked in
 * `response_correct` and `grade_reason`). The follow-up the grader writes is
 * stored as a row of its own at the same rung, with its expected answer, so
 * the answer to it is marked against what the grader meant and the expected
 * answer never reaches the browser. It has no `picked_state`, so the flow's
 * queue never takes it as a question of its own.
 *
 * Every read is by id through the person's own client, and checked against
 * the idea named in the form, so a row that is not theirs reads as missing.
 */

type ProbeRow = {
  id: string;
  concept_id: string;
  question: string;
  expected: string | null;
  response: string | null;
  response_correct: boolean | null;
  options: unknown;
  rung: string;
  answered_at: string | null;
  picked_state: string | null;
};

const PROBE_COLUMNS =
  'id, concept_id, question, expected, response, response_correct, options, rung, answered_at, picked_state';

export type ExplainResult<T> = { ok: true; value: T } | { ok: false; detail: string };

async function readProbe(
  supabase: LearnSupabaseClient,
  probeId: string,
  conceptId: string,
): Promise<ProbeRow | null> {
  const { data, error } = await supabase
    .from('probes')
    .select(PROBE_COLUMNS)
    .eq('id', probeId)
    .maybeSingle();
  if (error) throw new Error(`Reading the question failed: ${error.message}`);
  const row = data as ProbeRow | null;
  if (!row || row.concept_id !== conceptId || row.rung !== 'defend' || row.options !== null) {
    return null;
  }
  return row;
}

async function readIdea(
  supabase: LearnSupabaseClient,
  conceptId: string,
): Promise<TeachBackIdea | null> {
  const { data, error } = await supabase
    .from('concepts')
    .select('name, claim, basis')
    .eq('id', conceptId)
    .maybeSingle();
  if (error) throw new Error(`Reading the idea failed: ${error.message}`);
  if (!data) return null;
  const row = data as { name: string; claim: string; basis: string | null };
  return { name: row.name, claim: row.claim, basis: row.basis ?? '' };
}

/** Mark one row answered, only while it is still unanswered. False when it was not. */
async function markAnswered(
  supabase: LearnSupabaseClient,
  probeId: string,
  fields: Record<string, unknown>,
): Promise<boolean> {
  const { data, error } = await supabase
    .from('probes')
    .update({ ...fields, answered_at: new Date().toISOString() })
    .eq('id', probeId)
    .is('answered_at', null)
    .select('id');
  if (error) throw new Error(`Keeping your answer failed: ${error.message}`);
  return (data ?? []).length > 0;
}

/**
 * The explanation: marked for what was right and what was missing, the idea
 * left where the mark leaves it, and the one follow-up stored to be answered
 * next. "I don't know" is a miss with no model call and no follow-up, and the
 * idea's claim comes back with it so the screen can show what it was.
 */
export async function answerExplanation(
  supabase: LearnSupabaseClient,
  userId: string,
  input: {
    probeId: string;
    conceptId: string;
    response: string;
    dontKnow: boolean;
    anthropicApiKey: string | undefined;
    onSpend?: SpendSink;
  },
): Promise<ExplainResult<Explained>> {
  const row = await readProbe(supabase, input.probeId, input.conceptId);
  if (!row) return { ok: false, detail: 'That question is not there any more.' };
  if (row.answered_at) return { ok: false, detail: 'That one has been answered already.' };
  const idea = await readIdea(supabase, input.conceptId);
  if (!idea) return { ok: false, detail: 'The idea this question asks about is no longer there.' };

  if (input.dontKnow) {
    const kept = await markAnswered(supabase, row.id, {
      dont_know: true,
      response_correct: false,
    });
    if (!kept) return { ok: false, detail: 'That one has been answered already.' };
    await settleTeachBackState(supabase, userId, input.conceptId, 'shaky');
    return {
      ok: true,
      value: {
        holds: false,
        right: [],
        missing: [],
        why: '',
        ownExample: false,
        dontKnow: true,
        state: 'shaky',
        claim: idea.claim,
      },
    };
  }

  if (!input.anthropicApiKey)
    return { ok: false, detail: 'Marking needs ANTHROPIC_API_KEY to be set.' };
  const marked = await markExplanation({
    idea,
    prompt: row.question,
    response: input.response,
    anthropicApiKey: input.anthropicApiKey,
    onSpend: input.onSpend,
  });
  if (!marked.ok) return { ok: false, detail: `Marking failed: ${marked.detail}` };

  const kept = await markAnswered(supabase, row.id, {
    response: input.response,
    response_correct: marked.marking.holds,
    grade_reason: marked.marking.why,
    model: TEACH_BACK_MODEL,
  });
  if (!kept) return { ok: false, detail: 'That one has been answered already.' };

  const { data, error } = await supabase
    .from('probes')
    .insert({
      user_id: userId,
      concept_id: input.conceptId,
      rung: 'defend',
      question: marked.followUp,
      expected: marked.followUpExpected,
      model: TEACH_BACK_MODEL,
    })
    .select('id')
    .single();
  if (error || !data) {
    throw new Error(`Keeping the follow-up failed: ${(error ?? { message: 'no row' }).message}`);
  }

  const state = teachBackState(marked.marking.holds, null);
  await settleTeachBackState(supabase, userId, input.conceptId, state);
  return {
    ok: true,
    value: {
      holds: marked.marking.holds,
      right: marked.marking.right,
      missing: marked.marking.missing,
      why: marked.marking.why,
      ownExample: marked.marking.ownExample,
      followUp: { probeId: (data as { id: string }).id, question: marked.followUp },
      state,
    },
  };
}

/**
 * The answer to the follow-up, marked against the answer the grader expected
 * and the explanation it followed. Holding through it marks the idea sharp,
 * as a teach-back does; the idea's claim comes back for the end of the card.
 */
export async function answerExplainFollowUp(
  supabase: LearnSupabaseClient,
  userId: string,
  input: {
    /** The explain question the follow-up came from. */
    probeId: string;
    followUpId: string;
    conceptId: string;
    response: string;
    anthropicApiKey: string | undefined;
    onSpend?: SpendSink;
  },
): Promise<ExplainResult<FollowedUp>> {
  const [explained, followUp] = await Promise.all([
    readProbe(supabase, input.probeId, input.conceptId),
    readProbe(supabase, input.followUpId, input.conceptId),
  ]);
  if (!explained || !followUp || followUp.picked_state !== null || !followUp.expected) {
    return { ok: false, detail: 'That follow-up is not there any more.' };
  }
  if (!explained.response) return { ok: false, detail: 'Explain the idea first.' };
  if (followUp.answered_at) return { ok: false, detail: 'That one has been answered already.' };
  const idea = await readIdea(supabase, input.conceptId);
  if (!idea) return { ok: false, detail: 'The idea this question asks about is no longer there.' };

  if (!input.anthropicApiKey)
    return { ok: false, detail: 'Marking needs ANTHROPIC_API_KEY to be set.' };
  const marked = await markFollowUp({
    idea,
    explanation: explained.response,
    followUp: followUp.question,
    expected: followUp.expected,
    response: input.response,
    anthropicApiKey: input.anthropicApiKey,
    onSpend: input.onSpend,
  });
  if (!marked.ok) return { ok: false, detail: `Marking failed: ${marked.detail}` };

  const kept = await markAnswered(supabase, followUp.id, {
    response: input.response,
    response_correct: marked.marking.holds,
    grade_reason: marked.marking.why,
  });
  if (!kept) return { ok: false, detail: 'That one has been answered already.' };

  const state = teachBackState(explained.response_correct === true, marked.marking.holds);
  await settleTeachBackState(supabase, userId, input.conceptId, state);
  return {
    ok: true,
    value: { ...marked.marking, state, claim: idea.claim },
  };
}
