import { z } from 'zod';
import { explainPrompt } from '@/lib/learn/flow/explain';
import { explanationReply, followUpReply, type ExplanationMarking, type Marking, type TeachBackState } from '@/lib/learn/feed/teach-back';
import type { TalkTurn } from '@/lib/talk/talk';
import type { PieceIdea } from './piece-store';

/**
 * A piece worked as a conversation with Dash on Now (plan #2164.5).
 *
 * Dash explains the piece's ideas one at a time, each from its written
 * lesson, and asks you to explain it back. Your explanation is marked by the
 * teach-back grader (`lib/learn/flow/explain-store.ts`) and kept as a
 * question at the defence rung, and Dash's reply is the marks and one
 * follow-up built on what you wrote. The answer to the follow-up is marked
 * too, and the reply to it goes on to the next idea. After the last idea the
 * piece's check is the last turn, and a right answer finishes the piece.
 *
 * A turn of yours that ends in a question mark is a question to Dash, not an
 * answer: Dash replies from the lesson and asks again, and nothing is marked.
 *
 * The turns are kept in core.conversations under the piece's row; where the
 * thread has got to is kept on the piece (`plan_pieces.talk`, learn migration
 * 0152), so the server knows which row the next answer is for. This file is
 * the part that needs no database: that state, and what Dash says.
 */

const stateSchema = z.discriminatedUnion('stage', [
  z.object({ stage: z.literal('explain'), conceptId: z.string().uuid(), probeId: z.string().uuid() }),
  z.object({
    stage: z.literal('follow_up'),
    conceptId: z.string().uuid(),
    probeId: z.string().uuid(),
    followUpId: z.string().uuid(),
  }),
  // No check id when the check could not be written; the next turn asks again.
  z.object({ stage: z.literal('check'), checkId: z.string().uuid().nullable() }),
  z.object({ stage: z.literal('done') }),
]);

export type PieceTalkState = z.infer<typeof stateSchema>;

/** The stored state, or null for a thread not started or a value that is not one. */
export function parsePieceTalk(value: unknown): PieceTalkState | null {
  const parsed = stateSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/** Where the thread is, as the screen shows it. */
export type PieceTalkView = {
  stage: 'explain' | 'follow_up' | 'check' | 'done';
  /** The idea being asked about, from 0; the idea count at the check and after. */
  idea: number;
};

export function talkView(state: PieceTalkState | null, ideas: readonly Pick<PieceIdea, 'conceptId'>[]): PieceTalkView {
  if (!state) return { stage: 'explain', idea: 0 };
  if (state.stage === 'check' || state.stage === 'done') return { stage: state.stage, idea: ideas.length };
  const at = ideas.findIndex((idea) => idea.conceptId === state.conceptId);
  return { stage: state.stage, idea: Math.max(0, at) };
}

/** The line under the piece's name: which idea, the check, or finished. */
export function talkMeta(view: PieceTalkView, total: number): string {
  if (view.stage === 'done') return 'Finished';
  if (view.stage === 'check') return 'The check · a right answer finishes the piece';
  return `Idea ${Math.min(view.idea + 1, total)} of ${total}, then one question`;
}

/** What the box's opener says at each stage. */
export function talkLabel(view: PieceTalkView): string {
  if (view.stage === 'follow_up') return 'Answer the follow-up';
  if (view.stage === 'check') return 'Answer the check';
  return 'Explain it back';
}

/** The question asked about an idea: explain it to a friend. */
export function ideaQuestion(idea: Pick<PieceIdea, 'name'>): string {
  return explainPrompt(idea.name);
}

const IDEA_LEAD = 'Idea';
const IDEA_LINE = /^Idea (\d+) of (\d+): (.+)$/m;
const CHECK_LEAD = 'That is every idea in the piece.';

/**
 * Dash explaining one idea, from its lesson when one is written and from the
 * idea as kept when not, then the question about it.
 */
export function explainTurn(idea: PieceIdea, index: number, total: number): string {
  const lines = [`${IDEA_LEAD} ${index + 1} of ${total}: ${idea.name.trim()}`, ''];
  const lesson = idea.lesson;
  if (lesson) {
    lines.push(lesson.takeaway.trim(), '');
    if (lesson.summary?.trim()) lines.push(lesson.summary.trim(), '');
    if (lesson.example?.trim()) lines.push(`For example: ${lesson.example.trim()}`, '');
  } else {
    lines.push(idea.claim.trim(), '');
  }
  lines.push(ideaQuestion(idea));
  return lines.join('\n');
}

/** Whether a turn of yours is a question to Dash rather than an answer. */
export function isQuestionToDash(body: string): boolean {
  return /\?\s*$/.test(body.trim());
}

/** The reply to your explanation: the marks and the one follow-up. */
export function explainedTurn(marking: ExplanationMarking, followUp: string): string {
  return explanationReply(marking, followUp);
}

/**
 * The reply to your follow-up answer: its marks and where the idea now
 * stands. The next idea, or the check, follows as a turn of its own.
 */
export function followedUpTurn(marking: Marking, name: string, state: TeachBackState): string {
  // The idea's name in quotes: a long one reads as a name, not as a clause.
  return followUpReply(marking, `“${name.trim()}”`, state);
}

/** The check as the last turn, after every idea, its question set in bold. */
export function checkTurn(question: string): string {
  return `${CHECK_LEAD} Last, one question that needs them together. A right answer finishes it.\n\n**${question.trim()}**`;
}

/** One idea's part of the thread, or the check's. */
export type TalkSection =
  | { kind: 'idea'; number: number; total: number; name: string; turns: TalkTurn[]; state: TeachBackState | null }
  | { kind: 'check'; turns: TalkTurn[] };

const STATE_AT_END = /is now marked (shaky|known|sharp)/;

/**
 * The thread cut where Dash starts an idea or the check, so the ideas already
 * worked through can fold to one line each, saying where each one ended.
 */
export function talkSections(turns: readonly TalkTurn[]): TalkSection[] {
  const sections: TalkSection[] = [];
  for (const turn of turns) {
    const body = turn.body.trim();
    const idea = turn.role === 'assistant' ? IDEA_LINE.exec(body.split('\n')[0] ?? '') : null;
    if (idea) {
      sections.push({ kind: 'idea', number: Number(idea[1]), total: Number(idea[2]), name: idea[3]!.trim(), turns: [], state: null });
    } else if (turn.role === 'assistant' && body.startsWith(CHECK_LEAD)) {
      sections.push({ kind: 'check', turns: [] });
    } else if (sections.length === 0) {
      sections.push({ kind: 'check', turns: [] });
    }
    const current = sections[sections.length - 1]!;
    current.turns.push(turn);
    if (current.kind === 'idea' && turn.role === 'assistant') {
      const state = STATE_AT_END.exec(body);
      if (state) current.state = state[1] as TeachBackState;
    }
  }
  return sections;
}

/** The reply to the check: right finishes the piece; wrong says why and asks a fresh one. */
export function checkedTurn(
  check: { correct: boolean; why: string | null; expected: string | null },
  next: string | null,
): string {
  if (check.correct) {
    return [check.why?.trim() || 'Right.', '', 'That finishes today’s piece.'].join('\n');
  }
  const lines = [check.why?.trim() || 'Not yet.'];
  if (check.expected?.trim()) lines.push('', `What I was looking for: ${check.expected.trim()}`);
  if (next) lines.push('', `Try this one instead:\n\n**${next.trim()}**`);
  return lines.join('\n');
}

/** The line in place of the box once the piece is finished. */
export const FINISHED_LINE = 'Today’s piece is finished. Next time, Now opens on the piece after it.';
