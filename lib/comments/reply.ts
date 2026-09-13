/**
 * The fast half of a reply: one model call, given the row and nothing else.
 *
 * #339 settled that there are two paths and that the question picks. Most
 * questions asked on a row are about what is written on it — what an option
 * means, what it would cost, why the step is shaped that way — and a session
 * fired to read the repository would answer those ten minutes after you
 * stopped caring. So this runs first, with the row written out and the thread
 * so far, and it decides whether that was enough. When it was not, it says so
 * rather than guessing, and the caller starts the session that can read the
 * code.
 *
 * No repository, no database and no tools beyond the one it reports through.
 * Everything it may use is in the message it is handed.
 */
import 'server-only';

import Anthropic from '@anthropic-ai/sdk';
import { parseReplyPayload, type DashReply } from './reply-payload';

const MODEL = 'claude-haiku-4-5';
const TOOL_NAME = 'reply';

const SYSTEM = `You are answering a question the owner of a personal dashboard
asked on one row of their development pages: a plan step, a question under a
plan feature, an idea, or something a previous session raised with them.

You have been given that row written out, the conversation on it so far, and
the question. You have no access to the repository, the database, or anything
else. Everything you may use is in the message.

Answer from what you were given, in two or three plain sentences. You are
talking to the person who owns the app, so no file paths unless they asked
about one, and no restating the row back at them.

Two things you must not do:

- Do not decide anything. A question asked on a plan decision is a question
  about the options, not an answer to it; explain what the options mean and
  what each would cost, and say which you would pick if they ask, but the
  choice stays theirs.
- Do not guess at what the code currently does. If answering properly means
  reading a file, a table, or the state of the repository, set needs_repo true
  and put in "why" the one sentence that says what would have to be read. A
  session that can read the code takes it from there, so being honest here
  costs the person a few minutes and nothing else.`;

export type ReplyOptions = {
  apiKey: string;
  /** Overridable for tests. */
  client?: Anthropic;
};

/** Ask, and get back an answer, a hand-off to a session, or why neither happened. */
export async function replyToComment(options: ReplyOptions, message: string): Promise<DashReply> {
  const client = options.client ?? new Anthropic({ apiKey: options.apiKey });

  let response;
  try {
    response = await client.messages.create({
      model: MODEL,
      max_tokens: 1024,
      system: SYSTEM,
      tools: [
        {
          name: TOOL_NAME,
          description: 'Answer the question, or say it needs the repository.',
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
      tool_choice: { type: 'tool', name: TOOL_NAME },
      messages: [{ role: 'user', content: message }],
    });
  } catch (error) {
    if (error instanceof Anthropic.RateLimitError) {
      return { kind: 'error', error: 'Replies are rate-limited right now.' };
    }
    if (error instanceof Anthropic.APIError) {
      return { kind: 'error', error: `The reply failed (${error.status}).` };
    }
    return { kind: 'error', error: error instanceof Error ? error.message : 'The reply failed.' };
  }

  const reported = response.content.find(
    (block) => block.type === 'tool_use' && block.name === TOOL_NAME,
  );
  if (!reported || reported.type !== 'tool_use') {
    return { kind: 'error', error: 'Nothing came back.' };
  }

  return parseReplyPayload(reported.input);
}
