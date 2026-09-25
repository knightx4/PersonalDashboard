/**
 * What one goal run changed, as sentences, and how to undo each of Claude's
 * changes (plan #1013).
 *
 * Every write a run makes lands in goals.history with the run's id, so the
 * run's page reads those rows and says what each one did: "Added step Turn
 * on autopay", "Filed 4 loans", "Closed Check loan drafts". Each change that
 * Claude made carries an Undo, which puts that row back as it was:
 *
 * - A row Claude added is archived, or deleted where the table keeps no
 *   archive (readings, dependencies). An added step is archived, not deleted,
 *   so it can be restored.
 * - A row Claude changed gets the old values of the columns it changed.
 * - A field Claude added to a collection is hidden: the database never lets a
 *   field leave the definition (migrations-goals 0009), so it is marked
 *   removed and its values stay in the records. A field Claude changed goes
 *   back to how it was.
 *
 * An undo is refused when the row has moved on since, so it cannot throw away
 * later work: a record you have confirmed or edited is kept, as is a column
 * or a field something else has changed since. The undo itself is written as
 * yours with the history row it undid (history.undoes, 0020), which is how a
 * change reads as undone afterwards.
 *
 * Pure: the store in run-changes-store.ts reads the rows and carries out the
 * undo, this file says what they mean.
 */
import type { GoalsActor } from '@/lib/goals/db/schema-name';

/** One goals.history row, as the run's page reads it. */
export type HistoryRow = {
  id: number;
  table_name: string;
  row_id: string;
  action: string;
  old_values: Record<string, unknown> | null;
  new_values: Record<string, unknown> | null;
  actor: string;
  created_at: string;
  undoes: number | null;
  undoes_field: string | null;
};

export const HISTORY_COLUMNS =
  'id, table_name, row_id, action, old_values, new_values, actor, created_at, undoes, undoes_field';

/** Current names for the rows a run touched, so a sentence can say which one. */
export type ChangeNames = {
  items: Map<string, { title: string; level: string; kind: string | null }>;
  collections: Map<string, string>;
  /** A record's collection, for records whose history row does not carry it. */
  records: Map<string, string>;
};

export function emptyNames(): ChangeNames {
  return { items: new Map(), collections: new Map(), records: new Map() };
}

/** How one change is taken back. */
export type UndoTarget =
  | { kind: 'archive'; table: string; rowId: string; historyId: number }
  | { kind: 'delete'; table: string; rowId: string; historyId: number }
  | {
      kind: 'revert';
      table: string;
      rowId: string;
      historyId: number;
      values: Record<string, unknown>;
    }
  | {
      kind: 'field';
      table: 'collections';
      rowId: string;
      historyId: number;
      key: string;
      /** The field as it was before, or null when Claude added it and undo hides it. */
      before: Record<string, unknown> | null;
      /** The field as the change left it, to tell whether it has changed since. */
      after: Record<string, unknown>;
    };

/**
 * Where a change stands.
 *
 * - `undoable`: Claude's, and nothing has touched it since.
 * - `undone`: you undid it here.
 * - `kept`: it has changed since, so undoing it would lose that; `reason` says how.
 * - `gone`: the row has since been archived or deleted, so there is nothing to undo.
 * - `none`: not Claude's, or not a change this page can reverse.
 */
export type UndoState = 'undoable' | 'undone' | 'kept' | 'gone' | 'none';

export type ChangeLine = {
  /** Stable across reads: the first history id, and the field key for a field change. */
  key: string;
  sentence: string;
  actor: GoalsActor;
  state: UndoState;
  reason: string | null;
  targets: UndoTarget[];
};

/** Tables a routine's run writes that are the run's own bookkeeping, not a change to show. */
const HIDDEN_TABLES = new Set(['runs']);

/** Tables whose rows are archived rather than deleted. */
const ARCHIVED_TABLES = new Set([
  'items',
  'areas',
  'collections',
  'collection_goals',
  'records',
  'item_goals',
  'links',
]);

/** Tables whose rows have no archive, so an added one is deleted. */
const DELETED_TABLES = new Set(['readings', 'dependencies']);

/**
 * Columns an undo never writes: the row's identity, and what the database
 * keeps itself (closed_at follows status, version follows fields).
 */
const MANAGED_COLUMNS = new Set([
  'id',
  'user_id',
  'created_at',
  'updated_at',
  'closed_at',
  'version',
]);

const FIELD_WORDS: Record<string, string> = {
  detail: 'the detail',
  acceptance: 'done when',
  due_on: 'the due date',
  asks_for: 'what it asks for',
  questions: 'its questions',
  collection_id: 'the collection',
  block_ask: 'what it is waiting on',
  block_kind: 'what it is waiting on',
  resolution: 'the answer',
  rhythm_count: 'the rhythm',
  rhythm_period: 'the rhythm',
  on_todo: 'Todo',
  help_kinds: 'the weekly help',
  approved_at: 'the approval',
  kind: 'the kind',
  unit: 'the unit',
  target: 'the target',
  data: 'the values',
  draft: 'the draft mark',
  shape: 'the shape',
};

function asActor(actor: string): GoalsActor {
  return actor === 'me' || actor === 'capture' ? actor : 'claude';
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function values(row: HistoryRow): Record<string, unknown> {
  return { ...(row.old_values ?? {}), ...(row.new_values ?? {}) };
}

function listWords(words: string[]): string {
  if (words.length <= 1) return words.join('');
  return `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`;
}

function itemTitle(id: unknown, names: ChangeNames, fallback = 'a step'): string {
  if (typeof id !== 'string') return fallback;
  return names.items.get(id)?.title ?? fallback;
}

function collectionName(id: unknown, names: ChangeNames): string {
  if (typeof id !== 'string') return 'a collection';
  return names.collections.get(id) ?? 'a collection';
}

function recordCollection(row: HistoryRow, names: ChangeNames): string {
  const id = values(row).collection_id ?? names.records.get(row.row_id);
  return collectionName(id, names);
}

type Field = Record<string, unknown> & { key: string };

function fieldsOf(value: unknown): Field[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (f): f is Field => typeof f === 'object' && f !== null && typeof (f as Field).key === 'string',
  );
}

function fieldLabel(field: Field): string {
  return str(field.label) ?? field.key;
}

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

// ---------------------------------------------------------------------------
// Sentences
// ---------------------------------------------------------------------------

function itemSentence(row: HistoryRow, names: ChangeNames): string {
  const v = values(row);
  const current = names.items.get(row.row_id);
  const title = current?.title ?? str(v.title) ?? 'a step';
  const level = current?.level ?? str(v.level) ?? 'step';
  const kind = current?.kind ?? str(v.kind);
  const oldV = row.old_values ?? {};
  const newV = row.new_values ?? {};

  if (row.action === 'insert') {
    if (level === 'goal') return `Added goal ${title}`;
    if (kind === 'decision') return `Asked ${title}`;
    return `Added step ${title}`;
  }
  if (row.action === 'delete') return `Deleted ${title}`;
  if (row.action === 'archive') return `Archived ${title}`;
  if (row.action === 'unarchive') return `Restored ${title}`;

  if ('status' in newV) {
    if (newV.status === 'done') return `Closed ${title}`;
    if (newV.status === 'dropped') return `Dropped ${title}`;
    if (newV.status === 'open')
      return oldV.status === 'proposed' ? `Opened ${title}` : `Reopened ${title}`;
    if (newV.status === 'proposed') return `Made ${title} a proposal again`;
  }
  if ('title' in newV)
    return `Renamed ${str(oldV.title) ?? 'a step'} to ${str(newV.title) ?? title}`;
  if ('parent_id' in newV) return `Moved ${title}`;
  if ('result' in newV) return `Wrote the result on ${title}`;
  if ('fog' in newV)
    return newV.fog === null ? `Cleared the fog on ${title}` : `Wrote the fog on ${title}`;

  const words = [
    ...new Set(
      Object.keys(newV)
        .filter((k) => !MANAGED_COLUMNS.has(k) && k !== 'position')
        .map((k) => FIELD_WORDS[k] ?? k.replace(/_/g, ' ')),
    ),
  ];
  if (words.length === 0 && 'position' in newV) return `Reordered ${title}`;
  return `Changed ${listWords(words)} on ${title}`;
}

function recordSentence(row: HistoryRow, names: ChangeNames): string {
  const where = recordCollection(row, names);
  const data = (values(row).data ?? {}) as Record<string, unknown>;
  const label = str(data.name);
  const newV = row.new_values ?? {};
  if (row.action === 'insert')
    return label ? `Filed ${label} in ${where}` : `Filed a record in ${where}`;
  if (row.action === 'archive') return `Archived a record in ${where}`;
  if (row.action === 'unarchive') return `Restored a record in ${where}`;
  if (row.action === 'delete') return `Deleted a record in ${where}`;
  if (newV.draft === false && row.old_values?.draft === true)
    return `Confirmed a record in ${where}`;
  return `Edited a record in ${where}`;
}

function genericSentence(row: HistoryRow): string {
  const noun = row.table_name.replace(/_/g, ' ').replace(/s$/, '');
  const verbs: Record<string, string> = {
    insert: 'Added',
    update: 'Changed',
    archive: 'Archived',
    unarchive: 'Restored',
    delete: 'Deleted',
  };
  return `${verbs[row.action] ?? 'Changed'} a ${noun}`;
}

function rowSentence(row: HistoryRow, names: ChangeNames): string {
  const v = values(row);
  switch (row.table_name) {
    case 'items':
      return itemSentence(row, names);
    case 'records':
      return recordSentence(row, names);
    case 'collections': {
      const name = names.collections.get(row.row_id) ?? str(v.name) ?? 'a collection';
      if (row.action === 'insert') return `Made the collection ${name}`;
      if (row.action === 'archive') return `Archived the collection ${name}`;
      if (row.action === 'unarchive') return `Restored the collection ${name}`;
      if (row.new_values && 'name' in row.new_values) {
        return `Renamed the collection ${str(row.old_values?.name) ?? name} to ${str(row.new_values.name) ?? name}`;
      }
      return `Changed the collection ${name}`;
    }
    case 'collection_goals':
      if (row.action === 'insert') {
        return `Linked ${collectionName(v.collection_id, names)} to ${itemTitle(v.goal_id, names, 'a goal')}`;
      }
      return `Unlinked ${collectionName(v.collection_id, names)} from ${itemTitle(v.goal_id, names, 'a goal')}`;
    case 'readings': {
      const on = itemTitle(v.item_id, names, 'a goal');
      if (row.action === 'delete') return `Deleted the reading ${String(v.value)} on ${on}`;
      return `Logged ${String(v.value)} on ${on}`;
    }
    case 'dependencies': {
      const a = itemTitle(v.item_id, names);
      const b = itemTitle(v.depends_on_id, names);
      if (row.action === 'delete') return `Stopped ${a} waiting on ${b}`;
      return `Made ${a} wait on ${b}`;
    }
    case 'item_goals':
      if (row.action === 'insert') {
        return `Counted ${itemTitle(v.item_id, names)} towards ${itemTitle(v.goal_id, names, 'a goal')}`;
      }
      return `Stopped counting ${itemTitle(v.item_id, names)} towards ${itemTitle(v.goal_id, names, 'a goal')}`;
    case 'comments':
      return `${v.author === 'claude' ? 'Replied' : 'Commented'} on ${itemTitle(v.item_id, names)}`;
    case 'links':
      return `${row.action === 'insert' ? 'Added' : 'Changed'} a link on ${itemTitle(v.item_id, names)}`;
    case 'areas': {
      const name = str(v.name) ?? 'an area';
      return row.action === 'insert' ? `Added the area ${name}` : `Changed the area ${name}`;
    }
    default:
      return genericSentence(row);
  }
}

// ---------------------------------------------------------------------------
// Undo targets
// ---------------------------------------------------------------------------

/** How to take back one whole-row change, or null when this page cannot. */
export function undoTargetFor(row: HistoryRow): UndoTarget | null {
  if (row.action === 'insert') {
    if (ARCHIVED_TABLES.has(row.table_name)) {
      return { kind: 'archive', table: row.table_name, rowId: row.row_id, historyId: row.id };
    }
    if (DELETED_TABLES.has(row.table_name)) {
      return { kind: 'delete', table: row.table_name, rowId: row.row_id, historyId: row.id };
    }
    return null;
  }
  if (row.action === 'update' || row.action === 'archive' || row.action === 'unarchive') {
    if (row.table_name === 'comments' || row.table_name === 'runs') return null;
    const back = Object.fromEntries(
      Object.entries(row.old_values ?? {}).filter(([k]) => !MANAGED_COLUMNS.has(k)),
    );
    if (Object.keys(back).length === 0) return null;
    return {
      kind: 'revert',
      table: row.table_name,
      rowId: row.row_id,
      historyId: row.id,
      values: back,
    };
  }
  return null;
}

type Draft = {
  key: string;
  sentence: string;
  actor: GoalsActor;
  targets: UndoTarget[];
  reversible: boolean;
};

/** A change to a collection's fields, one line per field it touched. */
function fieldDrafts(row: HistoryRow, names: ChangeNames): Draft[] {
  const name = names.collections.get(row.row_id) ?? 'a collection';
  const before = fieldsOf(row.old_values?.fields);
  const after = fieldsOf(row.new_values?.fields);
  const actor = asActor(row.actor);
  const drafts: Draft[] = [];
  for (const field of after) {
    const was = before.find((f) => f.key === field.key);
    if (was && same(was, field)) continue;
    let sentence: string;
    if (!was) sentence = `Added field ${fieldLabel(field)} to ${name}`;
    else if (field.removed === true && was.removed !== true)
      sentence = `Hid field ${fieldLabel(was)} in ${name}`;
    else if (was.removed === true && field.removed !== true)
      sentence = `Brought back field ${fieldLabel(field)} in ${name}`;
    else if (fieldLabel(was) !== fieldLabel(field)) {
      sentence = `Renamed field ${fieldLabel(was)} to ${fieldLabel(field)} in ${name}`;
    } else sentence = `Changed field ${fieldLabel(field)} in ${name}`;
    drafts.push({
      key: `${row.id}:${field.key}`,
      sentence,
      actor,
      reversible: true,
      targets: [
        {
          kind: 'field',
          table: 'collections',
          rowId: row.row_id,
          historyId: row.id,
          key: field.key,
          before: was ?? null,
          after: field,
        },
      ],
    });
  }
  // Anything else the same write changed, such as the name.
  const rest = Object.keys(row.new_values ?? {}).filter(
    (k) => k !== 'fields' && !MANAGED_COLUMNS.has(k),
  );
  if (rest.length > 0) {
    const back = Object.fromEntries(rest.map((k) => [k, row.old_values?.[k] ?? null]));
    drafts.push({
      key: String(row.id),
      sentence: rowSentence(row, names),
      actor,
      reversible: true,
      targets: [
        {
          kind: 'revert',
          table: 'collections',
          rowId: row.row_id,
          historyId: row.id,
          values: back,
        },
      ],
    });
  }
  return drafts;
}

/**
 * Whether a row belongs on the page at all. The run's own row is bookkeeping,
 * and a reading a record's tracked field wrote is part of filing the record.
 */
function shown(row: HistoryRow): boolean {
  if (HIDDEN_TABLES.has(row.table_name)) return false;
  if (row.table_name === 'readings' && values(row).record_id) return false;
  return true;
}

/**
 * The lines for one run, in the order it made them. Records Claude filed into
 * the same collection read as one line, "Filed 4 loans", placed where the
 * first of them was; its Undo takes back each one that can be.
 */
export function changeLines(
  runRows: readonly HistoryRow[],
  later: readonly HistoryRow[],
  names: ChangeNames,
): ChangeLine[] {
  const drafts: Draft[] = [];
  const filed = new Map<string, Draft & { rows: HistoryRow[] }>();

  for (const row of [...runRows].sort((a, b) => a.id - b.id)) {
    if (!shown(row)) continue;
    const actor = asActor(row.actor);

    if (
      row.table_name === 'collections' &&
      row.action === 'update' &&
      row.new_values &&
      'fields' in row.new_values
    ) {
      drafts.push(...fieldDrafts(row, names));
      continue;
    }

    if (row.table_name === 'records' && row.action === 'insert') {
      const collection = String(values(row).collection_id ?? '');
      const groupKey = `${actor}:${collection}`;
      const group = filed.get(groupKey);
      const target = undoTargetFor(row);
      if (group) {
        group.rows.push(row);
        if (target) group.targets.push(target);
        continue;
      }
      const draft = {
        key: String(row.id),
        sentence: '',
        actor,
        reversible: true,
        targets: target ? [target] : [],
        rows: [row],
      };
      filed.set(groupKey, draft);
      drafts.push(draft);
      continue;
    }

    const target = undoTargetFor(row);
    drafts.push({
      key: String(row.id),
      sentence: rowSentence(row, names),
      actor,
      reversible: target !== null,
      targets: target ? [target] : [],
    });
  }

  for (const group of filed.values()) {
    group.sentence =
      group.rows.length === 1
        ? recordSentence(group.rows[0], names)
        : `Filed ${group.rows.length} ${recordCollection(group.rows[0], names)}`;
  }

  return drafts.map((draft) => {
    const { state, reason } =
      draft.actor === 'claude' && draft.reversible
        ? lineState(draft.targets, later)
        : { state: 'none' as const, reason: null };
    return {
      key: draft.key,
      sentence: draft.sentence,
      actor: draft.actor,
      state,
      reason,
      targets: draft.targets,
    };
  });
}

// ---------------------------------------------------------------------------
// Where each change stands
// ---------------------------------------------------------------------------

type TargetState = { state: Exclude<UndoState, 'none'>; reason: string | null };

function targetField(target: UndoTarget): string | null {
  return target.kind === 'field' ? target.key : null;
}

function undoesTarget(row: HistoryRow, target: UndoTarget): boolean {
  return row.undoes === target.historyId && (row.undoes_field ?? null) === targetField(target);
}

/**
 * Where one target stands, given the history rows written on its row after
 * it (any others are ignored).
 */
export function targetState(target: UndoTarget, later: readonly HistoryRow[]): TargetState {
  const after = later
    .filter((h) => h.row_id === target.rowId && h.id > target.historyId)
    .sort((a, b) => a.id - b.id);

  if (after.some((h) => undoesTarget(h, target))) return { state: 'undone', reason: null };
  if (after.some((h) => h.action === 'delete'))
    return { state: 'gone', reason: 'It has since been deleted.' };

  const others = after.filter((h) => !undoesTarget(h, target));

  if (target.kind === 'archive') {
    const last = [...others]
      .reverse()
      .find((h) => h.action === 'archive' || h.action === 'unarchive');
    if (last?.action === 'archive') return { state: 'gone', reason: 'It has since been archived.' };
  }

  // A record you have confirmed or edited is yours now. An undo of another
  // change is not an edit.
  if (target.table === 'records' && others.some((h) => h.actor !== 'claude' && h.undoes === null)) {
    return { state: 'kept', reason: 'You have confirmed or edited it since.' };
  }

  if (target.kind === 'revert') {
    const columns = Object.keys(target.values);
    if (others.some((h) => columns.some((c) => h.new_values && c in h.new_values))) {
      return { state: 'kept', reason: 'It has changed again since.' };
    }
  }

  if (target.kind === 'field') {
    const changed = others.some((h) => {
      if (!h.new_values || !('fields' in h.new_values)) return false;
      const now = fieldsOf(h.new_values.fields).find((f) => f.key === target.key) ?? null;
      return !same(now, target.after);
    });
    if (changed) return { state: 'kept', reason: 'That field has changed again since.' };
  }

  return { state: 'undoable', reason: null };
}

function lineState(
  targets: readonly UndoTarget[],
  later: readonly HistoryRow[],
): { state: UndoState; reason: string | null } {
  if (targets.length === 0) return { state: 'none', reason: null };
  const states = targets.map((t) => targetState(t, later));
  if (states.some((s) => s.state === 'undoable')) return { state: 'undoable', reason: null };
  if (states.every((s) => s.state === 'undone')) return { state: 'undone', reason: null };
  return (
    states.find((s) => s.state === 'kept') ?? states.find((s) => s.state === 'gone') ?? states[0]
  );
}

// ---------------------------------------------------------------------------
// Carrying out an undo
// ---------------------------------------------------------------------------

/**
 * A collection's fields once one field change is undone: a field Claude added
 * is marked removed, and a field it changed goes back to how it was. Every
 * other field stays as it is now, including ones added since.
 */
export function fieldsAfterUndo(
  current: unknown,
  target: Extract<UndoTarget, { kind: 'field' }>,
): Record<string, unknown>[] {
  return fieldsOf(current).map((field) => {
    if (field.key !== target.key) return field;
    return target.before ? { ...target.before } : { ...field, removed: true };
  });
}

/** The line a key names, when it is still one that can be undone. */
export function findUndoable(lines: readonly ChangeLine[], key: string): ChangeLine | null {
  const line = lines.find((l) => l.key === key);
  return line && line.state === 'undoable' ? line : null;
}

/** The ids a run's sentences need names for. */
export function namesNeeded(rows: readonly HistoryRow[]): {
  items: string[];
  collections: string[];
  records: string[];
} {
  const items = new Set<string>();
  const collections = new Set<string>();
  const records = new Set<string>();
  const add = (set: Set<string>, value: unknown) => {
    if (typeof value === 'string' && value) set.add(value);
  };
  for (const row of rows) {
    const v = values(row);
    if (row.table_name === 'items') add(items, row.row_id);
    if (row.table_name === 'collections') add(collections, row.row_id);
    if (row.table_name === 'records') add(records, row.row_id);
    add(items, v.item_id);
    add(items, v.goal_id);
    add(items, v.depends_on_id);
    add(collections, v.collection_id);
  }
  return { items: [...items], collections: [...collections], records: [...records] };
}
