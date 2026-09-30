import 'server-only';

import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { usageFrom, type SpendSink } from '@/lib/core/spend/pricing';
import { forceTool } from '@/lib/learn/graph/tool-call';
import { factsPrompt, type BriefFact } from './facts';
import { PICKS_MAX, shortlistPrompt, type Shortlisted } from './picks';

/**
 * The model call behind the morning brief (plan #1123). Haiku is given the
 * day's facts under their headings (factsPrompt) and returns three or four
 * sentences through a forced tool. It adds nothing: every name, time and
 * count in the brief is one it was given. checkBrief reads what comes back
 * before it is stored.
 */

export const BRIEF_MODEL = 'claude-haiku-4-5';
const TOOL_NAME = 'write_brief';

const SYSTEM = `You are Dash, the assistant in a personal app. Each morning
you write the person a short account of their day from the facts below,
which the app gathered from their own agenda, goals, newsletters and
learning.

Rules:
- Three or four sentences, addressed to the person as "you". Plain words,
  like a note from someone who read their diary.
- Lead with what has a time today, with its time. Then what is overdue or due
  today, then what closes this week and the step their goals wait on. The news
  story and the Learn question go last, in one sentence between them, or are
  left out when the day is full.
- Use only the facts given. Keep every name, time and day exactly as written.
  Never invent a detail, a reason or advice.
- Where a heading lists many things, name the first one or two and give the
  count of the rest.
- No greeting, no sign-off, no headings, no lists, no em dashes, no
  exclamation marks.`;

const Reply = z.object({ brief: z.string().min(1) });

export type BriefModelOptions = {
  apiKey: string;
  /** Overridable for tests. */
  client?: Pick<Anthropic, 'messages'>;
  /** What the call cost; recorded as core 'write-day-brief'. */
  onSpend?: SpendSink;
};

/**
 * The brief as the model wrote it, unchecked, or null when it returned
 * nothing usable. Throws when the call itself fails; the caller falls back
 * to the plain brief.
 */
export async function writeBrief(
  day: string,
  facts: readonly BriefFact[],
  options: BriefModelOptions,
): Promise<string | null> {
  const client = options.client ?? new Anthropic({ apiKey: options.apiKey });

  const response = await client.messages.create({
    model: BRIEF_MODEL,
    max_tokens: 600,
    system: SYSTEM,
    tools: [
      {
        name: TOOL_NAME,
        description: "Give today's brief: three or four sentences.",
        input_schema: {
          type: 'object',
          properties: { brief: { type: 'string' } },
          required: ['brief'],
        },
      },
    ],
    tool_choice: forceTool(TOOL_NAME),
    messages: [{ role: 'user', content: factsPrompt(day, facts) }],
  });
  options.onSpend?.({ model: BRIEF_MODEL, usage: usageFrom(response.usage) });

  const block = response.content.find((part) => part.type === 'tool_use' && part.name === TOOL_NAME);
  if (!block || block.type !== 'tool_use') return null;
  const parsed = Reply.safeParse(block.input);
  return parsed.success ? parsed.data.brief : null;
}

const PICK_TOOL = 'choose_picks';

const PICK_SYSTEM = `You are Dash, the assistant in a personal app. Each morning
the app puts a shortlist of things in front of you, gathered from the person's
own jobs, bills, email, goals and your own finished work, each with why it
might matter today. Choose the one to three that matter most to them today.

Rules:
- Prefer what cannot be moved today (an interview, a deadline, a bill due)
  and what someone is waiting on the person for, over what can wait a day.
- Choose fewer when only one or two really matter. Never more than three.
- Answer with the keys exactly as given, the most important first.`;

const PickReply = z.object({ keys: z.array(z.string()) });

/**
 * The keys Dash chose from the shortlist (plan #1239), unchecked, or null
 * when it returned nothing usable. Throws when the call itself fails; the
 * caller falls back to the shortlist's first three (picks.ts, fallbackPicks).
 */
export async function choosePicks(
  day: string,
  list: readonly Shortlisted[],
  options: BriefModelOptions,
): Promise<string[] | null> {
  const client = options.client ?? new Anthropic({ apiKey: options.apiKey });

  const response = await client.messages.create({
    model: BRIEF_MODEL,
    max_tokens: 300,
    system: PICK_SYSTEM,
    tools: [
      {
        name: PICK_TOOL,
        description: `Give the keys of the one to ${PICKS_MAX} things that matter most today, the most important first.`,
        input_schema: {
          type: 'object',
          properties: { keys: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: PICKS_MAX } },
          required: ['keys'],
        },
      },
    ],
    tool_choice: forceTool(PICK_TOOL),
    messages: [{ role: 'user', content: shortlistPrompt(day, list) }],
  });
  options.onSpend?.({ model: BRIEF_MODEL, usage: usageFrom(response.usage) });

  const block = response.content.find((part) => part.type === 'tool_use' && part.name === PICK_TOOL);
  if (!block || block.type !== 'tool_use') return null;
  const parsed = PickReply.safeParse(block.input);
  return parsed.success ? parsed.data.keys : null;
}
