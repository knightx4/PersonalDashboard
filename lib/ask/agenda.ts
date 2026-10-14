import { parseRef } from '@/lib/core/refs';
import { loadAgenda } from '@/lib/todo/agenda/load';
import { clientsOver } from '@/lib/todo/agenda/clients';
import { sourceById } from '@/lib/todo/agenda/registry';
import type { AgendaItem } from '@/lib/todo/agenda/sources';
import { optionalString, type AskContext, type AskDb, type AskRow, type AskToolResult } from './db';

/**
 * agenda (plan #1894.9.2, under #1894): the rows other workspaces put on the
 * person's Todo agenda, such as a job reminder, a goal step they sent to
 * Todo, a return deadline or a draft waiting to be sent.
 *
 * It reads what the page reads (loadAgenda), so a row they have put off or
 * dismissed is not listed, and each row says which of finish, put off and
 * dismiss its source can do. change_agenda_row (lib/dash/agenda-writes.ts)
 * takes a row's source and key from here.
 */

/** The most rows listed. */
export const AGENDA_ROWS = 60;

/** The source rows on the agenda now, in the order the page shows them. */
export async function loadAgendaItems(userId: string, db: AskDb, now: Date = new Date()): Promise<AgendaItem[]> {
  const agenda = await loadAgenda(userId, now, clientsOver(db));
  const items: AgendaItem[] = [];
  for (const pile of agenda.piles) {
    for (const entry of pile.entries) if (entry.kind === 'item' && entry.item) items.push(entry.item);
  }
  return items;
}

/** What a source can do with a row, in the words the tool takes. */
export function verbsOf(source: AgendaItem['source'], completable: boolean): string[] {
  const found = sourceById(source);
  const verbs: string[] = [];
  if (found?.complete && completable) verbs.push('finish');
  if (found?.defer) verbs.push('put_off');
  if (found?.dismiss) verbs.push('dismiss');
  return verbs;
}

function rowOf(item: AgendaItem): AskRow {
  const parsed = parseRef(item.ref);
  return {
    table: parsed?.table ?? 'todo.agenda',
    ref: parsed?.id ?? item.key,
    title: item.title,
    href: item.link?.href.startsWith('/') ? item.link.href : '/todo',
    detail: {
      agenda_source: item.source,
      agenda_key: item.key,
      day: item.day,
      about: item.detail,
      can: verbsOf(item.source, item.completable).join(', ') || 'nothing from here',
    },
  };
}

export async function agendaLookup(ctx: AskContext, input: Record<string, unknown>): Promise<AskToolResult> {
  const words = (optionalString(input, 'words') ?? '').toLowerCase().split(/\s+/).filter(Boolean);
  const items = (await loadAgendaItems(ctx.userId, ctx.db)).filter((item) => {
    const text = `${item.title} ${item.detail ?? ''}`.toLowerCase();
    return words.every((word) => text.includes(word));
  });
  return {
    ok: true,
    rows: items.slice(0, AGENDA_ROWS).map(rowOf),
    totals: { on_the_agenda: items.length },
    note: 'These are rows from other workspaces on the Todo agenda. To finish, put off or dismiss one, call change_agenda_row with its agenda_source, agenda_key and one of the verbs in can.',
  };
}
