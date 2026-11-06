import { replyFailedOf, type PersonRow } from '@/lib/you/chat-threads-model';
import type { GroupRow } from '@/lib/you/group-chats-model';

/**
 * What the Messages list does with a Realtime change (the 6 November 2026
 * outage). A bot writing a reply renews its typing lease on the chat row
 * every four seconds, and opening a thread stamps last_read_at. Redrawing
 * the page from the server on each of those rebuilt every open list, and
 * every thread its rows prefetch, about every four seconds for as long as a
 * bot was replying: some 90,000 database requests an hour, until the
 * database stopped answering. Those changes now patch the drawn rows in
 * place; only what the patch cannot show (a new message, a new chat, a group
 * renamed or a bot joining or leaving) redraws from the server.
 */

const str = (value: unknown): string | null => (typeof value === 'string' && value.trim() ? value : null);

/** What Realtime has said about one chat since the list was drawn. */
export type ChatPatch = { typingUntil: string | null; lastReadAt: string | null; replyFailed: string | null };

/** What the list has heard: chat patches by chat id, and group typing by `${chatId}:${advisorId}`. */
export type LivePatches = { chats: Record<string, ChatPatch>; members: Record<string, string | null> };

export const NO_PATCHES: LivePatches = { chats: {}, members: {} };

export type ChangeEvent = { table: string; eventType: string; new: Record<string, unknown> | null | undefined };

export type ChangeOutcome = { kind: 'refresh' } | { kind: 'patch'; patches: LivePatches } | { kind: 'ignore' };

/** Whether `at` is no later than `readAt`; both ISO times, compared as instants. */
function readSince(readAt: string | null, at: string | undefined): boolean {
  if (!readAt || !at) return false;
  const read = Date.parse(readAt);
  const said = Date.parse(at);
  return Number.isFinite(read) && Number.isFinite(said) && read >= said;
}

/** Decide what one change means for the list as drawn. */
export function outcomeOf(
  event: ChangeEvent,
  drawn: { rows: readonly PersonRow[]; groups: readonly GroupRow[] },
  patches: LivePatches,
): ChangeOutcome {
  const next = event.new ?? {};
  if (event.table === 'advisor_messages') return event.eventType === 'INSERT' ? { kind: 'refresh' } : { kind: 'ignore' };

  if (event.table === 'advisor_chats') {
    if (event.eventType !== 'UPDATE') return { kind: 'refresh' };
    const id = str(next.id);
    if (!id) return { kind: 'ignore' };
    const group = drawn.groups.find((g) => g.id === id);
    // A group renamed: the name is drawn from the server.
    if (group && (str(next.title) ?? null) !== group.name) return { kind: 'refresh' };
    // A chat the list does not draw (an older thread with the same bot) changes
    // nothing on it; a message there arrives as an INSERT, which redraws.
    const known = group || drawn.rows.some((r) => r.chatId === id);
    if (!known) return { kind: 'ignore' };
    const patch: ChatPatch = {
      typingUntil: str(next.typing_until),
      lastReadAt: str(next.last_read_at),
      replyFailed: replyFailedOf(next),
    };
    return { kind: 'patch', patches: { ...patches, chats: { ...patches.chats, [id]: patch } } };
  }

  if (event.table === 'advisor_chat_members') {
    const chatId = str(next.chat_id);
    const advisorId = str(next.advisor_id);
    if (event.eventType !== 'UPDATE' || !chatId || !advisorId) return { kind: 'refresh' };
    const group = drawn.groups.find((g) => g.id === chatId);
    const isMember = group?.members.some((m) => m.id === advisorId) ?? false;
    // Joining or leaving changes who is drawn: read the group again.
    if (!group || isMember === Boolean(next.left_at)) return { kind: 'refresh' };
    return {
      kind: 'patch',
      patches: { ...patches, members: { ...patches.members, [`${chatId}:${advisorId}`]: str(next.typing_until) } },
    };
  }

  return { kind: 'ignore' };
}

/** The rows as drawn with what was heard since: typing, read and a failed reply. */
export function patchRows(rows: readonly PersonRow[], patches: LivePatches): PersonRow[] {
  return rows.map((row) => {
    const patch = row.chatId ? patches.chats[row.chatId] : undefined;
    if (!patch) return row;
    return {
      ...row,
      typingUntil: patch.typingUntil,
      lastReadAt: patch.lastReadAt ?? row.lastReadAt,
      replyFailed: patch.replyFailed,
      unread: row.unread && !readSince(patch.lastReadAt, row.last?.at),
    };
  });
}

/** The groups as drawn with what was heard since: each bot's typing, and read. */
export function patchGroups(groups: readonly GroupRow[], patches: LivePatches): GroupRow[] {
  return groups.map((group) => {
    const chat = patches.chats[group.id];
    const members = group.members.map((m) => {
      const key = `${group.id}:${m.id}`;
      return key in patches.members ? { ...m, typingUntil: patches.members[key] } : m;
    });
    const unread = group.unread && !readSince(chat?.lastReadAt ?? null, group.last?.at);
    return { ...group, members, unread };
  });
}
