import { BODY_MAX, clip, TITLE_MAX } from '@/lib/day-brief/notification';
import type { PushPayload } from '@/lib/push/send';

/**
 * Where the reply to an Ask Dash chat's last question stands (plan #2854.4),
 * from the columns migration 0296 adds to core.conversations.
 *
 * The answer runs on the server whether or not the page that asked is still
 * open (app/api/ask/route.ts). The chat keeps `reply_state` while it does, so
 * a thread opened later can say Dash is still writing, or that the reply
 * failed and offer Try again, instead of showing a question with nothing
 * under it.
 *
 * Pure, so the rules are tested without a database; the reads and writes are
 * in lib/talk/reply-state-store.ts.
 */

export type ReplyState = { state: 'answering'; startedAt: string } | { state: 'failed'; error: string } | null;

/**
 * How long a reply may say it is being written before it is read as failed.
 * The route's maxDuration is 300 seconds; a function past it was ended by
 * the platform without writing anything, so the chat would otherwise say
 * "answering" for ever.
 */
export const REPLY_LOST_AFTER_MS = 330_000;

/** Said when a reply died with its function, which leaves nothing else to say. */
export const REPLY_LOST = 'Dash stopped before the answer was written.';

/** Said when a failed reply kept no reason. */
export const REPLY_FAILED = 'Dash could not answer this.';

export type ReplyRow = {
  reply_state?: string | null;
  reply_started_at?: string | null;
  reply_error?: string | null;
};

/**
 * The reply as the thread should show it. `lastRole` is who wrote the chat's
 * last turn: once Dash has, there is nothing waiting, whatever the row says
 * (an answer kept and the mark not yet cleared).
 */
export function replyStateOf(row: ReplyRow | null | undefined, lastRole: 'user' | 'assistant' | null, now: number): ReplyState {
  if (!row || lastRole !== 'user') return null;
  if (row.reply_state === 'failed') return { state: 'failed', error: row.reply_error?.trim() || REPLY_FAILED };
  if (row.reply_state !== 'answering') return null;
  const started = row.reply_started_at ? Date.parse(row.reply_started_at) : NaN;
  if (!Number.isFinite(started) || now - started > REPLY_LOST_AFTER_MS) return { state: 'failed', error: REPLY_LOST };
  return { state: 'answering', startedAt: row.reply_started_at as string };
}

/** Whether Stop was pressed on the reply started at `startedAt`. */
export function stopPressed(row: { reply_stop_at?: string | null } | null | undefined, startedAt: string): boolean {
  const stop = row?.reply_stop_at ? Date.parse(row.reply_stop_at) : NaN;
  return Number.isFinite(stop) && stop >= Date.parse(startedAt);
}

/** Where a notification about a chat opens: the chat on the Dash tab. */
export function askChatUrl(ref: string): string {
  return `/chat/dash/${ref}`;
}

/**
 * The notification for a reply that landed, or failed, while the page that
 * asked had gone. One per chat on the lock screen: a newer one replaces it.
 */
export function askReplyPayload(
  ref: string,
  outcome: { answer: string } | { error: string },
): PushPayload {
  const failed = 'error' in outcome;
  const body = failed ? outcome.error : plainLine(outcome.answer);
  return {
    title: clip(failed ? 'Dash could not answer' : 'Dash answered', TITLE_MAX),
    body: clip(body || 'Open the chat to read it.', BODY_MAX),
    url: askChatUrl(ref),
    tag: `ask-${ref}`,
  };
}

/** An answer's opening as one line of plain words, for a lock screen. */
function plainLine(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_`#>|]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
