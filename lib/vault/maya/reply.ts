import 'server-only';

import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { usageFrom, type SpendSink } from '@/lib/core/spend/pricing';
import type { LearnOperation } from '@/lib/learn/spend';
import { forceTool, whyNoReport } from '@/lib/learn/graph/tool-call';
import { MAX_TURN } from '@/lib/talk/talk';
import { MODELS } from '@/lib/core/models';

/**
 * Maya's answer to what the person said in a thread, and where they have got
 * to (plan #1286). One call, not streamed, following lib/talk/reply.ts:
 * Sonnet, one forced tool, and the spend handed to `onSpend` for the caller
 * to record under MAYA_REPLY_OPERATION.
 *
 * The same call rewrites the thread's summary, so the summary always reflects
 * the exchange that has just happened and costs no second request.
 *
 * What is sent: the note's title and its first MAYA_REPLY_NOTE_CHARS
 * characters, the thread's question, Maya's thought as stored (which carries
 * the quotes from other notes it cited), the summary so far, and the turns of
 * the thread. Never the note's path. The privacy page says the same.
 */

export const MAYA_REPLY_MODEL = MODELS.mayaReply;

/** The name this call has in core.model_spend. Stable: renaming it splits the history. */
export const MAYA_REPLY_OPERATION: LearnOperation = 'reply-to-maya';

/** How much of the note goes in the prompt. */
export const MAYA_REPLY_NOTE_CHARS = 12_000;

/** maya_threads.summary is kept to this length. */
export const MAYA_SUMMARY_MAX = 1_500;

const TOOL_NAME = 'answer';

export const MAYA_REPLY_SYSTEM = `You are Maya, a thought partner for one person who keeps their notes in
Obsidian. Earlier you wrote a short thought on one of their notes: a few ranked
points, each drawing on their other notes and on what serious thinkers have
written. They are now talking it through with you. The note, the question it is
working on, your thought, and where they had got to so far are below.

HOW TO ANSWER
Take what they said seriously and answer it with a view of your own. Agree
where they are right and say why; push back where they are not, with the
material. Bring in their other notes as your thought quoted them, and outside
thinkers by author and specific work, giving the gist in your own words. Never
invent a quote. Never answer with a bare question or ask them to reflect: where
something is still open, say what would settle it.

HOW TO WRITE
Plain, direct prose addressed to the person as "you". A few short paragraphs at
most. No headings, no bullet lists, no slogans, no rhetorical contrast of the
form "not X, but Y", and no dashes used for rhythm.

WHERE THEY HAVE GOT TO
After answering, rewrite the summary of where they have got to on the question,
taking in this exchange. Two to four sentences addressed to them as "you": what
they now hold, what they have let go of, and what is still open. Write only
what they have said or agreed to, never what you argued and they did not take
up.`;

export type MayaReplyTurn = { role: 'person' | 'maya'; body: string };

export type MayaReplyInput = {
  note: { title: string; body: string } | null;
  question: string;
  /** Maya's first thought as stored in maya_messages.body; null when the thread has none. */
  thought: string | null;
  summary: string | null;
  /** The replies so far, oldest first, ending with the person's. Never the thought. */
  turns: readonly MayaReplyTurn[];
};

export type MayaReply = { ok: true; reply: string; summary: string } | { ok: false; detail: string };

const answerSchema = z.object({ reply: z.string(), summary: z.string() });

/**
 * The turns as the model is sent them: starting with the person and
 * alternating. A reply of the person's whose answer failed leaves two of
 * theirs in a row, and those are joined.
 */
export function replyMessages(turns: readonly MayaReplyTurn[]): { role: 'user' | 'assistant'; content: string }[] {
  const messages: { role: 'user' | 'assistant'; content: string }[] = [];
  for (const turn of turns) {
    const body = turn.body.trim();
    if (!body) continue;
    const role = turn.role === 'person' ? 'user' : 'assistant';
    // Anything of Maya's before the person's first turn is already in the
    // prompt as the thought.
    if (messages.length === 0 && role === 'assistant') continue;
    const last = messages[messages.length - 1];
    if (last && last.role === role) last.content = `${last.content}\n\n${body}`;
    else messages.push({ role, content: body });
  }
  return messages;
}

/** The system prompt with the thread's material. Never the note's path. */
export function replySystem(input: Omit<MayaReplyInput, 'turns'>): string {
  const note = input.note
    ? `THE NOTE\n\nTitle: ${input.note.title.trim()}\n\n${input.note.body.trim().slice(0, MAYA_REPLY_NOTE_CHARS)}`
    : 'THE NOTE\n\nThe note is no longer in their vault. Work from the thought and the thread.';
  const thought = input.thought?.trim()
    ? `YOUR THOUGHT ON IT\n\n${input.thought.trim()}`
    : 'YOUR THOUGHT ON IT\n\nYour thought on this note was not kept. Work from the note.';
  const summary = input.summary?.trim()
    ? `WHERE THEY HAD GOT TO\n\n${input.summary.trim()}`
    : 'WHERE THEY HAD GOT TO\n\nNothing yet: this is their first reply.';
  return [
    MAYA_REPLY_SYSTEM,
    `THE QUESTION\n\n${input.question.trim()}`,
    note,
    thought,
    summary,
    `Answer through the ${TOOL_NAME} tool.`,
  ].join('\n\n');
}

/** Maya's reply to the thread so far, and the new summary. Never throws. */
export async function replyInThread(
  input: MayaReplyInput & {
    anthropicApiKey?: string;
    client?: Pick<Anthropic, 'messages'>;
    onSpend?: SpendSink;
  },
): Promise<MayaReply> {
  const messages = replyMessages(input.turns);
  if (messages.length === 0 || messages[messages.length - 1].role !== 'user') {
    return { ok: false, detail: 'There is nothing of yours to reply to.' };
  }
  if (!input.client && !input.anthropicApiKey) {
    return { ok: false, detail: 'ANTHROPIC_API_KEY is not set.' };
  }

  const client = input.client ?? new Anthropic({ apiKey: input.anthropicApiKey });
  let response;
  try {
    response = await client.messages.create({
      model: MAYA_REPLY_MODEL,
      max_tokens: 2000,
      system: replySystem(input),
      tools: [
        {
          name: TOOL_NAME,
          description: 'Give your reply, and where they have now got to.',
          input_schema: {
            type: 'object',
            properties: {
              reply: { type: 'string', description: 'Your reply, in plain prose.' },
              summary: {
                type: 'string',
                description: 'Where they have now got to on the question, in two to four sentences.',
              },
            },
            required: ['reply', 'summary'],
          },
        },
      ],
      tool_choice: forceTool(TOOL_NAME),
      messages,
    });
  } catch (error) {
    return { ok: false, detail: error instanceof Error ? error.message : 'The reply failed.' };
  }

  input.onSpend?.({ model: MAYA_REPLY_MODEL, usage: usageFrom(response.usage) });

  const block = response.content.find((c) => c.type === 'tool_use' && c.name === TOOL_NAME);
  if (!block || block.type !== 'tool_use') return { ok: false, detail: whyNoReport(response) };

  const parsed = answerSchema.safeParse(block.input);
  const reply = parsed.success ? parsed.data.reply.trim() : '';
  if (!reply) return { ok: false, detail: 'The reply came back empty.' };
  const summary = parsed.success ? parsed.data.summary.trim() : '';
  return {
    ok: true,
    reply: reply.slice(0, MAX_TURN),
    // An empty summary keeps the one there was.
    summary: clip(summary || input.summary?.trim() || '', MAYA_SUMMARY_MAX),
  };
}

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}
