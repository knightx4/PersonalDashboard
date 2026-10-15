import { AskInputError, matchedNote, optionalString, type AskContext, type AskToolResult } from './db';
import { LISTABLE, listableSource, sourceWorkspace } from './list-rows';

/**
 * table_info: what Dash is able to read (plan #2109.3). Asked with no table it
 * lists every table list_rows can read and what each holds; asked for one it
 * gives all the table's columns with their types and the tables it links to,
 * so a later lookup names columns the table has instead of guessing.
 *
 * The tables come from the sources catalogue (LISTABLE), the same list
 * list_rows reads, so nothing outside it is ever described. The catalogue
 * names only some of a table's columns, so the full list comes from the
 * database function public.ask_table_columns (migration 0243), which is given
 * the listable names and returns only those.
 */

export type TableColumn = { column: string; type: string; nullable: boolean };
/** A foreign key from `column` of this table to `toColumn` of `table`, both listable. */
export type TableLink = { column: string; table: string; toColumn: string };
export type TableShape = { columns: TableColumn[]; links: TableLink[] };

type Raw = {
  columns?: { table: string; column: string; type: string; nullable: boolean }[];
  links?: { table: string; column: string; ref_table: string; ref_column: string }[];
};

/**
 * The columns and foreign keys of every listable table, by table name. The
 * keys are every one between two listable tables, not only the parent each
 * table's catalogue entry declares.
 */
export async function listableShapes(ctx: AskContext): Promise<Map<string, TableShape>> {
  const names = LISTABLE.map((s) => s.table);
  const client = await ctx.db('public');
  const { data, error } = await client.rpc('ask_table_columns', { p_tables: names });
  if (error) throw new Error(`ask_table_columns: ${error.message}`);
  const raw = (data ?? {}) as Raw;
  const allowed = new Set(names);
  const out = new Map<string, TableShape>();
  for (const name of names) out.set(name, { columns: [], links: [] });
  for (const c of raw.columns ?? []) {
    out.get(c.table)?.columns.push({ column: c.column, type: c.type, nullable: c.nullable });
  }
  for (const l of raw.links ?? []) {
    if (!allowed.has(l.ref_table)) continue;
    out.get(l.table)?.links.push({ column: l.column, table: l.ref_table, toColumn: l.ref_column });
  }
  return out;
}

export async function tableInfoLookup(ctx: AskContext, input: Record<string, unknown>): Promise<AskToolResult> {
  const table = optionalString(input, 'table');
  // A table in a switched-off workspace is left out, as list_rows refuses it.
  const open = LISTABLE.filter((s) => {
    const workspace = sourceWorkspace(s);
    return !workspace || ctx.enabledModules.includes(workspace);
  });

  if (!table) {
    const tables = open.map((s) => ({ table: s.table, holds: s.holds.replace(/\.$/, ''), workspace: s.module }));
    return {
      ok: true,
      rows: [],
      totals: { tables },
      note: `${matchedNote(tables.length, tables.length)}. Ask for one table to see its columns and what it links to.`,
    };
  }

  const source = listableSource(table);
  if (!source) throw new AskInputError(`${table} is not a table Dash can read. Ask with no table for the list.`);
  if (!open.includes(source)) throw new AskInputError(`${table} is in a workspace that is switched off, so it cannot be read.`);

  const shapes = await listableShapes(ctx);
  const shape = shapes.get(table) ?? { columns: [], links: [] };
  const openNames = new Set(open.map((s) => s.table));
  const linksTo = shape.links.filter((l) => openNames.has(l.table));
  const linkedFrom = [...shapes]
    .filter(([name]) => openNames.has(name))
    .flatMap(([name, s]) =>
      s.links.filter((l) => l.table === table).map((l) => ({ table: name, column: l.column, toColumn: l.toColumn })),
    );

  return {
    ok: true,
    rows: [],
    totals: {
      table,
      holds: source.holds.replace(/\.$/, ''),
      about: source.note ?? null,
      columns: shape.columns,
      linksTo,
      linkedFrom,
    },
    note: `${table} has ${shape.columns.length} columns. linksTo are the tables this one points to; linkedFrom are the tables that point to it.`,
  };
}
