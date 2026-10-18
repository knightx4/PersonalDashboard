import { isUuid } from '@/lib/ask/db';
import { toRef } from '@/lib/core/refs';
import { fieldsError, liveFields, parseCollectionName, type CollectionField } from '@/lib/goals/collections';
import { archiveRecord, confirmRecord, restoreRecord, reviseFields, updateRecord } from '@/lib/goals/collections-store';
import { displayValue } from '@/lib/goals/information';
import { sayMissing } from '@/lib/goals/lists';
import {
  addListRow,
  addListRowFromLink,
  archiveGoalList,
  createGoalList,
  pickListRow,
  renameGoalList,
  ruleOutAfterEdit,
} from '@/lib/goals/lists-store';
import { scrapeProductUrl } from '@/lib/saved/scrape-product';
import { GoalsRefused } from './goals-refused';
import type { GoalsMade, GoalsWrite, GoalsWriteEnv } from './goals-writes';

/**
 * change_goal_list (plan #2330.2): the lists a goal keeps of its own, such as
 * pantries to compare or groups to try, and their rows. A list is a
 * goals.collections row with goal_id set; its rows are goals.records
 * (lib/goals/lists.ts).
 *
 *   add_list      a list on the goal, with the fields it holds
 *   rename_list   its name changed
 *   add_fields    more fields on it; a field is never taken off
 *   archive_list  the list put away, with its rows
 *   add_row       a row from values they gave
 *   add_link      a row from a pasted product link: the page's name, picture
 *                 and price, as a draft for them to confirm
 *   edit_row      some of a row's values changed; setting its status to
 *                 a picked option rules out the rest, as pick_row does
 *   pick_row      the row they chose: it is marked picked and every other
 *                 row ruled out (plan #2330.5)
 *   confirm_row   a draft kept as a row
 *   archive_row   a row put away, and restore_row to bring it back
 *
 * As the other Goals writes (lib/dash/goals-writes.ts), every one reads the
 * goal and the list by id and the person's user id first, since the
 * connector runs them with no row level security, and writes as the person.
 */

const CHANGES = [
  'add_list',
  'rename_list',
  'add_fields',
  'archive_list',
  'add_row',
  'add_link',
  'edit_row',
  'pick_row',
  'confirm_row',
  'archive_row',
  'restore_row',
] as const;
type Change = (typeof CHANGES)[number];

type Args = Record<string, unknown>;
type Row = Record<string, unknown>;

const ITEM = 'goals.items';
const COLLECTIONS = 'goals.collections';
const RECORDS = 'goals.records';
const goalHref = (id: string) => `/goals/${id}`;
const GOAL_PATHS = ['/goals', '/goals/all', '/home'];

function text(args: Args, key: string): string {
  const value = args[key];
  return typeof value === 'string' ? value.trim() : '';
}

function named(title: unknown, fallback: string): string {
  const line = typeof title === 'string' ? title.split('\n')[0].trim() : '';
  if (!line) return fallback;
  return line.length > 120 ? `${line.slice(0, 119).trimEnd()}…` : line;
}

async function ownRow(env: GoalsWriteEnv, table: string, id: string): Promise<Row | null> {
  const { data, error } = await env.goals.from(table).select('*').eq('id', id).eq('user_id', env.userId).maybeSingle();
  if (error) throw new Error(`Reading goals.${table} failed: ${error.message}`);
  return (data as Row | null) ?? null;
}

async function ownGoal(env: GoalsWriteEnv, id: string): Promise<Row> {
  if (!id) throw new GoalsRefused('goal_ref is missing: give the goals.items ref a lookup returned for the goal.');
  if (!isUuid(id)) throw new GoalsRefused("goal_ref must be a goal's goals.items ref, as a lookup returned it.");
  const row = await ownRow(env, 'items', id);
  if (!row || row.level !== 'goal') throw new GoalsRefused('There is no goal of theirs with that goal_ref. Look it up first.');
  if (row.archived_at != null) throw new GoalsRefused('That goal is archived. Restore it first.');
  return row;
}

/** The goal's live lists, in order. */
async function listsOf(env: GoalsWriteEnv, goalId: string): Promise<Row[]> {
  const { data, error } = await env.goals
    .from('collections')
    .select('*')
    .eq('user_id', env.userId)
    .eq('goal_id', goalId)
    .is('archived_at', null)
    .order('position');
  if (error) throw new Error(`Reading the goal's lists failed: ${error.message}`);
  return (data ?? []) as Row[];
}

/** One of the goal's lists, by its name or its goals.collections ref. */
async function findList(env: GoalsWriteEnv, goalId: string, wanted: string): Promise<Row> {
  const lists = await listsOf(env, goalId);
  if (!wanted) {
    if (lists.length === 1) return lists[0];
    throw new GoalsRefused(
      lists.length === 0
        ? 'That goal keeps no lists yet. Start one with add_list.'
        : `list is missing: say which list. The goal keeps ${lists.map((l) => `"${l.name}"`).join(', ')}.`,
    );
  }
  const key = wanted.toLowerCase();
  const found = lists.find((l) => l.id === wanted || String(l.name).trim().toLowerCase() === key);
  if (found) return found;
  throw new GoalsRefused(
    lists.length === 0
      ? 'That goal keeps no lists yet. Start one with add_list.'
      : `The goal keeps no list called "${wanted}". It keeps ${lists.map((l) => `"${l.name}"`).join(', ')}.`,
  );
}

/** A row as the person reads it: its first few values, in the list's order. */
function describeRow(fields: CollectionField[], data: unknown): string {
  const values = (data ?? {}) as Record<string, unknown>;
  const parts = liveFields(fields)
    .filter((f) => f.type !== 'long_text' && f.type !== 'image' && f.type !== 'link')
    .map((f) => displayValue(f, values[f.key] as never))
    .filter(Boolean)
    .slice(0, 2);
  return parts.length > 0 ? parts.join(', ') : 'an empty row';
}

/** One row of the list, by its goals.records ref or by words in its values. */
async function findRow(env: GoalsWriteEnv, list: Row, wanted: string, archived: boolean): Promise<Row> {
  const fields = list.fields as CollectionField[];
  if (!wanted) throw new GoalsRefused('row is missing: give words from the row, such as its name, or its goals.records ref.');
  let query = env.goals.from('records').select('*').eq('user_id', env.userId).eq('collection_id', list.id as string);
  query = archived ? query.not('archived_at', 'is', null) : query.is('archived_at', null);
  const { data, error } = await query.order('position', { ascending: true });
  if (error) throw new Error(`Reading the rows failed: ${error.message}`);
  const rows = (data ?? []) as Row[];
  const byId = rows.find((r) => r.id === wanted);
  if (byId) return byId;
  const words = wanted.toLowerCase().split(/\s+/).filter(Boolean);
  const said = (r: Row) =>
    liveFields(fields)
      .map((f) => displayValue(f, ((r.data ?? {}) as Record<string, never>)[f.key]))
      .join(' ')
      .toLowerCase();
  const matches = rows.filter((r) => words.every((w) => said(r).includes(w)));
  if (matches.length === 1) return matches[0];
  if (rows.length === 0) throw new GoalsRefused(archived ? 'That list has no archived rows.' : 'That list has no rows.');
  const list10 = (matches.length > 1 ? matches : rows).slice(0, 10).map((r) => `"${describeRow(fields, r.data)}"`).join(', ');
  throw new GoalsRefused(
    matches.length > 1
      ? `More than one row matches "${wanted}": ${list10}. Say which.`
      : `No ${archived ? 'archived ' : ''}row matches "${wanted}". The rows are ${list10}.`,
  );
}

/** The rows ruled out, said: "the other one", "the other 3", or empty for none. */
export function ruledOutWords(n: number): string {
  if (n === 0) return '';
  return n === 1 ? 'the other one' : `the other ${n}`;
}

/** Values keyed by field key, from values the model keyed by key or by label. */
function keyedValues(fields: CollectionField[], args: Args): Record<string, unknown> {
  const raw = args.values;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new GoalsRefused('values is missing: give the row as an object keyed by field, such as {"name": "…"}.');
  }
  const live = liveFields(fields);
  const out: Record<string, unknown> = {};
  for (const [given, value] of Object.entries(raw as Record<string, unknown>)) {
    const key = given.trim().toLowerCase();
    const field = live.find((f) => f.key === key) ?? live.find((f) => f.label.trim().toLowerCase() === key);
    if (!field) {
      throw new GoalsRefused(`The list has no field "${given}". Its fields are ${live.map((f) => `${f.key} (${f.type})`).join(', ')}.`);
    }
    out[field.key] = value;
  }
  if (Object.keys(out).length === 0) throw new GoalsRefused('values is empty: give at least one value.');
  return out;
}

/** Fields as the model sent them, checked as the database will check them. */
function sentFields(args: Args): CollectionField[] | null {
  const raw = args.fields;
  if (raw === undefined || raw === null) return null;
  if (!Array.isArray(raw)) throw new GoalsRefused('fields must be a list of {key, label, type}.');
  const fields = raw.map((f) => {
    const field = (f ?? {}) as Record<string, unknown>;
    const out: CollectionField = {
      key: String(field.key ?? '').trim(),
      label: String(field.label ?? '').trim(),
      type: field.type as CollectionField['type'],
    };
    if (Array.isArray(field.options)) out.options = field.options.map(String);
    return out;
  });
  const problem = fieldsError(fields);
  if (problem) throw new GoalsRefused(problem);
  return fields;
}

async function changeGoalList(env: GoalsWriteEnv, args: Args): Promise<GoalsMade> {
  const change = text(args, 'change') as Change;
  if (!CHANGES.includes(change)) throw new GoalsRefused(`change must be one of ${CHANGES.join(', ')}.`);
  const goal = await ownGoal(env, text(args, 'goal_ref'));
  const goalId = goal.id as string;
  const title = named(goal.title, 'the goal');
  const href = goalHref(goalId);
  const made = (
    table: string,
    id: string,
    op: 'insert' | 'update',
    before: Row | null,
    after: Row | null,
    words: { verb: string; what: string; rest: string; summary: string },
    undo: Record<string, unknown> | null = null,
  ): GoalsMade => ({
    kind: 'change_goal_list',
    input: { verb: words.verb, what: words.what, rest: words.rest, href, where: 'Open the goal', paths: [...GOAL_PATHS, href] },
    subjectRef: toRef(table, id),
    op,
    before,
    after,
    undo,
    summary: words.summary,
    row: { table: ITEM, ref: goalId, title, href },
  });

  if (change === 'add_list') {
    const name = parseCollectionName(text(args, 'name'));
    if (!name.ok) throw new GoalsRefused(name.error.replace('collection', 'list'));
    const fields = sentFields(args) ?? undefined;
    const result = await createGoalList(await env.write({}), env.userId, goalId, name.value, fields);
    if (!result.ok) throw new GoalsRefused(result.error);
    const after = await ownRow(env, 'collections', result.value);
    return made(
      COLLECTIONS,
      result.value,
      'insert',
      null,
      after,
      {
        verb: 'Started the list',
        what: name.value,
        rest: ` on ${title}`,
        summary: `Dash started a list called "${name.value}" on the goal "${title}".`,
      },
      { none: 'A new list serves its goal as well, so it is put away by asking Dash to archive it.' },
    );
  }

  const list = await findList(env, goalId, text(args, 'list'));
  const listId = list.id as string;
  const listName = named(list.name, 'the list');
  const fields = (list.fields ?? []) as CollectionField[];

  switch (change) {
    case 'rename_list': {
      const name = parseCollectionName(text(args, 'name'));
      if (!name.ok) throw new GoalsRefused(name.error.replace('collection', 'list'));
      if (name.value === list.name) throw new GoalsRefused(`The list is called "${name.value}" already.`);
      const result = await renameGoalList(await env.write({}), listId, name.value);
      if (!result.ok) throw new GoalsRefused(result.error);
      if (!result.value) throw new GoalsRefused('That list has already gone.');
      return made(COLLECTIONS, listId, 'update', list, await ownRow(env, 'collections', listId), {
        verb: 'Renamed the list',
        what: listName,
        rest: ` to ${name.value}`,
        summary: `Dash renamed the list "${listName}" on the goal "${title}" to "${name.value}".`,
      });
    }
    case 'add_fields': {
      const adding = sentFields(args);
      if (!adding || adding.length === 0) throw new GoalsRefused('fields is missing: give the fields to add as {key, label, type}.');
      const result = await reviseFields(await env.write({}), listId, [...fields, ...adding]);
      if (!result.ok) throw new GoalsRefused(result.error);
      const labels = adding.map((f) => f.label).join(', ');
      return made(COLLECTIONS, listId, 'update', list, await ownRow(env, 'collections', listId), {
        verb: 'Added',
        what: labels,
        rest: ` to the list ${listName}`,
        summary: `Dash added ${labels} to the list "${listName}" on the goal "${title}".`,
      });
    }
    case 'archive_list': {
      if (!(await archiveGoalList(await env.write({}), listId))) throw new GoalsRefused('That list has already gone.');
      return made(COLLECTIONS, listId, 'update', list, await ownRow(env, 'collections', listId), {
        verb: 'Archived the list',
        what: listName,
        rest: ` on ${title}`,
        summary: `Dash archived the list "${listName}" on the goal "${title}".`,
      });
    }
    case 'add_row': {
      const values = keyedValues(fields, args);
      const result = await addListRow(await env.write({}), env.userId, listId, values);
      if (!result.ok) throw new GoalsRefused(result.error);
      const after = await ownRow(env, 'records', result.value);
      const said = describeRow(fields, after?.data);
      return made(RECORDS, result.value, 'insert', null, after, {
        verb: 'Added',
        what: said,
        rest: ` to ${listName}`,
        summary: `Dash added "${said}" to the list "${listName}" on the goal "${title}".`,
      });
    }
    case 'add_link': {
      const link = text(args, 'link');
      if (!link) throw new GoalsRefused('link is missing: give the product page address they pasted.');
      const result = await addListRowFromLink(await env.write({}), env.userId, listId, link, scrapeProductUrl);
      if (!result.ok) throw new GoalsRefused(result.error);
      const after = await ownRow(env, 'records', result.value.recordId);
      const revised = await ownRow(env, 'collections', listId);
      const said = describeRow((revised?.fields ?? fields) as CollectionField[], after?.data);
      const gap = result.value.missing.length > 0 ? ` The page did not give ${sayMissing(result.value.missing)}.` : '';
      return made(RECORDS, result.value.recordId, 'insert', null, after, {
        verb: 'Added a draft of',
        what: said === 'an empty row' ? link : said,
        rest: ` to ${listName}`,
        summary: `Dash added "${said === 'an empty row' ? link : said}" to the list "${listName}" as a draft for them to confirm.${gap}`,
      });
    }
    case 'edit_row': {
      const before = await findRow(env, list, text(args, 'row'), false);
      const values = keyedValues(fields, args);
      const client = await env.write({});
      const result = await updateRecord(client, before.id as string, values);
      if (!result.ok) throw new GoalsRefused(result.error);
      const ruled = await ruleOutAfterEdit(client, env.userId, listId, { id: before.id as string, data: (before.data ?? {}) as never }, result.value);
      if (!ruled.ok) throw new GoalsRefused(ruled.error);
      const after = await ownRow(env, 'records', before.id as string);
      const said = describeRow(fields, before.data);
      const others = ruledOutWords(ruled.value.ruledOut.length);
      return made(RECORDS, before.id as string, 'update', before, after, {
        verb: 'Changed',
        what: said,
        rest: ` on ${listName}${others ? `, and ruled out ${others}` : ''}`,
        summary: `Dash changed the row "${said}" on the list "${listName}"${others ? ` and ruled out ${others}` : ''}.`,
      });
    }
    case 'pick_row': {
      const before = await findRow(env, list, text(args, 'row'), false);
      const result = await pickListRow(await env.write({}), env.userId, listId, before.id as string);
      if (!result.ok) throw new GoalsRefused(result.error);
      const said = describeRow(fields, before.data);
      const others = ruledOutWords(result.value.ruledOut.length);
      return made(RECORDS, before.id as string, 'update', before, await ownRow(env, 'records', before.id as string), {
        verb: 'Picked',
        what: said,
        rest: ` on ${listName}${others ? `, and ruled out ${others}` : ''}`,
        summary: `Dash marked "${said}" as picked on the list "${listName}"${others ? ` and ruled out ${others}` : ''}.`,
      });
    }
    case 'confirm_row': {
      const before = await findRow(env, list, text(args, 'row'), false);
      if (!before.draft) throw new GoalsRefused('That row is confirmed already.');
      if (!(await confirmRecord(await env.write({}), before.id as string))) throw new GoalsRefused('That draft has already changed.');
      const said = describeRow(fields, before.data);
      return made(RECORDS, before.id as string, 'update', before, await ownRow(env, 'records', before.id as string), {
        verb: 'Confirmed',
        what: said,
        rest: ` on ${listName}`,
        summary: `Dash kept the draft "${said}" on the list "${listName}" as a row.`,
      });
    }
    case 'archive_row':
    case 'restore_row': {
      const archiving = change === 'archive_row';
      const before = await findRow(env, list, text(args, 'row'), !archiving);
      const client = await env.write({});
      const changed = archiving ? await archiveRecord(client, before.id as string) : await restoreRecord(client, before.id as string);
      if (!changed) throw new GoalsRefused('That row has already changed.');
      const said = describeRow(fields, before.data);
      return made(RECORDS, before.id as string, 'update', before, await ownRow(env, 'records', before.id as string), {
        verb: archiving ? 'Archived' : 'Brought back',
        what: said,
        rest: ` on ${listName}`,
        summary: archiving
          ? `Dash archived the row "${said}" on the list "${listName}".`
          : `Dash brought back the row "${said}" on the list "${listName}".`,
      });
    }
  }
  throw new GoalsRefused(`change must be one of ${CHANGES.join(', ')}.`);
}

export const CHANGE_GOAL_LIST: GoalsWrite = {
  name: 'change_goal_list',
  description:
    "Change the lists one of the person's goals keeps of its own, for things with no other home in the app such as pantries to compare or volunteer groups to try, when they ask: start a list (change add_list, with name and optionally fields), rename it (rename_list, with name), add fields to it (add_fields), archive it (archive_list), add a row from values they give (add_row, with values keyed by field key or label), add a row from a product link they paste, which reads the page's name, picture and price and adds it as a draft for them to confirm (add_link, with link), change a row's values (edit_row, with row and values), mark the row they chose as picked, which rules out every other row (pick_row, with row; setting a status to Picked with edit_row does the same), keep a draft as a row (confirm_row), or archive a row or bring one back (archive_row, restore_row). Name the goal by the goals.items ref a lookup returned, the list by its name, and a row by words from it. Readings, events, saved products and contacts the app already holds are linked with change_goal_link, not copied into a list.",
  input_schema: {
    type: 'object',
    properties: {
      change: { type: 'string', enum: [...CHANGES], description: 'What to change.' },
      goal_ref: { type: 'string', description: 'The goals.items ref a lookup returned for the goal.' },
      list: { type: 'string', description: 'The list, by its name; may be left out when the goal keeps one list.' },
      name: { type: 'string', description: 'For add_list and rename_list: the list name, short ("Pantries").' },
      fields: {
        type: 'array',
        description:
          'For add_list and add_fields: the fields, each {key, label, type} with options for a choice. Types: text, long_text, number, money, percent, date, day_of_month, yes_no, choice, link, image (a picture address), place (an address), ref (a row in the app as schema.table:id). Left out on add_list, the list holds name, link and notes.',
        items: {
          type: 'object',
          properties: {
            key: { type: 'string' },
            label: { type: 'string' },
            type: { type: 'string' },
            options: { type: 'array', items: { type: 'string' } },
          },
          required: ['key', 'label', 'type'],
        },
      },
      values: { type: 'object', description: 'For add_row and edit_row: the values, keyed by field key or label.' },
      link: { type: 'string', description: 'For add_link: the product page address they pasted.' },
      row: { type: 'string', description: 'For edit_row, pick_row, confirm_row, archive_row and restore_row: words from the row, or its goals.records ref.' },
    },
    required: ['change', 'goal_ref'],
    additionalProperties: false,
  },
  run: changeGoalList,
};
