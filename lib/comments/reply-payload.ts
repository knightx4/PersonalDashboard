/**
 * What comes back from the fast reply, and what it is allowed to be.
 *
 * Kept clear of server-only imports so the parsing rules can be tested
 * directly, the same split as lib/jobs/enrich/ai-company-payload.ts.
 *
 * Three shapes, not one. A comment is either a question that can be answered
 * from the row it was asked on, a question that cannot be — #339 settled that
 * both paths exist and that the question decides which one runs — or an
 * instruction to do something, which #359 settled is carried out and then
 * reported in the thread rather than offered back for a second press.
 */
import { z } from 'zod';

/** The column takes 4000 characters, so a longer reply would be refused outright. */
export const MAX_REPLY = 4000;

/**
 * What an instruction in a comment may ask for.
 *
 * A fixed list, and the reason it is a list rather than a judgement is that
 * the moves it leaves out are the ones that are the person's: approving a
 * proposal, answering a question, starting or assigning a step, dismissing or
 * deleting anything. A name outside this list is refused by lib/comments/act.ts
 * with a sentence saying so, so a model inventing one changes nothing.
 *
 * `file_note` and `add_step` are here because the list used to cover ideas and
 * nothing else: "write this up as a bug" and "add a step under this" both fell
 * through to a session that read the whole repository to make one row. Writing
 * a row is not a thing that needs the code read, and a capability that takes
 * ten minutes to reach is one the person stops asking for.
 */
export const ACTIONS = ['file_idea', 'file_note', 'add_step', 'reword', 'send_step'] as const;
export type ActionName = (typeof ACTIONS)[number];

/**
 * One thing to do, and its arguments.
 *
 * The name is read as a plain string rather than as an enum so that an
 * instruction outside the list survives parsing and can be refused in words.
 * A schema that threw it out would leave the person with a comment that did
 * nothing and said nothing about why.
 */
export const actionSchema = z.object({
  name: z.string().trim().min(1),
  /** What the action writes: the text of an idea, or a row's new wording. */
  text: z.string().trim().nullable().optional().default(null),
  /** Which workspace it belongs to, when the action takes one. */
  module: z.string().trim().nullable().optional().default(null),
  /**
   * Which part of a row is being rewritten: its title, its detail or its
   * done-when. Read as a plain string for the same reason as the name, and
   * anything not on lib/comments/act.ts's own list is refused there — which is
   * what keeps a status, an assignee and a decision's answer out of reach.
   */
  field: z.string().trim().nullable().optional().default(null),
  /** The paragraph under a new step, when the instruction carried one. */
  detail: z.string().trim().nullable().optional().default(null),
  /**
   * Which kind of row to file: a bug or a feature request. Read as a plain
   * string, and anything that is not 'feature' is filed as a bug — see
   * lib/comments/act.ts, where a note filed under the wrong heading is a
   * dropdown away from right and a note never filed is lost.
   */
  kind: z.string().trim().nullable().optional().default(null),
});

export type DashAction = z.infer<typeof actionSchema>;

export const replySchema = z.object({
  answer: z.string().trim().nullable().optional().default(null),
  needs_repo: z.boolean().optional().default(false),
  why: z.string().trim().nullable().optional().default(null),
  action: actionSchema.nullable().optional().default(null),
  /**
   * Whether the comment told it to do something rather than asked it
   * something. Only read when the reply hands over to a session: what that
   * session may do about the row depends on which of the two it was given.
   */
  instruction: z.boolean().optional().default(false),
});

export type DashReply =
  /** Answered from what the row already said. */
  | { kind: 'answer'; body: string }
  /**
   * Cannot be done without reading the code. `why` says what it would read,
   * and `instruction` says whether the session it hands to was told to do
   * something or asked something.
   */
  | { kind: 'needs_repo'; why: string; instruction: boolean }
  /** An instruction to carry out. What it changed is written into the thread. */
  | { kind: 'action'; action: DashAction }
  /** Nothing usable came back. */
  | { kind: 'error'; error: string };

/**
 * A reported payload as one of the four outcomes.
 *
 * `needs_repo` wins over everything that came with it: a reply that says it
 * cannot answer and then answers anyway is guessing, and a guess written into
 * the thread reads exactly like something that was checked. The same holds for
 * an action reported beside it — one that needs the code read is one the
 * session started for it should carry out, not this call.
 *
 * An action wins over an answer, because an instruction that was also
 * explained back is still an instruction, and #359 settled that it gets done.
 */
export function parseReplyPayload(raw: unknown): DashReply {
  const parsed = replySchema.safeParse(raw);
  if (!parsed.success) return { kind: 'error', error: 'The reply came back in an unexpected shape.' };

  const { answer, needs_repo: needsRepo, why, action, instruction } = parsed.data;

  if (needsRepo) {
    return {
      kind: 'needs_repo',
      why: why || 'This one needs a look at the code.',
      // An action reported beside it is an instruction whatever the flag says:
      // it named a thing to do, and this call is only declining to be the one
      // that does it.
      instruction: instruction || action !== null,
    };
  }
  if (action) return { kind: 'action', action };
  if (!answer) return { kind: 'error', error: 'Nothing usable came back.' };

  return { kind: 'answer', body: fit(answer) };
}

/** Trimmed to what the column holds, marked so a cut reply does not read as a finished one. */
function fit(body: string): string {
  return body.length <= MAX_REPLY ? body : `${body.slice(0, MAX_REPLY - 1)}…`;
}
