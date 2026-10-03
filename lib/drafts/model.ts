import 'server-only';

import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { usageFrom, type SpendSink } from '@/lib/core/spend/pricing';
import { forceTool } from '@/lib/learn/graph/tool-call';
import { draftPrompt, type DraftContext } from './write';
import { MODELS } from '@/lib/core/models';

/**
 * The model call behind a drafted follow-up or return request (plan #1129).
 * Sonnet is given the record and the thread (draftPrompt) and returns a
 * subject and a body through a forced tool. The message goes out over the
 * person's name, so it is held to the facts it was given; checkDraft
 * (lib/drafts/find.ts) reads what comes back before it is stored.
 */

export const DRAFT_MODEL = MODELS.drafts;
const TOOL_NAME = 'write_message';

const SYSTEM = `You write short emails that a person sends from their own
mailbox: a follow-up on a job application that has gone quiet, or a request
to return items from an online order. You write as the person, in the first
person. The app shows them the draft and they send it themselves.

Rules:
- Under 120 words in the body. Plain, polite and direct, like a capable
  person writing their own email. No flattery, no apology for writing.
- One clear ask that can be answered in a line: where the process stands and
  when to expect to hear, or how to send the items back (a label, an address,
  a return number) before the window closes.
- Use only the facts given. Never invent a name, a date, an interview, a
  reason for the return, a detail of the role or anything about the person.
  When a fact is missing, write around it.
- Greet the recipient by first name when one is given, otherwise "Hello,".
  End with "Thanks," or "Thank you," and the person's name when one is
  given.
- The subject names the role and company, or the order number, in a few
  words. When the mail shows a person wrote about it, reuse their subject
  with "Re: " in front.
- No em dashes, no exclamation marks, no placeholders in square brackets.`;

const Reply = z.object({ subject: z.string().min(1), body: z.string().min(1) });

export type DraftModelOptions = {
  apiKey: string;
  /** Overridable for tests. */
  client?: Pick<Anthropic, 'messages'>;
  /** What the call cost; recorded as core 'write-draft'. */
  onSpend?: SpendSink;
};

/**
 * The message as the model wrote it, unchecked, or null when it returned
 * nothing usable. Throws when the call itself fails; the caller stores the
 * plain draft instead.
 */
export async function writeDraft(
  context: DraftContext,
  options: DraftModelOptions,
): Promise<{ subject: string; body: string } | null> {
  const client = options.client ?? new Anthropic({ apiKey: options.apiKey });

  const response = await client.messages.create({
    model: DRAFT_MODEL,
    max_tokens: 800,
    system: SYSTEM,
    tools: [
      {
        name: TOOL_NAME,
        description:
          'Give the email: its subject line and its body, with line breaks between paragraphs.',
        input_schema: {
          type: 'object',
          properties: { subject: { type: 'string' }, body: { type: 'string' } },
          required: ['subject', 'body'],
        },
      },
    ],
    tool_choice: forceTool(TOOL_NAME),
    messages: [{ role: 'user', content: draftPrompt(context) }],
  });
  options.onSpend?.({ model: DRAFT_MODEL, usage: usageFrom(response.usage) });

  const block = response.content.find(
    (part) => part.type === 'tool_use' && part.name === TOOL_NAME,
  );
  if (!block || block.type !== 'tool_use') return null;
  const parsed = Reply.safeParse(block.input);
  return parsed.success ? parsed.data : null;
}
