/**
 * What comes back from the fast reply, and what it is allowed to be.
 *
 * Kept clear of server-only imports so the parsing rules can be tested
 * directly, the same split as lib/jobs/enrich/ai-company-payload.ts.
 *
 * There are two answers and they are not the same shape. Either the question
 * can be answered from the row it was asked on, or it cannot and a session
 * that can read the repository has to take it — #339 settled that both paths
 * exist and that the question decides which one runs. So the payload says
 * which of the two it is, and `why` is what the person is told while the
 * slower path runs.
 */
import { z } from 'zod';

/** The column takes 4000 characters, so a longer reply would be refused outright. */
export const MAX_REPLY = 4000;

export const replySchema = z.object({
  answer: z.string().trim().nullable().optional().default(null),
  needs_repo: z.boolean().optional().default(false),
  why: z.string().trim().nullable().optional().default(null),
});

export type DashReply =
  /** Answered from what the row already said. */
  | { kind: 'answer'; body: string }
  /** Cannot be answered without reading the code. `why` says what it would read. */
  | { kind: 'needs_repo'; why: string }
  /** Nothing usable came back. */
  | { kind: 'error'; error: string };

/**
 * A reported payload as one of the three outcomes.
 *
 * `needs_repo` wins over an answer that came with it: a reply that says it
 * cannot answer and then answers anyway is guessing, and a guess written into
 * the thread reads exactly like something that was checked.
 */
export function parseReplyPayload(raw: unknown): DashReply {
  const parsed = replySchema.safeParse(raw);
  if (!parsed.success) return { kind: 'error', error: 'The reply came back in an unexpected shape.' };

  const { answer, needs_repo: needsRepo, why } = parsed.data;

  if (needsRepo) {
    return { kind: 'needs_repo', why: why || 'This one needs a look at the code.' };
  }
  if (!answer) return { kind: 'error', error: 'Nothing usable came back.' };

  return { kind: 'answer', body: fit(answer) };
}

/** Trimmed to what the column holds, marked so a cut reply does not read as a finished one. */
function fit(body: string): string {
  return body.length <= MAX_REPLY ? body : `${body.slice(0, MAX_REPLY - 1)}…`;
}
