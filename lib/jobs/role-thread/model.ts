/**
 * The model call behind Dash's reply on a role's comment thread (note
 * 89ad8bef): the role, the thread and the comment in, an answer and, when
 * asked for, a whole cover letter out, through one forced tool call.
 *
 * Sonnet rather than the Haiku a goal reply uses, because one of the things
 * it is asked for is a letter that goes out under the person's name. What is
 * kept of the answer is decided in reply.ts.
 */
import 'server-only';

import Anthropic from '@anthropic-ai/sdk';
import { usageFrom, type SpendSink } from '@/lib/core/spend/pricing';

export const ROLE_REPLY_MODEL = 'claude-sonnet-5';
const TOOL_NAME = 'reply';

const SYSTEM = `You are Dash, replying to a comment the owner of a job-search
tracker wrote on one of the roles they are pursuing. You are given their
evidence bank (each item with a ref like e1), then the role: its description,
how their record was matched against its requirements, the cover letter on
file if there is one, how they write, the conversation on the role so far,
and the comment.

You have nothing else: no web, no email. Everything you may use is in the
message.

Two things you can do, through the reply tool:

- Answer. A question about the role, the company, their fit, what to say or
  what to do next is answered in "answer", in two to five plain sentences, as
  you would say it to them on their phone. Do not restate the role back to
  them.
- Write the cover letter. When the comment asks for a cover letter, or asks
  to change the one on file ("make it shorter", "lead with the migration
  work"), put the whole letter in "cover_letter": the full text they would
  send, not a diff and not an outline. It replaces the letter on file, so a
  change to an existing letter keeps everything they did not ask to change.
  List the bank refs it draws on in "evidence_refs", and in
  "unsupported_claims" every factual claim in it that no bank item carries (a
  number, a scale, a title, a result), copied as it appears in the letter.
  Then write one sentence in "answer" saying what you did. Leave
  "cover_letter" empty for anything else.

How the letter is written:

Every claim of substance traces to a bank item. You are arranging their
material for this role, not adding to it. Where the role wants something the
bank does not show, leave it out or name it plainly; never invent it.

Their words, not yours. Reuse the vocabulary and rhythm of the items you
cite, and follow the notes on how they write. A letter that reads better
than they write is one they have to rewrite.

Short: three or four paragraphs, under 350 words unless they ask otherwise.
Open with why this role, from the description, not with who they are. Pick
two or three pieces of evidence that answer the requirements marked must
have. No paragraph about how exciting the opportunity is, no closing
paragraph about enthusiasm, and no sign-off beyond their first name if the
thread gives it.

Write plainly everywhere: no dashes as punctuation, and do not open by
agreeing with them ("You're right").`;

export type RoleReplyOptions = {
  apiKey: string;
  /** Overridable for tests. */
  client?: Anthropic;
  /** What the call cost; recorded as 'reply-to-role-comment'. */
  onSpend?: SpendSink;
};

export type RoleReplyResult = { ok: true; input: unknown } | { ok: false; error: string };

/** Ask; get back the tool input, or why there is none. */
export async function askRoleReplyModel(
  options: RoleReplyOptions,
  input: { bank: string; message: string },
): Promise<RoleReplyResult> {
  const client = options.client ?? new Anthropic({ apiKey: options.apiKey });

  let response;
  try {
    response = await client.messages.create({
      model: ROLE_REPLY_MODEL,
      max_tokens: 4096,
      // The bank is the same on every reply on every role, so it sits behind
      // a cache breakpoint and the role goes last, as in the answer draft.
      system: [
        { type: 'text', text: SYSTEM },
        {
          type: 'text',
          text: input.bank
            ? `The evidence bank:\n\n${input.bank}`
            : 'The evidence bank is empty. There is nothing to cite.',
          cache_control: { type: 'ephemeral' },
        },
      ],
      tools: [
        {
          name: TOOL_NAME,
          description: 'Answer the comment, and write the cover letter when it asks for one.',
          input_schema: {
            type: 'object',
            properties: {
              answer: { type: 'string' },
              cover_letter: {
                type: ['string', 'null'],
                description:
                  'The whole letter, only when the comment asks for one or for a change to it.',
              },
              evidence_refs: { type: ['array', 'null'], items: { type: 'string' } },
              unsupported_claims: { type: ['array', 'null'], items: { type: 'string' } },
            },
            required: ['answer'],
          },
        },
      ],
      tool_choice: { type: 'tool', name: TOOL_NAME },
      messages: [{ role: 'user', content: input.message }],
    });
  } catch (error) {
    if (error instanceof Anthropic.RateLimitError) {
      return { ok: false, error: 'Replies are rate-limited right now.' };
    }
    if (error instanceof Anthropic.APIError) {
      return { ok: false, error: `The reply failed (${error.status}).` };
    }
    return { ok: false, error: error instanceof Error ? error.message : 'The reply failed.' };
  }
  options.onSpend?.({ model: ROLE_REPLY_MODEL, usage: usageFrom(response.usage) });

  const reported = response.content.find(
    (block) => block.type === 'tool_use' && block.name === TOOL_NAME,
  );
  if (!reported || reported.type !== 'tool_use') return { ok: false, error: 'Nothing came back.' };
  return { ok: true, input: reported.input };
}
