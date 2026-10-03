import 'server-only';

import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { usageFrom, type SpendSink } from '@/lib/core/spend/pricing';
import { forceTool } from '@/lib/learn/graph/tool-call';
import { BODY_MAX, picksPrompt, TITLE_MAX } from './notification';
import { PICKS_MAX, shortlistPrompt, type DayBriefPick, type Shortlisted } from './picks';
import { MODELS } from '@/lib/core/models';

/**
 * The model calls behind the morning brief. choosePicks (plan #1239) has
 * Haiku choose one to three things from the rules' shortlist; writeBrief
 * (plan #1240) has it write the notification from those picks and their
 * reasons, through forced tools. It adds nothing: every name, time and
 * figure in the notification is one it was given. checkNotification
 * (notification.ts) reads what comes back before it is stored.
 */

export const BRIEF_MODEL = MODELS.dayBrief;
const TOOL_NAME = 'write_notification';

const SYSTEM = `You are Dash, the assistant in a personal app. Each morning
you write the person's phone notification from the one to three things the
app picked as mattering today, each with the reason it matters.

Rules:
- The title names the first pick, at most ${TITLE_MAX} characters. A name, not a
  sentence: no full stop.
- The body says why the first pick matters and names each other pick with
  its reason, at most ${BODY_MAX} characters in all. It is read on a lock screen,
  so every word earns its place.
- Mention only the picks. Keep every name, time, amount and count exactly as
  given, and never invent a detail, a reason or advice.
- Address the person as "you" where you need to. No greeting, no sign-off,
  no lists, no em dashes, no exclamation marks.`;

const Reply = z.object({ title: z.string().min(1), body: z.string().min(1) });

export type BriefModelOptions = {
  apiKey: string;
  /** Overridable for tests. */
  client?: Pick<Anthropic, 'messages'>;
  /** What the call cost; recorded as core 'write-day-brief'. */
  onSpend?: SpendSink;
};

/**
 * The notification as the model wrote it, unchecked, or null when it
 * returned nothing usable. Throws when the call itself fails; the caller
 * falls back to the plain notification (notification.ts, plainNotification).
 */
export async function writeBrief(
  day: string,
  picks: readonly DayBriefPick[],
  options: BriefModelOptions,
): Promise<{ title: string; body: string } | null> {
  const client = options.client ?? new Anthropic({ apiKey: options.apiKey });

  const response = await client.messages.create({
    model: BRIEF_MODEL,
    max_tokens: 400,
    system: SYSTEM,
    tools: [
      {
        name: TOOL_NAME,
        description: `Give today's notification: a title of at most ${TITLE_MAX} characters naming the first pick, and a body of at most ${BODY_MAX}.`,
        input_schema: {
          type: 'object',
          properties: {
            title: { type: 'string', maxLength: TITLE_MAX },
            body: { type: 'string', maxLength: BODY_MAX },
          },
          required: ['title', 'body'],
        },
      },
    ],
    tool_choice: forceTool(TOOL_NAME),
    messages: [{ role: 'user', content: picksPrompt(day, picks) }],
  });
  options.onSpend?.({ model: BRIEF_MODEL, usage: usageFrom(response.usage) });

  const block = response.content.find((part) => part.type === 'tool_use' && part.name === TOOL_NAME);
  if (!block || block.type !== 'tool_use') return null;
  const parsed = Reply.safeParse(block.input);
  return parsed.success ? parsed.data : null;
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
