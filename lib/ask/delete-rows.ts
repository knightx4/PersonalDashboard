import { parseRef, toRef } from '@/lib/core/refs';
import type { AskDb, AskSchema } from './db';
import type { ModuleId } from '@/lib/modules';
import { DELETE_NOUNS, type DeletableTable } from './deletable';

export type { DeletableTable } from './deletable';

/**
 * Deleting rows Dash proposed (plan #2232.1, feature #2232).
 *
 * Dash never deletes on its own. propose_delete (lib/ask/propose.ts) keeps a
 * `delete_rows` proposal in core.dash_actions with a snapshot of every row it
 * would remove, and nothing is touched until the person confirms. Confirming
 * (confirmChange in lib/ask/changes.ts) calls deleteRows below, which reads
 * the rows again as the person, refuses if any has changed since the snapshot,
 * deletes them, and hands back the values it removed so the record can keep
 * them in `undo.rows`. Undo (undoDeletedRows) inserts those rows again.
 *
 * The tables Dash may propose deleting from are the short list DELETABLE:
 * application answers, job notes (plan #2266.2), roles (plan #2266.4) and tasks (plan #2266.3). Adding a table is adding
 * its name and nouns in deletable.ts and an entry here. An entry whose rows can have other rows attached (a role with
 * applications, a task with subtasks) gives a `refuse` check, and Dash
 * declines those rows with its reason rather than deleting them (decision
 * #2266.1): propose_delete calls it before keeping a card, and deleteRows
 * again before deleting, since something may have been attached in between.
 *
 * No `server-only` and no clients made here: callers hand in the person's
 * clients, and the tests hand in stubs.
 */

type Values = Record<string, unknown>;

type Deletable = {
  schema: AskSchema;
  table: string;
  /** The workspace that has to be on. */
  module: ModuleId;
  moduleLabel: string;
  /** What the rows are called, singular and plural. */
  noun: readonly [string, string];
  /** What each row is called on the card, and the page that shows them. */
  describe: (db: AskDb, userId: string, rows: Values[]) => Promise<{ titles: string[]; href: string }>;
  /**
   * Why these rows cannot be deleted, in a sentence the person can read, or
   * null when they all can. Read as the person; a row with something attached
   * to it is refused whole, never deleted with what hangs off it.
   */
  refuse?: (db: AskDb, userId: string, rows: Values[]) => Promise<string | null>;
};

const clip = (text: string, max = 80) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);

const ids = (rows: Values[], column: string) =>
  [...new Set(rows.map((r) => r[column]).filter((v): v is string => typeof v === 'string'))];

/** The one id every row shares in a column, or null when they differ or any is empty. */
const onlyOne = (rows: Values[], column: string) => {
  const found = ids(rows, column);
  return found.length === 1 && rows.every((r) => r[column] === found[0]) ? found[0] : null;
};

async function readIn(db: AskDb, schema: AskSchema, table: string, columns: string, ids: string[], userId: string) {
  if (ids.length === 0) return [] as Values[];
  const client = await db(schema);
  const { data, error } = await client.from(table).select(columns).in('id', ids).eq('user_id', userId);
  if (error) throw new Error(`${table}: ${error.message}`);
  return (data ?? []) as unknown as Values[];
}

export const DELETABLE: Record<DeletableTable, Deletable> = {
  'job_search.application_answers': {
    schema: 'job_search',
    table: 'application_answers',
    module: 'jobs',
    moduleLabel: 'Jobs',
    noun: DELETE_NOUNS['job_search.application_answers'],
    async describe(db, userId, rows) {
      const questionIds = [...new Set(rows.map((r) => r.question_id).filter((v): v is string => typeof v === 'string'))];
      const applicationIds = [...new Set(rows.map((r) => r.application_id).filter((v): v is string => typeof v === 'string'))];
      const [questions, applications] = await Promise.all([
        readIn(db, 'job_search', 'questions', 'id, text', questionIds, userId),
        readIn(db, 'job_search', 'applications', 'id, role_id', applicationIds, userId),
      ]);
      const text = new Map(questions.map((q) => [q.id as string, String(q.text ?? '')]));
      const roles = new Set(applications.map((a) => a.role_id as string).filter(Boolean));
      return {
        titles: rows.map((r) => clip(text.get(r.question_id as string) || 'A question no longer in the bank')),
        href: roles.size === 1 ? `/jobs/roles/${[...roles][0]}` : '/jobs/roles',
      };
    },
    async refuse(_db, _userId, rows) {
      return rows.some((row) => row.status === 'submitted')
        ? 'A submitted answer is never removed.'
        : null;
    },
  },
  // A note on a company, role, application, contact or interview. Nothing
  // hangs off a note, so it needs no refuse check.
  'job_search.notes': {
    schema: 'job_search',
    table: 'notes',
    module: 'jobs',
    moduleLabel: 'Jobs',
    noun: DELETE_NOUNS['job_search.notes'],
    async describe(db, userId, rows) {
      const titles = rows.map((r) => clip(String(r.body ?? '').replace(/\s+/g, ' ').trim() || 'An empty note'));
      const role = onlyOne(rows, 'role_id');
      if (role) return { titles, href: `/jobs/roles/${role}` };
      const company = onlyOne(rows, 'company_id');
      if (company && ids(rows, 'role_id').length === 0) {
        const [found] = await readIn(db, 'job_search', 'companies', 'id, slug', [company], userId);
        if (typeof found?.slug === 'string' && found.slug) return { titles, href: `/jobs/companies/${found.slug}` };
      }
      const contact = onlyOne(rows, 'contact_id');
      if (contact && ids(rows, 'role_id').length === 0 && ids(rows, 'company_id').length === 0) {
        return { titles, href: `/jobs/contacts/${contact}` };
      }
      return { titles, href: '/jobs' };
    },
  },
  // A role. Its applications (and through them interviews, answers and so on),
  // notes, attachments and task links cascade with it, and a suggestion that
  // led to it loses its link, so a role with any of those is refused
  // (decision #2266.1): Undo restores only the role row.
  'job_search.roles': {
    schema: 'job_search',
    table: 'roles',
    module: 'jobs',
    moduleLabel: 'Jobs',
    noun: DELETE_NOUNS['job_search.roles'],
    async describe(db, userId, rows) {
      const companies = await readIn(db, 'job_search', 'companies', 'id, name', ids(rows, 'company_id'), userId);
      const name = new Map(companies.map((c) => [c.id as string, String(c.name ?? '')]));
      const titles = rows.map((r) => {
        const title = String(r.title ?? '').replace(/\s+/g, ' ').trim() || 'An untitled role';
        const company = name.get(r.company_id as string);
        return clip(company ? `${title} at ${company}` : title);
      });
      return { titles, href: rows.length === 1 ? `/jobs/roles/${rows[0].id}` : '/jobs/roles' };
    },
    async refuse(db, userId, rows) {
      const roleIds = ids(rows, 'id');
      if (roleIds.length === 0) return null;
      const jobs = await db('job_search');
      const todo = await db('todo');
      const read = async (client: typeof jobs, table: string) => {
        const { data, error } = await client.from(table).select('id, role_id').in('role_id', roleIds);
        if (error) throw new Error(`${table}: ${error.message}`);
        return (data ?? []) as unknown as Values[];
      };
      const [applications, notes, attachments, suggestions, links] = await Promise.all([
        read(jobs, 'applications'),
        read(jobs, 'notes'),
        read(jobs, 'attachments'),
        read(jobs, 'suggestions'),
        read(todo, 'task_links'),
      ]);
      const count = (n: number, one: string, many: string) => (n === 1 ? `1 ${one}` : `${n} ${many}`);
      const has = [
        applications.length > 0 && count(applications.length, 'application', 'applications'),
        notes.length > 0 && count(notes.length, 'note', 'notes'),
        attachments.length > 0 && count(attachments.length, 'attachment', 'attachments'),
        links.length > 0 && count(links.length, 'task link', 'task links'),
        suggestions.length > 0 && count(suggestions.length, 'job suggestion', 'job suggestions'),
      ].filter((v): v is string => Boolean(v));
      if (has.length === 0) return null;
      const all = [...applications, ...notes, ...attachments, ...suggestions, ...links];
      const attached = rows.filter((r) => all.some((a) => a.role_id === r.id));
      const names = attached.map((r) => `"${clip(String(r.title ?? 'Untitled'), 40)}"`).join(', ');
      const list = has.length > 1 ? `${has.slice(0, -1).join(', ')} and ${has[has.length - 1]}` : has[0];
      const consequence = applications.length > 0
        ? 'deleting it would delete those and everything under them (interviews, answers) too'
        : 'deleting it would delete or detach those too';
      return attached.length === 1
        ? `The role ${names} has ${list} attached, and ${consequence}.`
        : `These roles have ${list} attached between them, and ${consequence}: ${names}.`;
    },
  },
  // A task. Its subtasks (parent_id) would be deleted with it by the cascade,
  // so a task that has any is refused (decision #2266.1). So is a task with
  // links (task_links) to a role, note and so on: they cascade too, and Undo
  // restores only the task row.
  'todo.tasks': {
    schema: 'todo',
    table: 'tasks',
    module: 'todo',
    moduleLabel: 'To-do',
    noun: DELETE_NOUNS['todo.tasks'],
    async describe(_db, _userId, rows) {
      return {
        titles: rows.map((r) => clip(String(r.title ?? '').replace(/\s+/g, ' ').trim() || 'An untitled task')),
        href: '/todo/all?status=all',
      };
    },
    async refuse(db, userId, rows) {
      const taskIds = ids(rows, 'id');
      if (taskIds.length === 0) return null;
      const client = await db('todo');
      const [subs, links] = await Promise.all([
        client.from('tasks').select('id, parent_id').in('parent_id', taskIds).eq('user_id', userId),
        client.from('task_links').select('id, task_id').in('task_id', taskIds),
      ]);
      if (subs.error) throw new Error(`tasks: ${subs.error.message}`);
      if (links.error) throw new Error(`task_links: ${links.error.message}`);
      const subtasks = (subs.data ?? []) as unknown as Values[];
      const linked = (links.data ?? []) as unknown as Values[];
      if (subtasks.length === 0 && linked.length === 0) return null;
      const attached = rows.filter((r) => subtasks.some((s) => s.parent_id === r.id) || linked.some((l) => l.task_id === r.id));
      const names = attached.map((r) => `"${clip(String(r.title ?? 'Untitled'), 40)}"`).join(', ');
      const has: string[] = [];
      if (subtasks.length > 0) has.push(subtasks.length === 1 ? 'a subtask' : `${subtasks.length} subtasks`);
      if (linked.length > 0) has.push(linked.length === 1 ? 'a link to another item' : `${linked.length} links to other items`);
      return attached.length === 1
        ? `The task ${names} has ${has.join(' and ')}, and deleting it would delete them too.`
        : `These tasks have ${has.join(' and ')} between them, and deleting them would delete those too: ${names}.`;
    },
  },
};

export function isDeletableTable(table: string): table is DeletableTable {
  return Object.prototype.hasOwnProperty.call(DELETABLE, table);
}

/** The most rows one proposal may name. */
export const MAX_DELETE_ROWS = 25;

/** What a `delete_rows` proposal keeps in `input`: the card's words and the snapshot of each row. */
export type DeleteRowsInput = {
  table: DeletableTable;
  count: number;
  /** What each row is called, in the order of `rows`. */
  titles: string[];
  /** The page the rows are on. */
  href: string;
  /** Every column of each row as it was when Dash proposed removing it. */
  rows: Values[];
};

export const DELETABLE_LIST = 'application answers (job_search.application_answers), notes on a job, company or contact (job_search.notes), job roles (job_search.roles) and tasks (todo.tasks)';

/** The rows asked for, as the person: nothing else is read, and a row that is not theirs is not found. */
export async function snapshotRows(
  deps: { userId: string; db: AskDb },
  table: DeletableTable,
  ids: string[],
): Promise<Values[]> {
  const spec = DELETABLE[table];
  const client = await deps.db(spec.schema);
  const { data, error } = await client.from(spec.table).select('*').in('id', ids).eq('user_id', deps.userId);
  if (error) throw new Error(`${table}: ${error.message}`);
  const found = new Map(((data ?? []) as Values[]).map((row) => [row.id as string, row]));
  return ids.flatMap((id) => (found.has(id) ? [found.get(id) as Values] : []));
}

/** Why these rows cannot be deleted, from the table's own check, or null when they can. */
export async function refusal(
  deps: { userId: string; db: AskDb },
  table: DeletableTable,
  rows: Values[],
): Promise<string | null> {
  const check = DELETABLE[table].refuse;
  return check && rows.length > 0 ? check(deps.db, deps.userId, rows) : null;
}

/** The card's input for rows already read. */
export async function deleteInput(
  deps: { userId: string; db: AskDb },
  table: DeletableTable,
  rows: Values[],
): Promise<DeleteRowsInput> {
  const { titles, href } = await DELETABLE[table].describe(deps.db, deps.userId, rows);
  return { table, count: rows.length, titles, href, rows };
}

function same(a: Values, b: Values): boolean {
  const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
  return keys.every((key) => JSON.stringify(a[key] ?? null) === JSON.stringify(b[key] ?? null));
}

export type DeletedRows = { rows: { ref: string; values: Values }[] };

/**
 * Delete the rows a proposal named. Refused, with nothing deleted, when the
 * table is not on the list, a row has changed since the snapshot, the table's
 * refuse check names a reason, or none of them is there any more. A row
 * already gone is left out.
 */
export async function deleteRows(
  deps: { userId: string; db: AskDb },
  input: DeleteRowsInput,
): Promise<{ ok: true; deleted: DeletedRows } | { ok: false; error: string }> {
  if (!isDeletableTable(input.table)) return { ok: false, error: 'Dash may not delete from that table.' };
  const spec = DELETABLE[input.table];
  const ids = input.rows.map((row) => row.id).filter((id): id is string => typeof id === 'string');
  if (ids.length === 0 || ids.length !== input.rows.length) return { ok: false, error: 'This proposal names no rows to remove.' };

  const current = await snapshotRows(deps, input.table, ids);
  if (current.length === 0) return { ok: false, error: `Those ${spec.noun[1]} are already gone, so nothing was removed.` };
  const snapshot = new Map(input.rows.map((row) => [row.id as string, row]));
  if (current.some((row) => !same(row, snapshot.get(row.id as string) as Values))) {
    return {
      ok: false,
      error: `One of those ${spec.noun[1]} has changed since Dash proposed removing it, so nothing was removed. Ask Dash again.`,
    };
  }
  const refused = await refusal(deps, input.table, current);
  if (refused) return { ok: false, error: `Nothing was removed. ${refused}` };

  const client = await deps.db(spec.schema);
  const { data, error } = await client
    .from(spec.table)
    .delete()
    .in('id', current.map((row) => row.id as string))
    .eq('user_id', deps.userId)
    .select('id');
  if (error) throw new Error(`${input.table}: ${error.message}`);
  const gone = new Set(((data ?? []) as { id: string }[]).map((row) => row.id));
  const removed = current.filter((row) => gone.has(row.id as string));
  if (removed.length === 0) return { ok: false, error: `Those ${spec.noun[1]} could not be removed.` };
  return {
    ok: true,
    deleted: { rows: removed.map((values) => ({ ref: toRef(input.table, values.id as string), values })) },
  };
}

function recordedRows(recorded: Record<string, unknown> | null): DeletedRows['rows'] | null {
  const rows = recorded?.rows;
  if (!Array.isArray(rows) || rows.length === 0) return null;
  const out: DeletedRows['rows'] = [];
  for (const row of rows as { ref?: unknown; values?: unknown }[]) {
    if (typeof row?.ref !== 'string' || !row.values || typeof row.values !== 'object') return null;
    const parsed = parseRef(row.ref);
    if (!parsed || !isDeletableTable(parsed.table)) return null;
    out.push({ ref: row.ref, values: row.values as Values });
  }
  return out;
}

/** Insert the rows again as they were. Rows already back are left; a row that cannot go in takes the others back out. */
export async function undoDeletedRows(
  deps: { userId: string; db: AskDb },
  recorded: Record<string, unknown> | null,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const rows = recordedRows(recorded);
  if (!rows) return { ok: false, error: 'Dash did not keep what this change removed, so it cannot be undone.' };

  const inserted: { spec: Deletable; id: string }[] = [];
  let alreadyBack = 0;
  for (const { ref, values } of rows) {
    const parsed = parseRef(ref);
    if (!parsed || !isDeletableTable(parsed.table) || values.user_id !== deps.userId) {
      return { ok: false, error: 'That change is not one of yours to undo.' };
    }
    const spec = DELETABLE[parsed.table];
    const client = await deps.db(spec.schema);
    const { data: held, error: readError } = await client.from(spec.table).select('id').eq('id', parsed.id).eq('user_id', deps.userId);
    if (readError) throw new Error(`${parsed.table}: ${readError.message}`);
    if ((held ?? []).length > 0) {
      alreadyBack += 1;
      continue;
    }
    const { error } = await client.from(spec.table).insert(values);
    if (error) {
      for (const done of inserted) {
        const back = await deps.db(done.spec.schema);
        await back.from(done.spec.table).delete().eq('id', done.id).eq('user_id', deps.userId);
      }
      return {
        ok: false,
        error: `Dash could not put the ${spec.noun[1]} back, probably because a newer one has taken the place of one of them (${error.message}).`,
      };
    }
    inserted.push({ spec, id: parsed.id });
  }
  if (inserted.length === 0 && alreadyBack > 0) return { ok: false, error: 'Those rows are already back.' };
  return { ok: true };
}
