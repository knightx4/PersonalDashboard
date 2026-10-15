import { moduleForPath, MODULES, type ModuleId } from '@/lib/modules';
import { zoneDay } from '@/lib/core/when';
import type { TalkCitation, TalkToolCall } from './talk';

/**
 * The list of Dash's chats on /ask (plan #1899.2): which workspaces each chat
 * read or changed, and which day group it falls in. Nothing here is stored;
 * both are worked out from what the turns already keep. No database and no
 * React, so the page, the gallery and the tests share it.
 */

/** A past chat as the list draws it. */
export type AskChat = {
  id: string;
  ref: string;
  title: string | null;
  /** When the last turn was written. */
  lastAt: string;
  /** The day of lastAt in the person's timezone, YYYY-MM-DD, worked out on the server. */
  day: string;
  /** The workspaces the chat read or changed, in the switcher's order. */
  workspaces: ModuleId[];
  /** When it was pinned to the top of the list, or null (plan #1899.6). */
  pinnedAt?: string | null;
  /** When it was archived out of the list, or null; it then opens from Archived. */
  archivedAt?: string | null;
};

/** What one turn keeps that says where Dash looked. */
export type ChatTurnTrail = {
  citations?: readonly TalkCitation[] | null;
  toolCalls?: readonly TalkToolCall[] | null;
};

/** The rows a lookup or a write gave back, each with the address it opens at. */
function hrefsIn(result: unknown): string[] {
  if (!result || typeof result !== 'object') return [];
  const rows = (result as { rows?: unknown }).rows;
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((row) =>
    row && typeof row === 'object' && typeof (row as { href?: unknown }).href === 'string'
      ? [(row as { href: string }).href]
      : [],
  );
}

/**
 * The workspaces a chat read or changed: those of every row an answer cited
 * and every row a lookup or a write gave back, by the address each opens at.
 * In the order of MODULES, so the chips read the same way on every chat.
 */
export function chatWorkspaces(turns: readonly ChatTurnTrail[]): ModuleId[] {
  const found = new Set<ModuleId>();
  for (const turn of turns) {
    for (const citation of turn.citations ?? []) {
      const id = moduleForPath(citation.href);
      if (id) found.add(id);
    }
    for (const call of turn.toolCalls ?? []) {
      for (const href of hrefsIn(call.result)) {
        const id = moduleForPath(href);
        if (id) found.add(id);
      }
    }
  }
  return MODULES.filter((module) => found.has(module.id)).map((module) => module.id);
}

export const CHAT_GROUPS = ['Pinned', 'Today', 'Yesterday', 'This week', 'Earlier'] as const;
export type ChatGroup = (typeof CHAT_GROUPS)[number];

/** Days from `day` to `today`, both YYYY-MM-DD. */
function daysBefore(day: string, today: string): number {
  return Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${day}T00:00:00Z`)) / 86_400_000);
}

/** The day an instant falls on in the person's timezone, as YYYY-MM-DD. */
export function dayIn(at: string, timezone: string): string {
  return zoneDay(at, timezone);
}

/** Which day group a chat last added to on `day` sits in, seen on `today`. */
export function chatGroup(day: string, today: string): Exclude<ChatGroup, 'Pinned'> {
  const days = daysBefore(day, today);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return 'This week';
  return 'Earlier';
}

/**
 * The chats in their groups, leaving out the groups with none. Pinned chats
 * come first in a group of their own, the one pinned last at the top, and
 * the rest fall in their day groups, newest first inside each.
 */
export function groupChats<T extends AskChat>(
  chats: readonly T[],
  today: string,
): { group: ChatGroup; chats: T[] }[] {
  const sorted = [...chats].sort((a, b) => b.lastAt.localeCompare(a.lastAt));
  const pinned = sorted
    .filter((chat) => chat.pinnedAt)
    .sort((a, b) => (b.pinnedAt ?? '').localeCompare(a.pinnedAt ?? ''));
  return CHAT_GROUPS.map((group) => ({
    group,
    chats:
      group === 'Pinned'
        ? pinned
        : sorted.filter((chat) => !chat.pinnedAt && chatGroup(chat.day, today) === group),
  })).filter((entry) => entry.chats.length > 0);
}

/** The chats in the list and those archived out of it, each in the order it had. */
export function splitArchived<T extends AskChat>(chats: readonly T[]): { listed: T[]; archived: T[] } {
  return {
    listed: chats.filter((chat) => !chat.archivedAt),
    archived: chats.filter((chat) => chat.archivedAt),
  };
}

/** The longest name a chat can be given, the same as the title a question starts it with. */
export const MAX_CHAT_TITLE = 120;

/** A new name for a chat, cut to one line, or null when nothing is left of it. */
export function chatTitleFrom(text: string): string | null {
  const line = text.replace(/\s+/g, ' ').trim();
  if (!line) return null;
  return line.length > MAX_CHAT_TITLE ? line.slice(0, MAX_CHAT_TITLE).trimEnd() : line;
}

/** What was typed in the search box, trimmed, or null when it is too short to search the turns by. */
export function chatQuery(text: string): string | null {
  const query = text.replace(/\s+/g, ' ').trim();
  return query.length >= 2 ? query.slice(0, 100) : null;
}

/** An ilike pattern that finds `query` anywhere in a turn's text, its wildcards taken literally. */
export function containsPattern(query: string): string {
  return `%${query.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

/**
 * A few words either side of where `query` falls in `body`, to show under a
 * chat the search found by what was said in it. Null when it is not there.
 */
export function matchSnippet(body: string, query: string, around = 48): string | null {
  const text = body.replace(/\s+/g, ' ').trim();
  const at = text.toLowerCase().indexOf(query.toLowerCase());
  if (at < 0) return null;
  let start = Math.max(0, at - around);
  let end = Math.min(text.length, at + query.length + around);
  if (start > 0) {
    const space = text.indexOf(' ', start);
    if (space >= 0 && space < at) start = space + 1;
  }
  if (end < text.length) {
    const space = text.lastIndexOf(' ', end);
    if (space > at + query.length) end = space;
  }
  return `${start > 0 ? '…' : ''}${text.slice(start, end)}${end < text.length ? '…' : ''}`;
}

/**
 * How many of a row of chips fit whole in `room` pixels, the rest going
 * behind a More chip `moreWidth` wide. All of them when they fit without
 * one; otherwise as many as fit beside More, which may be none.
 */
export function chipsThatFit(widths: readonly number[], room: number, moreWidth: number, gap: number): number {
  const total = widths.reduce((sum, width, i) => sum + width + (i > 0 ? gap : 0), 0);
  if (total <= room) return widths.length;
  let used = moreWidth;
  let count = 0;
  for (const width of widths) {
    if (used + gap + width > room) break;
    used += gap + width;
    count += 1;
  }
  return count;
}

/** The workspaces any chat in the list touched, for the chips that narrow it. */
export function chatChips(chats: readonly AskChat[]): ModuleId[] {
  const used = new Set(chats.flatMap((chat) => chat.workspaces));
  return MODULES.filter((module) => used.has(module.id)).map((module) => module.id);
}
