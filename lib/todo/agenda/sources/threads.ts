import 'server-only';

import { parseRef, refHref, refTitles, type ReadRows } from '@/lib/core/refs';
import { pageFor } from '@/lib/sources/catalogue';
import type { PageRow } from '@/lib/sources/types';
import type { AnyClient } from '@/lib/thread/store';
import { sessionClients } from '@/lib/todo/agenda/clients';
import { dismiss } from '@/lib/todo/agenda/dismissals';
import { SNOOZE_DAYS } from '@/lib/todo/tasks/model';
import type { AgendaItem, AgendaSource, SourceContext } from '@/lib/todo/agenda/sources';

/**
 * Threads where Dash spoke last and asked you something (plan #1473), from the
 * shared thread store, core.thread_turns (plan #1470). Whatever row the thread
 * sits under, a step, a role, an idea or a goal, the move is yours until you
 * reply, and the item leaves the list as soon as your reply is the last turn.
 *
 * "Asked something" is read off the turn: its last line holds a sentence
 * ending in a question mark. A reply that ends by saying what it did, or a
 * question mark inside a link or a quoted title, is not an ask.
 *
 * A thread under a row another source already lists (an open raise, a plan
 * question) is dropped in favour of that row's own item, by
 * `withoutCoveredThreads`, so the same row is never on the list twice.
 *
 * Always on, and read under the Todo workspace because a thread can sit under
 * any workspace's row. Not completable: you answer in the thread. "Later" and
 * "Not this one" go in the dismissal overlay keyed by the turn, so Dash's next
 * question shows again.
 */

const PREFIX = 'threads:';

/** Turns read per load, newest first. A thread whose last turn is older is long settled. */
const TURNS_READ = 1000;

/** Longest question shown as a title; longer ones are cut at a word. */
const TITLE_MAX = 120;

/** A question mark that ends a sentence: then only closing marks, then a space or the end. */
const QUESTION = /[^.!?\n]*\?(?=["'”’)\]*_]*(?:\s|$))/g;

/**
 * The question a turn ends by asking, or null when it asks nothing. Pure.
 *
 * Only the last non-empty line counts, since that is where a reply that wants
 * something back puts the ask; a question earlier in the reply is usually one
 * it went on to answer.
 */
export function lastQuestion(body: string): string | null {
  const lines = body
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const last = lines.at(-1);
  if (!last) return null;
  const found = last.match(QUESTION);
  const question = found?.at(-1)?.trim().replace(/^[-*>#\s]+/, '');
  return question || null;
}

function cut(text: string): string {
  if (text.length <= TITLE_MAX) return text;
  const head = text.slice(0, TITLE_MAX - 1);
  const space = head.lastIndexOf(' ');
  return `${(space > TITLE_MAX / 2 ? head.slice(0, space) : head).trimEnd()}…`;
}

export interface TurnRow {
  id: string;
  ref: string;
  author: string;
  body: string;
  created_at: string;
}

/** The last turn of each thread, from turns in any order. Pure. */
export function lastTurns(turns: readonly TurnRow[]): TurnRow[] {
  const last = new Map<string, TurnRow>();
  for (const turn of turns) {
    const seen = last.get(turn.ref);
    if (!seen || turn.created_at > seen.created_at || (turn.created_at === seen.created_at && turn.id > seen.id)) {
      last.set(turn.ref, turn);
    }
  }
  return [...last.values()];
}

/**
 * Pure: the agenda items for the threads waiting on your reply. `titles` names
 * the row each thread sits under, by ref; a row whose page knows it is gone
 * has its thread left off, since there is nothing left to reply about.
 */
export function threadItems(
  turns: readonly TurnRow[],
  titles: ReadonlyMap<string, { title: string; href: string | null; missing: boolean }> = new Map(),
): AgendaItem[] {
  return lastTurns(turns).flatMap((turn): AgendaItem[] => {
    if (turn.author !== 'claude') return [];
    const question = lastQuestion(turn.body);
    if (!question) return [];
    const target = titles.get(turn.ref);
    if (target?.missing) return [];
    return [
      {
        key: `${PREFIX}${turn.id}`,
        source: 'threads',
        ref: turn.ref,
        title: cut(question),
        day: null,
        onYouSince: turn.created_at,
        at: null,
        link: { href: target?.href ?? refHref(turn.ref) ?? '/dev/raised', label: 'Reply' },
        action: null,
        detail: target ? `Dash asked on ${target.title}` : 'Dash asked',
        completable: false,
      },
    ];
  });
}

/**
 * Drop a thread's item when another source already lists the row the thread
 * sits under: that row's item leads to the same thread, and the row's own
 * move says more than "Dash asked". Pure.
 */
export function withoutCoveredThreads(items: readonly AgendaItem[]): AgendaItem[] {
  const listed = new Set(items.filter((item) => item.source !== 'threads').map((item) => item.ref));
  return items.filter((item) => item.source !== 'threads' || !listed.has(item.ref));
}

/**
 * Reads a table's rows by id over any of the agenda's clients, whatever schema
 * it was made for. The ids come from the person's own threads, which is what
 * keeps a service-role read (the morning brief) to their rows.
 */
function readRowsOver(client: AnyClient): ReadRows {
  return async (table, columns, ids) => {
    const [schema, name] = table.split('.');
    const { data, error } = await client
      .schema(schema)
      .from(name)
      .select(columns.join(', '))
      .in('id', [...ids]);
    if (error) throw new Error(`${table}: ${error.message}`);
    return (data ?? []) as unknown as PageRow[];
  };
}

export const threadsSource: AgendaSource = {
  id: 'threads',
  label: 'Dash asked you something',
  module: 'todo',
  alwaysOn: true,
  description: 'Threads where Dash replied last and asked you something.',

  async fetch(ctx: SourceContext): Promise<AgendaItem[]> {
    const core = (await (ctx.clients ?? sessionClients).core()) as unknown as AnyClient;
    const { data, error } = await core
      .from('thread_turns')
      .select('id, ref, author, body, created_at')
      .eq('user_id', ctx.userId)
      .order('created_at', { ascending: false })
      .limit(TURNS_READ);
    if (error) throw new Error(`Could not read the threads: ${error.message}`);
    const turns = (data ?? []) as TurnRow[];

    const asking = lastTurns(turns).filter(
      (turn) => turn.author === 'claude' && lastQuestion(turn.body) !== null,
    );
    // Name only the rows whose table has a page; a ref with none keeps its
    // item without a title rather than being taken for a deleted row.
    const named = asking.map((turn) => turn.ref).filter((ref) => {
      const parsed = parseRef(ref);
      return parsed !== null && pageFor(parsed.table) !== null;
    });
    let titles: Map<string, { title: string; href: string | null; missing: boolean }> = new Map();
    try {
      titles = await refTitles(named, readRowsOver(core));
    } catch {
      // The questions are worth showing without the names of their rows.
    }
    return threadItems(asking, titles);
  },

  async defer(ctx, key) {
    const until = new Date(ctx.now);
    until.setUTCDate(until.getUTCDate() + SNOOZE_DAYS);
    await dismiss(ctx.userId, 'thread', key, until);
  },

  async dismiss(ctx, key) {
    await dismiss(ctx.userId, 'thread', key, null);
  },
};
