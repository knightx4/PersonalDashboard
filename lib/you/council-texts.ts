import { isTimeZone, zoneParts } from '@/lib/core/when';
import { BODY_MAX, clip, TITLE_MAX } from '@/lib/day-brief/notification';
import type { PushPayload } from '@/lib/push/send';

/**
 * Mentors text you first (plan #2748.7). The Council's daily notes arrive as
 * texts in each mentor's thread: you.advisor_messages rows with
 * role = 'advisor' and kind = 'text_first' (you 0038). This module holds the
 * rules they follow, kept pure so the tests fix the clock:
 *
 *   - Quiet hours. Nothing is texted or announced from 22:00 to 08:00 in the
 *     person's time zone. you.quiet_hours (you 0039) holds the same hours,
 *     and its trigger refuses a text written inside them.
 *   - Unread. A text is unread while its read_at is null and it is newer
 *     than its thread's last_read_at. The caps (one unread per mentor, six
 *     in all, three a day) count texts this way, in the trigger and in
 *     decideAdviceRun.
 *   - The notification. One per text: the mentor's name, and the text's
 *     first line.
 */

export const QUIET_FROM_HOUR = 22;
export const QUIET_UNTIL_HOUR = 8;

/** Where a text's notification opens: the People tab of Chat (plan #2748.1). */
export const CHAT_URL = '/chat';

/** The hour, 0 to 23, at `at` in `timeZone`; UTC when the zone is not one the runtime knows. */
export function localHour(at: Date, timeZone: string): number {
  return zoneParts(at, timeZone && isTimeZone(timeZone) ? timeZone : 'UTC').hour;
}

/** True from 22:00 to 08:00 in the person's zone, when no mentor texts them. */
export function isQuietHours(at: Date, timeZone: string): boolean {
  const hour = localHour(at, timeZone);
  return hour >= QUIET_FROM_HOUR || hour < QUIET_UNTIL_HOUR;
}

export type TextThread = { id: string; advisorId: string; lastReadAt: string | null };
export type TextRow = { chatId: string; createdAt: string; readAt: string | null };

/** The unread texts, each with the mentor who sent it. Texts in a thread not listed are skipped. */
export function unreadTextsOf(
  threads: readonly TextThread[],
  texts: readonly TextRow[],
): { advisorId: string; createdAt: string }[] {
  const byId = new Map(threads.map((t) => [t.id, t]));
  const out: { advisorId: string; createdAt: string }[] = [];
  for (const text of texts) {
    const thread = byId.get(text.chatId);
    if (!thread || text.readAt) continue;
    if (thread.lastReadAt && Date.parse(text.createdAt) <= Date.parse(thread.lastReadAt)) continue;
    out.push({ advisorId: thread.advisorId, createdAt: text.createdAt });
  }
  return out;
}

/** The first non-empty line of a text, with its spaces collapsed. */
export function firstLine(text: string): string {
  const line = text.split(/\r?\n/).find((l) => l.trim() !== '') ?? '';
  return line.replace(/\s+/g, ' ').trim();
}

/** A text as a phone notification: the mentor's name over its first line. */
export function textPayload(input: { messageId: string; mentorName: string; text: string }): PushPayload {
  return {
    title: clip(input.mentorName.trim() || 'Your council', TITLE_MAX),
    body: clip(firstLine(input.text) || 'Sent you a text.', BODY_MAX),
    url: CHAT_URL,
    tag: `council-text-${input.messageId}`,
  };
}
