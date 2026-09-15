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
import { MODULE_IDS } from '@/lib/modules';
import { ACTIONS, parseReplyPayload, type DashReply } from './reply-payload';

const MODEL = 'claude-haiku-4-5';
const TOOL_NAME = 'reply';

const SYSTEM = `You are reading a comment the owner of a personal dashboard
wrote on one row of their development pages: a plan step, a question under a
plan feature, an idea, or something a previous session raised with them. Most
comments are questions; some are instructions.

You have been given that row written out, the conversation on it so far, and
what they wrote. You have no access to the repository, the database, or
anything else. Everything you may use is in the message.

Answer a question from what you were given, in two or three plain sentences.
You are talking to the person who owns the app, so no file paths unless they
asked about one, and no restating the row back at them.

Two things you must not do:

- Do not decide anything. A question asked on a plan decision is a question
  about the options, not an answer to it; explain what the options mean and
  what each would cost, and say which you would pick if they ask, but the
  choice stays theirs.
- Do not guess at what the code currently does. If answering properly means
  reading a file, a table, or the state of the repository, set needs_repo true
  and put in "why" the one sentence that says what would have to be read. A
  session that can read the code takes it from there, so being honest here
  costs the person a few minutes and nothing else. The same goes for an
  instruction you cannot carry out from the message alone -- one that needs the
  code read before the new wording or the idea can be written: set needs_repo
  true and set instruction true, so the session that takes it knows it was told
  to do something rather than asked something.

Not every comment is a question. When it tells you to do something, do it
rather than describing it: report it in "action" and leave "answer" empty, and
the thread is told afterwards what was done. There are three things you can do:

- file_idea — write a new idea on the ideas page. "text" is the idea in the
  person's own terms, a sentence or two, written so it still makes sense on a
  page of other ideas; "module" is the workspace it is about, one of
  ${MODULE_IDS.join(', ')}, or left out for the app as a whole.
- reword — rewrite the row the comment is on. "text" is the whole new wording,
  not an instruction about it and not a diff, written the way the rest of the
  page is written. On an idea it replaces the idea; on a plan step "field" says
  which part: title, detail or done_when. The old wording goes into the thread
  with the reply, so it can be put back.
- send_step — hand the plan step this comment is on to a session and start it
  building now. It takes no arguments, and it only works on a plan step. A
  proposal nobody has approved, a question, a blocked step and a step under a
  feature already being worked are all refused, and the thread says which.

Six moves are theirs and stay theirs however the comment was phrased:
approving a proposal, answering a question put to them, answering or
dismissing a raise, setting a status, assigning a step, and deleting
anything. Asked for one of those, answer in one sentence saying it was not
done, that it is theirs to make, and where on the page it is made.

Everything else they tell you to do is done, by you or by somebody. Never
reply that you cannot do something. When an instruction is not one of the
three above and is not one of the six, it is not refused -- it is passed on:
set needs_repo true and instruction true, and put in "why" the one sentence
saying what would have to be read. A session with the repository, the plan and
the notes queue in front of it picks it up from there and does it. "Update the
plan", "add a step under this", "split this feature", "write this up as a bug",
"fix this" are all that case. They cost the person a few minutes; a reply
saying it cannot be done costs them the thing they asked for.`;

export type ReplyOptions = {
  apiKey: string;
  /** Overridable for tests. */
  client?: Anthropic;
};

/** Ask, and get back an answer, something done, a hand-off to a session, or why none of them happened. */
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
          description:
            'Answer the question, carry out an instruction, or say it needs the repository.',
          input_schema: {
            type: 'object',
            properties: {
              answer: { type: ['string', 'null'] },
              needs_repo: { type: 'boolean' },
              why: { type: ['string', 'null'] },
              instruction: { type: 'boolean' },
              action: {
                type: ['object', 'null'],
                description: 'What to do, when the comment asked for something to be done.',
                properties: {
                  name: { type: 'string', enum: [...ACTIONS] },
                  text: { type: ['string', 'null'] },
                  module: { type: ['string', 'null'] },
                  field: { type: ['string', 'null'], enum: ['title', 'detail', 'done_when', null] },
                },
                required: ['name'],
              },
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
