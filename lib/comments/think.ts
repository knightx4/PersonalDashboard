/**
 * The considered half of a reply: the same row and thread as the fast reply,
 * handed to a stronger model that thinks before it answers.
 *
 * The fast reply in ./reply.ts is Haiku, and two or three sentences from it
 * are right for most questions asked on a row. They are wrong for the ones
 * that ask for a judgement -- is this feasible, what would it cost, which way
 * should it be built -- and for a comment asking outright for a stronger
 * model. Those used to get the same two or three sentences, or a reply
 * explaining that a stronger model was somebody else's decision. The fast
 * reply now says when a question is one of those, and this answers it.
 *
 * Still no repository and no database. A question this cannot answer without
 * reading the code is passed on to a session the same way the fast reply
 * passes one on, so going through here never costs the person that route.
 *
 * Opus at high effort, with thinking on. It costs around ten cents an answer
 * where the fast reply costs a fraction of one, which is why the fast reply
 * picks, and why nothing here runs unless it did.
 */
import 'server-only';

import Anthropic from '@anthropic-ai/sdk';
import { usageFrom, type SpendSink } from '@/lib/core/spend/pricing';
import { parseReplyPayload, type DashReply } from './reply-payload';

export const THINK_MODEL = 'claude-opus-5-5';
const TOOL_NAME = 'reply';

const SYSTEM = `You are Dash, answering a question the owner of a personal
dashboard asked on one row of their development pages: a plan step, an idea,
a bug report or a feature request, a spec section, or something a session
raised with them. A faster model looked at it first and judged that it
deserves careful thought, usually because it asks whether something is worth
doing, what it would cost, or how it should be done, or because they asked for
a closer look.

You have the row written out, the conversation on it so far, and the
question. You have no access to the repository, the database, or the web.

Think it through before you answer. Then answer as someone who has, to the
person who owns the app and will decide:

- Lead with the answer itself, not with a restatement of the question.
- Give your reasoning in concrete terms: the parts that are hard and why, the
  costs with rough numbers when cost was asked about, and the approach you
  would take if it were yours to pick. Say which you would pick; the choice
  stays theirs.
- Where an earlier reply in the thread was thin or wrong, say what it missed
  rather than repeating it.
- Say plainly what you are unsure of and what would settle it.
- A few short paragraphs, under 300 words. Plain prose, no headings, no file
  paths unless they asked about one, and no em dashes.

Do not guess at what the code currently does. If a proper answer turns on
reading a file, a table or the state of the repository, set needs_repo true
and put in "why" the one sentence saying what would have to be read; a
session that can read the code answers instead.

Report through the ${TOOL_NAME} tool: the answer in "answer", or needs_repo and
"why".`;

export type ThinkOptions = {
  apiKey: string;
  /** Overridable for tests. */
  client?: Anthropic;
  /** What the call cost; record it as 'reply-to-comment'. */
  onSpend?: SpendSink;
};

/**
 * Request fields the installed SDK (0.39) predates. They are sent as they are:
 * the client forwards the body it is given.
 *
 * `effort` is set because this model's default is medium, and a question sent
 * here was sent for more thought than that. `fallbacks` re-runs a request the
 * model's safety classifiers decline on another model inside the same call,
 * rather than leaving the question without an answer.
 */
const UNTYPED = {
  output_config: { effort: 'high' },
  fallbacks: 'default',
};
const FALLBACK_BETA = 'server-side-fallback-2026-07-01';

/** Answer with more thought, or say it needs the repository. Never an action. */
export async function thinkAboutComment(options: ThinkOptions, message: string): Promise<DashReply> {
  const client = options.client ?? new Anthropic({ apiKey: options.apiKey });

  let response;
  try {
    response = await client.messages.create(
      {
        model: THINK_MODEL,
        // Thinking is counted against this as well as the answer.
        max_tokens: 16_000,
        system: SYSTEM,
        tools: [
          {
            name: TOOL_NAME,
            description: 'Give the answer, or say it needs the repository.',
            input_schema: {
              type: 'object',
              properties: {
                answer: { type: ['string', 'null'] },
                needs_repo: { type: 'boolean' },
                why: { type: ['string', 'null'] },
              },
              required: ['needs_repo'],
            },
          },
        ],
        // Asked for in the prompt rather than forced: this model rejects a
        // forced tool.
        tool_choice: { type: 'auto' },
        messages: [{ role: 'user', content: message }],
        ...(UNTYPED as object),
      },
      { headers: { 'anthropic-beta': FALLBACK_BETA } },
    );
  } catch (error) {
    if (error instanceof Anthropic.RateLimitError) {
      return { kind: 'error', error: 'The stronger model is rate-limited right now.' };
    }
    if (error instanceof Anthropic.APIError) {
      return { kind: 'error', error: `The stronger model failed (${error.status}).` };
    }
    return { kind: 'error', error: error instanceof Error ? error.message : 'The stronger model failed.' };
  }
  // The model that answered, which is another one when a fallback ran.
  options.onSpend?.({ model: response.model ?? THINK_MODEL, usage: usageFrom(response.usage) });

  return readThought(response);
}

/**
 * The response as an answer, a hand-off, or an error.
 *
 * Only an answer or a hand-off is kept from the report: this call does not
 * carry out instructions, and a question sent here never needs one. A reply
 * written as prose without the tool is still an answer, and is read as one.
 */
export function readThought(
  response: Pick<Anthropic.Message, 'content' | 'stop_reason'>,
): DashReply {
  // Widened: the installed SDK's type predates some reasons.
  const stop: string | null = response.stop_reason;
  if (stop === 'refusal') return { kind: 'error', error: 'The stronger model declined to answer.' };
  if (stop === 'max_tokens') return { kind: 'error', error: 'The stronger model ran out of room.' };

  const reported = response.content.find(
    (block) => block.type === 'tool_use' && block.name === TOOL_NAME,
  );
  if (reported && reported.type === 'tool_use') {
    const reply = parseReplyPayload(reported.input);
    if (reply.kind === 'answer' || reply.kind === 'needs_repo') return reply;
    if (reply.kind === 'error') return reply;
    return { kind: 'error', error: 'The stronger model came back without an answer.' };
  }

  const prose = response.content
    .flatMap((block) => (block.type === 'text' ? [block.text] : []))
    .join('\n\n')
    .trim();
  if (!prose) return { kind: 'error', error: 'Nothing came back from the stronger model.' };
  return parseReplyPayload({ answer: prose });
}
