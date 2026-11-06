import type { DashChange } from '@/lib/talk/changes';
import type { BuildRun } from '@/lib/you/live-cards';
import type { PersonRow, ThreadMessage, ThreadPage } from '@/lib/you/chat-threads-model';
import type { GroupMember, GroupRow, Reacted } from '@/lib/you/group-chats-model';

/**
 * The Messages threads as the Ask Dash pane switches between them (plan
 * #2981), kept pure so the row, the Messages list and the tests agree on the
 * order.
 */

/** One chat in a run of them: a direct chat with one bot, or a group. */
export type ThreadEntry =
  | { kind: 'person'; row: PersonRow; at: string | null }
  | { kind: 'group'; row: GroupRow; at: string | null };

/**
 * Direct chats and groups in one run, newest message first, whichever side
 * said it; those with nothing said yet after them, as sortPeople keeps them.
 */
export function entriesOf(rows: readonly PersonRow[], groups: readonly GroupRow[]): ThreadEntry[] {
  const said: ThreadEntry[] = [
    ...rows.filter((r) => r.last).map((row): ThreadEntry => ({ kind: 'person', row, at: row.last?.at ?? null })),
    ...groups.filter((g) => g.last).map((row): ThreadEntry => ({ kind: 'group', row, at: row.last?.at ?? null })),
  ].sort((a, b) => (b.at ?? '').localeCompare(a.at ?? ''));
  const quiet: ThreadEntry[] = [
    ...groups.filter((g) => !g.last).map((row): ThreadEntry => ({ kind: 'group', row, at: null })),
    ...rows.filter((r) => !r.last).map((row): ThreadEntry => ({ kind: 'person', row, at: null })),
  ];
  return [...said, ...quiet];
}

/** What the pane has open: Dash's own chat, or one of the Messages threads. */
export type PanePick = { kind: 'dash' } | { kind: 'person'; key: string } | { kind: 'group'; id: string };

export const DASH_PICK: PanePick = { kind: 'dash' };

/** One id per pick, for the row's highlight and each thread's kept draft. */
export function pickId(pick: PanePick): string {
  if (pick.kind === 'dash') return 'dash';
  return pick.kind === 'person' ? `person:${pick.key}` : `group:${pick.id}`;
}

export function pickOf(entry: ThreadEntry): PanePick {
  return entry.kind === 'person' ? { kind: 'person', key: entry.row.key } : { kind: 'group', id: entry.row.id };
}

/** What the entry is called, as the row's tip and the pane's header say it. */
export function entryName(entry: ThreadEntry): string {
  return entry.kind === 'person' ? entry.row.name : entry.row.title;
}

/** The chats the row lists, as the Messages tab lists them, or why they could not be read. */
export type PaneThreads = { rows: PersonRow[]; groups: GroupRow[] } | { error: string };

/** One thread read for the pane: what its page on the Messages tab is drawn from. */
export type PaneThread =
  | {
      kind: 'person';
      person: PersonRow;
      page: ThreadPage;
      changes: DashChange[];
      builds: Record<string, BuildRun>;
      timezone: string;
      now: number;
      today: string;
    }
  | {
      kind: 'group';
      chatId: string;
      title: string;
      members: GroupMember[];
      former: GroupMember[];
      page: { messages: ThreadMessage[]; hasOlder: boolean; reactions: Record<string, Reacted[]> };
      timezone: string;
      now: number;
    }
  | { kind: 'error'; error: string };
