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
 */
export const ACTIONS = ['file_idea'] as const;
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
  /** What the action writes: the text of an idea, for now. */
  text: z.string().trim().nullable().optional().default(null),
  /** Which workspace it belongs to, when the action takes one. */
  module: z.string().trim().nullable().optional().default(null),
});

export type DashAction = z.infer<typeof actionSchema>;

export const replySchema = z.object({
  answer: z.string().trim().nullable().optional().default(null),
  needs_repo: z.boolean().optional().default(false),
  why: z.string().trim().nullable().optional().default(null),
  action: actionSchema.nullable().optional().default(null),
});

export type DashReply =
  /** Answered from what the row already said. */
  | { kind: 'answer'; body: string }
  /** Cannot be answered without reading the code. `why` says what it would read. */
  | { kind: 'needs_repo'; why: string }
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

  const { answer, needs_repo: needsRepo, why, action } = parsed.data;

  if (needsRepo) {
    return { kind: 'needs_repo', why: why || 'This one needs a look at the code.' };
  }
  if (action) return { kind: 'action', action };
  if (!answer) return { kind: 'error', error: 'Nothing usable came back.' };

  return { kind: 'answer', body: fit(answer) };
}

/** Trimmed to what the column holds, marked so a cut reply does not read as a finished one. */
function fit(body: string): string {
  return body.length <= MAX_REPLY ? body : `${body.slice(0, MAX_REPLY - 1)}…`;
}
