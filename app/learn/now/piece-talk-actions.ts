'use server';

import { z } from 'zod';
import { requireUser } from '@/lib/auth/server';
import { createCoreClient } from '@/lib/core/auth/server';
import { createLearnClient } from '@/lib/learn/auth/server';
import type { LearnSupabaseClient } from '@/lib/learn/db/schema-name';
import { answerExplainFollowUp, answerExplanation } from '@/lib/learn/flow/explain-store';
import { recordExplainProbe } from '@/lib/learn/graph/session';
import { loadPiecePage, type PieceIdea } from '@/lib/learn/lessons/piece-store';
import {
  checkedTurn,
  checkTurn,
  explainedTurn,
  explainTurn,
  followedUpTurn,
  ideaQuestion,
  isQuestionToDash,
  talkView,
  type PieceTalkState,
  type PieceTalkView,
} from '@/lib/learn/lessons/piece-talk';
import { loadPieceTalkState, pieceTalkSubject } from '@/lib/learn/lessons/todays-piece-store';
import { collectSpend, recordLearnSpend } from '@/lib/learn/spend';
import { replyAbout } from '@/lib/talk/reply';
import { appendTurns, loadConversation } from '@/lib/talk/store';
import { turnBody, type NewTalkTurn, type TalkTurn } from '@/lib/talk/talk';
import { answerPieceCheck, askPieceCheck } from '@/app/learn/s/[id]/p/[piece]/actions';

/**
 * Today's piece worked as a conversation with Dash (plan #2164.5,
 * `lib/learn/lessons/piece-talk.ts`). One press, Send, does whichever the
 * thread is at: marks an explanation, marks the answer to its follow-up and
 * goes on to the next idea or the check, marks the check, or answers a
 * question asked of Dash. Your turn is kept before anything is marked, so a
 * failed mark leaves it in the thread with the error beside it.
 */

const Id = z.string().uuid();

export type PieceTalkResult = { turns?: TalkTurn[]; error?: string; view?: PieceTalkView };

/** Added to Dash's instructions when a question is asked mid-piece. */
const PIECE_REPLY_GUIDANCE = `THE MATERIAL IS ONE IDEA OF A PIECE THEY ARE WORKING THROUGH, as its lesson
teaches it. They have stopped to ask you something before answering the
question you asked them. Answer in a few sentences, from the lesson first, and
end by asking them to have a go at your question again. Do not answer your own
question for them.`;

function ideaMaterial(idea: PieceIdea): string {
  const lesson = idea.lesson;
  const parts = [`Idea: ${idea.name}`, `As kept: ${idea.claim}`];
  if (lesson) {
    parts.push(`Takeaway: ${lesson.takeaway}`);
    if (lesson.context) parts.push(`Context: ${lesson.context}`);
    if (lesson.summary) parts.push(`Summary: ${lesson.summary}`);
    if (lesson.example) parts.push(`Example: ${lesson.example}`);
  }
  parts.push(`The question you asked them: ${ideaQuestion(idea)}`);
  return parts.join('\n\n');
}

/** Ask about one idea: its question stored as a row at the defence rung, then the explaining turn. */
async function askIdea(
  learn: LearnSupabaseClient,
  userId: string,
  ideas: readonly PieceIdea[],
  index: number,
): Promise<{ state: PieceTalkState; turn: string }> {
  const idea = ideas[index]!;
  const probeId = await recordExplainProbe(learn, userId, {
    conceptId: idea.conceptId,
    question: ideaQuestion(idea),
    expected: idea.claim,
    masteryCheck: null,
  });
  return {
    state: { stage: 'explain', conceptId: idea.conceptId, probeId },
    turn: explainTurn(idea, index, ideas.length),
  };
}

/** Ask the piece's check; a question that could not be written leaves the stage at the check with none. */
async function askCheck(subjectId: string, pieceId: string): Promise<{ state: PieceTalkState; question: string | null; error?: string }> {
  const asked = await askPieceCheck(subjectId, pieceId);
  if (asked.check) return { state: { stage: 'check', checkId: asked.check.id }, question: asked.check.question };
  return { state: { stage: 'check', checkId: null }, question: null, error: asked.error };
}

async function saveState(learn: LearnSupabaseClient, userId: string, pieceId: string, state: PieceTalkState) {
  const { error } = await learn.from('plan_pieces').update({ talk: state }).eq('id', pieceId).eq('user_id', userId);
  if (error) throw new Error(`Keeping your place in the piece failed: ${error.message}`);
}

/** Send a turn in today's piece. */
// latency: pending
export async function talkPiece(subjectId: string, pieceId: string, body: string): Promise<PieceTalkResult> {
  const user = await requireUser();
  const ids = z.tuple([Id, Id]).safeParse([subjectId, pieceId]);
  if (!ids.success) return { error: 'Could not tell which piece that was.' };
  const checked = turnBody(body);
  if ('error' in checked) return { error: checked.error };
  const text = checked.body;

  const learn = await createLearnClient();
  const core = await createCoreClient();
  let page;
  let state: PieceTalkState | null;
  try {
    [page, state] = await Promise.all([
      loadPiecePage(learn, user.id, subjectId, pieceId),
      loadPieceTalkState(learn, user.id, pieceId),
    ]);
  } catch (caught) {
    return { error: caught instanceof Error ? caught.message : 'Reading the piece failed.' };
  }
  if (!page || page.ideas.length === 0) return { error: 'This piece is no longer there.' };
  if (state?.stage === 'done') return { error: 'This piece is finished.' };
  const ideas = page.ideas;
  const subject = pieceTalkSubject(pieceId, page.piece.title);

  // Keep your turn first; on the first answer, the explaining turn the screen
  // opened on goes in ahead of it, so the thread reads the same on return.
  let earlier: TalkTurn[];
  let asked: TalkTurn[];
  try {
    earlier = await loadConversation(core, subject);
    const turns: NewTalkTurn[] = [{ role: 'user', body: text }];
    if (!state) {
      const first = await askIdea(learn, user.id, ideas, 0);
      state = first.state;
      await saveState(learn, user.id, pieceId, state);
      turns.unshift({ role: 'assistant', body: first.turn });
    }
    const written = await appendTurns(core, user.id, subject, turns);
    earlier = [...earlier, ...written.slice(0, -1)];
    asked = written.slice(-1);
  } catch (caught) {
    return { error: caught instanceof Error ? caught.message : 'Keeping your answer failed.' };
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  const view = () => talkView(state, ideas);
  if (!apiKey) return { turns: asked, error: 'Marking needs ANTHROPIC_API_KEY to be set.', view: view() };

  const current = state;
  if (current.stage === 'done') return { turns: asked, error: 'This piece is finished.', view: view() };
  let replies: string[];
  try {
    const at =
      current.stage === 'explain' || current.stage === 'follow_up'
        ? ideas.findIndex((idea) => idea.conceptId === current.conceptId)
        : -1;

    if (isQuestionToDash(text) && at >= 0) {
      const spend = collectSpend();
      const answered = await replyAbout({
        subject: { kind: 'piece', title: page.piece.title, material: ideaMaterial(ideas[at]!) },
        turns: [...earlier, ...asked],
        guidance: PIECE_REPLY_GUIDANCE,
        anthropicApiKey: apiKey,
        onSpend: spend.sink,
      });
      await recordLearnSpend(user.id, 'reply-about-card', spend.reports);
      if (!answered.ok) return { turns: asked, error: `Dash could not answer: ${answered.detail}`, view: view() };
      replies = [answered.reply];
    } else if (current.stage === 'explain') {
      const spend = collectSpend();
      const marked = await answerExplanation(learn, user.id, {
        probeId: current.probeId,
        conceptId: current.conceptId,
        response: text,
        dontKnow: false,
        anthropicApiKey: apiKey,
        onSpend: spend.sink,
      });
      await recordLearnSpend(user.id, 'mark-teach-back', spend.reports);
      if (!marked.ok) return { turns: asked, error: marked.detail, view: view() };
      const followUp = marked.value.followUp;
      if (!followUp) return { turns: asked, error: 'Dash wrote no follow-up.', view: view() };
      replies = [explainedTurn(marked.value, followUp.question)];
      state = { stage: 'follow_up', conceptId: current.conceptId, probeId: current.probeId, followUpId: followUp.probeId };
    } else if (current.stage === 'follow_up') {
      const spend = collectSpend();
      const marked = await answerExplainFollowUp(learn, user.id, {
        probeId: current.probeId,
        followUpId: current.followUpId,
        conceptId: current.conceptId,
        response: text,
        anthropicApiKey: apiKey,
        onSpend: spend.sink,
      });
      await recordLearnSpend(user.id, 'mark-teach-back', spend.reports);
      if (!marked.ok) return { turns: asked, error: marked.detail, view: view() };
      const name = ideas[at]?.name ?? 'This idea';
      if (at >= 0 && at + 1 < ideas.length) {
        const next = await askIdea(learn, user.id, ideas, at + 1);
        state = next.state;
        replies = [followedUpTurn(marked.value, name, marked.value.state), next.turn];
      } else {
        const check = await askCheck(subjectId, pieceId);
        state = check.state;
        replies = [
          followedUpTurn(marked.value, name, marked.value.state),
          check.question
            ? checkTurn(check.question)
            : `The piece's check could not be written (${check.error ?? 'no reason given'}). Send anything to try again.`,
        ];
      }
    } else if (current.checkId === null) {
      const check = await askCheck(subjectId, pieceId);
      if (!check.question) return { turns: asked, error: check.error ?? 'Could not write the check.', view: view() };
      state = check.state;
      replies = [checkTurn(check.question)];
    } else {
      const answered = await answerPieceCheck(subjectId, pieceId, current.checkId, text);
      if (!answered.check || answered.check.correct === null) {
        return { turns: asked, error: answered.error ?? 'Could not mark that.', view: view() };
      }
      const mark = { correct: answered.check.correct, why: answered.check.why, expected: answered.check.expected };
      if (mark.correct) {
        state = { stage: 'done' };
        replies = [checkedTurn(mark, null)];
      } else {
        const again = await askCheck(subjectId, pieceId);
        state = again.state;
        replies = [checkedTurn(mark, again.question)];
      }
    }
    await saveState(learn, user.id, pieceId, state);
  } catch (caught) {
    return { turns: asked, error: caught instanceof Error ? caught.message : 'Could not mark that.', view: view() };
  }

  try {
    const answered = await appendTurns(
      core,
      user.id,
      subject,
      replies.map((body) => ({ role: 'assistant' as const, body })),
    );
    return { turns: [...asked, ...answered], view: view() };
  } catch (caught) {
    return {
      turns: asked,
      error: caught instanceof Error ? caught.message : 'Keeping the marks in the thread failed.',
      view: view(),
    };
  }
}
