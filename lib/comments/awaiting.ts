/**
 * Whether Dash still owes this thread an answer.
 *
 * The thread already drew a "Reading the row and replying…" line, but it was
 * tied to the server action being in flight -- so it was up for the second the
 * write took and gone long before the session it started had read anything.
 * Reload the page and it had never happened. What you were left with was your
 * own comment sitting at the bottom of a thread with no sign that anything was
 * coming, which is the half of a chat that tells you the other end heard you.
 *
 * So it is read off the thread instead, which is durable: the last turn is
 * yours, and it is one Dash answers. That survives a reload, and it is right
 * on a page you open ten minutes later without having written anything.
 *
 * `REPLY_EXPECTED_MINUTES` is what stops it lying forever. A question tagged
 * on Tuesday that nothing ever answered is not a reply on its way, and a line
 * that says it is would be worth less than no line at all (law 2). The number
 * is the two hours `run-end.ts` already calls a run gone after, because it is
 * the same question from the other side: past that, whatever was going to
 * answer is not coming.
 */
import { mentionsDash } from './mention';
import type { CommentAuthor, CommentTarget } from './load';

/** How long a thread goes on expecting an answer before it stops saying so. */
export const REPLY_EXPECTED_MINUTES = 120;

type Turn = { author: CommentAuthor; body: string; createdAt: string };

export function awaitingDash(
  thread: readonly Turn[],
  /** A dev row's target, or 'goal' for a goal or step (plan #957). */
  target: CommentTarget | 'goal',
  now: number,
): boolean {
  const last = thread[thread.length - 1];
  // Dash having already replied is the whole of the answer: its turn is the
  // last one, so nothing is outstanding.
  if (!last || last.author !== 'me') return false;

  // A raise is a question put to you, so anything written on one reaches Dash
  // whether or not it carries the tag -- #541. Everywhere else the tag is what
  // does it, and an untagged note is one nobody is going to answer.
  if (target !== 'raise' && !mentionsDash(last.body)) return false;

  // 0 is the clock's pre-mount value. Nothing is claimed at that instant --
  // the opposite of the rule the run readings follow, and deliberately: this
  // draws a line rather than ages one out, so starting from "true" would flash
  // "replying…" onto every old thread on the page for the tick before the
  // clock arrives.
  if (now === 0) return false;

  return (now - new Date(last.createdAt).getTime()) / 60_000 < REPLY_EXPECTED_MINUTES;
}
