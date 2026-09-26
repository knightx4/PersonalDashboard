import 'server-only';

import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { usageFrom, type SpendSink } from '@/lib/core/spend/pricing';
import { forceTool, whyNoReport } from '@/lib/learn/graph/tool-call';
import { MAX_TURN, toModelMessages, type SubjectKind, type TalkTurn } from './talk';

/**
 * Dash's reply in a conversation about something you are reading (plan
 * #1053). One call, not streamed, like every other model call in the app.
 *
 * Sonnet rather than Haiku: these replies teach, where Haiku is used here for
 * marking. The caller records the spend under its own module's operation,
 * `reply-about-card` for a Learn card, through the `onSpend` sink.
 */

export const TALK_MODEL = 'claude-sonnet-5';
const TOOL_NAME = 'reply';

/** How much of the subject's text goes in the prompt. A card's section is well under this. */
export const MAX_MATERIAL = 12_000;

const SUBJECT_NAME: Record<SubjectKind, string> = {
  feed_card: 'a card from their reading feed',
  news_story: 'a newsletter story',
};

const SYSTEM = `You are Dash, talking with somebody about something they are reading. The
material is below. They are asking about it, or answering something you asked.

ANSWER FROM THE MATERIAL FIRST. Use what it says, in its terms, and point to
the part of it that answers the question. Where the answer needs more than the
material holds, give it from what you know and say that it goes beyond the
material.

TEACH, DO NOT RECITE. Explain the mechanism or the reason, with a concrete
example when one helps. Keep to what they asked.

BE SHORT. A few sentences, or two or three short paragraphs at most. Plain
prose: no headings, no bullet lists unless they asked for a list, no
preamble, no offer to say more.

IF THE MATERIAL IS WRONG OR OUT OF DATE, say so plainly.`;

const replySchema = z.object({ reply: z.string() });

export type TalkReply = { ok: true; reply: string } | { ok: false; detail: string };

/** Dash's reply to the turns so far. Never throws. */
export async function replyAbout(input: {
  subject: { kind: SubjectKind; title: string; material: string };
  /** The conversation so far, oldest first, ending with the person's turn. */
  turns: readonly Pick<TalkTurn, 'role' | 'body'>[];
  /** Instructions for this kind of exchange, added to the system prompt. */
  guidance?: string;
  anthropicApiKey: string;
  client?: Anthropic;
  onSpend?: SpendSink;
}): Promise<TalkReply> {
  const messages = toModelMessages(input.turns);
  if (messages.length === 0 || messages[messages.length - 1].role !== 'user') {
    return { ok: false, detail: 'There is nothing of yours to reply to.' };
  }

  const material = input.subject.material.trim().slice(0, MAX_MATERIAL);
  const system = [
    SYSTEM,
    ...(input.guidance?.trim() ? [input.guidance.trim()] : []),
    `THE MATERIAL, ${SUBJECT_NAME[input.subject.kind]}:\n\nTitle: ${input.subject.title.trim()}\n\n${material}`,
    `Reply through the ${TOOL_NAME} tool.`,
  ].join('\n\n');

  const client = input.client ?? new Anthropic({ apiKey: input.anthropicApiKey });
  let response;
  try {
    response = await client.messages.create({
      model: TALK_MODEL,
      max_tokens: 1500,
      system,
      tools: [
        {
          name: TOOL_NAME,
          description: 'Give your reply to the person.',
          input_schema: {
            type: 'object',
            properties: { reply: { type: 'string', description: 'The reply, in plain prose.' } },
            required: ['reply'],
          },
        },
      ],
      tool_choice: forceTool(TOOL_NAME),
      messages,
    });
  } catch (error) {
    return { ok: false, detail: error instanceof Error ? error.message : 'The reply failed.' };
  }

  input.onSpend?.({ model: TALK_MODEL, usage: usageFrom(response.usage) });

  const block = response.content.find((c) => c.type === 'tool_use' && c.name === TOOL_NAME);
  if (!block || block.type !== 'tool_use') return { ok: false, detail: whyNoReport(response) };

  const parsed = replySchema.safeParse(block.input);
  const reply = parsed.success ? parsed.data.reply.trim() : '';
  if (!reply) return { ok: false, detail: 'The reply came back empty.' };
  return { ok: true, reply: reply.slice(0, MAX_TURN) };
}
