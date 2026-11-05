import { BODY_MAX, clip, TITLE_MAX } from '@/lib/day-brief/notification';
import type { PushPayload } from '@/lib/push/send';
import { MENTOR_REPLY_FAILED } from '@/lib/you/chat-threads-model';

/**
 * The notification for a mentor's reply the person was not there to read
 * (plan #2854.4). Pure: it takes the chat's row and the reply's newest
 * message as read a few seconds after the reply was written, and returns the
 * payload, or null when nothing needs saying.
 *
 * - A reply that failed is said, so the person comes back to Try again.
 * - A reply still unread was written while the thread was not open: an open
 *   thread reads a reply as it arrives. One already read needs no notice.
 */
export function mentorReplyPayload(
  mentor: { key: string; name: string },
  chat: Record<string, unknown> | null,
  newest: Record<string, unknown> | null,
): PushPayload | null {
  const url = `/chat/people/${mentor.key}`;
  const tag = `mentor-${mentor.key}`;
  if (chat?.reply_status === 'failed') {
    const why = typeof chat.reply_error === 'string' && chat.reply_error.trim() ? chat.reply_error.trim() : MENTOR_REPLY_FAILED;
    return { title: clip(`${mentor.name} could not reply`, TITLE_MAX), body: clip(why, BODY_MAX), url, tag };
  }
  if (!newest || typeof newest.text !== 'string' || typeof newest.created_at !== 'string') return null;
  if (newest.read_at) return null;
  const lastRead = typeof chat?.last_read_at === 'string' ? Date.parse(chat.last_read_at) : NaN;
  if (Number.isFinite(lastRead) && lastRead >= Date.parse(newest.created_at)) return null;
  return {
    title: clip(`${mentor.name} replied`, TITLE_MAX),
    body: clip(newest.text.replace(/\s+/g, ' ').trim(), BODY_MAX),
    url,
    tag,
  };
}
