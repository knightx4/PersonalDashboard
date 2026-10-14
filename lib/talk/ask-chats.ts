import { moduleForPath, MODULES, type ModuleId } from '@/lib/modules';
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

export const CHAT_GROUPS = ['Today', 'Yesterday', 'This week', 'Earlier'] as const;
export type ChatGroup = (typeof CHAT_GROUPS)[number];

/** Days from `day` to `today`, both YYYY-MM-DD. */
function daysBefore(day: string, today: string): number {
  return Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${day}T00:00:00Z`)) / 86_400_000);
}

/** The day an instant falls on in the person's timezone, as YYYY-MM-DD. */
export function dayIn(at: string, timezone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(at));
}

/** Which group a chat last added to on `day` sits in, seen on `today`. */
export function chatGroup(day: string, today: string): ChatGroup {
  const days = daysBefore(day, today);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return 'This week';
  return 'Earlier';
}

/** The chats in their groups, newest first inside each, leaving out the groups with none. */
export function groupChats<T extends AskChat>(
  chats: readonly T[],
  today: string,
): { group: ChatGroup; chats: T[] }[] {
  const sorted = [...chats].sort((a, b) => b.lastAt.localeCompare(a.lastAt));
  return CHAT_GROUPS.map((group) => ({
    group,
    chats: sorted.filter((chat) => chatGroup(chat.day, today) === group),
  })).filter((entry) => entry.chats.length > 0);
}

/** The workspaces any chat in the list touched, for the chips that narrow it. */
export function chatChips(chats: readonly AskChat[]): ModuleId[] {
  const used = new Set(chats.flatMap((chat) => chat.workspaces));
  return MODULES.filter((module) => used.has(module.id)).map((module) => module.id);
}
