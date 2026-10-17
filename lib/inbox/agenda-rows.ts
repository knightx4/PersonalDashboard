import type { InboxRow, InboxSectionKey, InboxVerb, InboxWrite } from '@/components/inbox/inbox-page';
import type { AgendaEntry } from '@/lib/todo/agenda/merge';
import type { AgendaItem, SourceId } from '@/lib/todo/agenda/sources';
import { entryRef } from '@/lib/todo/agenda/workspace';
import { whenDate } from '@/lib/core/when';

/**
 * A workspace Inbox's rows, from the agenda's entries (plan #1937.5).
 *
 * Every press goes back through the agenda's own verbs: Done and Later on a
 * task are Todo's, and on an item they are the source's, which writes them on
 * the row in the workspace that owns it (a reminder's due date, a draft's
 * show-on day, a dismissal). So a row acted on in an Inbox changes on the
 * agenda and in its own workspace at the same moment.
 *
 * PURE: the server actions and what each source can do are passed in.
 */

/** The writes a row's presses make, each a server action taking the form. */
export type AgendaInboxActions = {
  /** Fields: source, key. */
  done: InboxWrite['action'];
  /** Fields: source, key. The source decides how far Later puts it off. */
  later: InboxWrite['action'];
  /** Fields: source, key. */
  decline: InboxWrite['action'];
  /** Fields: source, key, answer. */
  answer: InboxWrite['action'];
  /** Fields: id. */
  doneTask: InboxWrite['action'];
  /** Fields: id. */
  laterTask: InboxWrite['action'];
};

/** Which of the verbs a source has. */
export type SourceAbilities = Partial<
  Record<SourceId, { complete: boolean; defer: boolean; dismiss: boolean; answer: boolean }>
>;

/** A calendar day as a row's line says it: "today", "Fri 17 Oct". */
export function shortDay(day: string, today: string): string {
  if (day === today) return 'today';
  return whenDate(day, { timeZone: 'UTC', weekday: 'short', year: 'never' });
}

/** When it is due, in words, or null for a row with no day. */
export function dueLine(day: string | null, today: string): string | null {
  if (!day) return null;
  if (day < today) return `was due ${shortDay(day, today)}`;
  return `due ${shortDay(day, today)}`;
}

/** A question asked of you goes under Questions; everything else is an action. */
export function itemSection(item: AgendaItem): InboxSectionKey {
  if ((item.options?.length ?? 0) > 0 || item.source === 'threads') return 'questions';
  return 'actions';
}

function line(...parts: (string | null | undefined)[]): string | undefined {
  const kept = parts.map((part) => part?.trim()).filter((part): part is string => !!part);
  return kept.length > 0 ? kept.join(' · ') : undefined;
}

function itemRow(
  item: AgendaItem,
  actions: AgendaInboxActions,
  abilities: SourceAbilities,
  today: string,
): InboxRow {
  const can = abilities[item.source] ?? { complete: false, defer: false, dismiss: false, answer: false };
  const fields = { source: item.source, key: item.key };
  const verbs: InboxVerb[] = [];

  if (can.answer) {
    for (const option of item.options ?? []) {
      verbs.push({
        label: option.label,
        tone: option.recommended ? 'primary' : 'secondary',
        write: { action: actions.answer, fields: { ...fields, answer: option.answer } },
      });
    }
  }
  if (item.completable && can.complete) {
    verbs.push({ label: 'Done', tone: 'primary', write: { action: actions.done, fields } });
  }
  // The title opens the row's link. It is also a press only when it is the
  // one thing to do, so a row's presses stay on one line at 390.
  if (item.action) {
    verbs.push({ label: item.action.label, tone: verbs.length === 0 ? 'primary' : 'secondary', href: item.action.href });
  } else if (item.link && verbs.length === 0) {
    verbs.push({ label: item.link.label, tone: 'primary', href: item.link.href });
  }

  return {
    ref: item.ref,
    section: itemSection(item),
    title: item.title,
    line: line(item.detail, dueLine(item.day, today)),
    href: item.link?.href,
    move: { state: 'on_you' },
    verbs,
    // The one Later menu, the same as a task's (plan #1957.9).
    later: can.defer ? { action: actions.later, fields } : undefined,
    decline: can.dismiss ? { action: actions.decline, fields } : undefined,
  };
}

/** One entry as an Inbox row: a task of Todo's, or an item a source found. */
export function agendaInboxRow(
  entry: AgendaEntry,
  actions: AgendaInboxActions,
  abilities: SourceAbilities,
  today: string,
): InboxRow | null {
  if (entry.kind === 'task' && entry.task) {
    const task = entry.task;
    const fields = { id: task.id };
    return {
      ref: entryRef(entry),
      section: 'actions',
      title: task.title,
      line: line(
        entry.anchor?.label,
        entry.totalChildren > 0 ? `${entry.openChildren} of ${entry.totalChildren} left` : null,
        dueLine(task.dueOn, today),
      ),
      href: entry.anchor?.href,
      move: { state: 'on_you' },
      verbs: [{ label: 'Done', tone: 'primary', write: { action: actions.doneTask, fields } }],
      // A task takes a day, from the one Later menu (plan #1957.2).
      later: { action: actions.laterTask, fields },
    };
  }
  if (entry.item) return itemRow(entry.item, actions, abilities, today);
  return null;
}
