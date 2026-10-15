import { parseRef, readRowsWith, refTitles, type RefTarget } from '@/lib/core/refs';
import { pageFor, sourceFor, sourceParent } from '@/lib/sources/catalogue';
import type { Source } from '@/lib/sources/types';
import { clip, type AskContext, type AskParent, type AskRow, type AskSchema } from './db';
import { ownerColumn, SCHEMAS } from './list-rows';

/**
 * Each row a lookup returns names the row it belongs to (plan #2109.2): a
 * cover letter its application, an interview its application, a Learn card
 * note its idea. Without it Dash read a child row with nothing to say whose
 * it was, and had to open each one to find out.
 *
 * The parent is the one the table's catalogue entry declares (Source.parent,
 * or its page's parent), so it is the same row the breadcrumb walks to. This
 * reads it after the lookup, for every lookup at once: one read per child
 * table for the parent's key, filtered to the person by the table's owner
 * column, then one per parent table for the title and link, which row level
 * security scopes. A table tied to its owner only through a join is left
 * alone, since its read could not be filtered to the person.
 */

/** Characters kept of a parent's title when it has no page to name it. */
const TITLE_CHARS = 120;

type Readable = { source: Source; schema: AskSchema; name: string; owner: string };

function readable(table: string): Readable | null {
  const source = sourceFor(table);
  if (!source) return null;
  const [schema, name] = table.split('.');
  const owner = ownerColumn(source);
  if (!owner || !name || !SCHEMAS.has(schema)) return null;
  return { source, schema: schema as AskSchema, name, owner };
}

/** The rows, each with `parent` set where its table declares one and the parent could be read. */
export async function withParents(ctx: AskContext, rows: readonly AskRow[]): Promise<AskRow[]> {
  const wanted = new Map<string, Set<string>>();
  for (const row of rows) {
    if (row.parent || !row.ref || !sourceParent(row.table) || !readable(row.table)) continue;
    const refs = wanted.get(row.table) ?? new Set<string>();
    refs.add(row.ref);
    wanted.set(row.table, refs);
  }
  if (wanted.size === 0) return [...rows];

  // `schema.table:ref` of each child row, to the parent's ref.
  const parentOf = new Map<string, string>();
  await Promise.all(
    [...wanted].map(async ([table, refs]) => {
      const { source, schema, name, owner } = readable(table) as Readable;
      const parent = sourceParent(table)!;
      const key = source.ref ?? 'id';
      const client = await ctx.db(schema);
      const { data, error } = await client
        .from(name)
        .select([...new Set([key, ...parent.reads])].join(', '))
        .eq(owner, ctx.userId)
        .in(key, [...refs]);
      if (error) throw new Error(`${table}: ${error.message}`);
      for (const row of (data ?? []) as unknown as Record<string, unknown>[]) {
        const ref = parent.ref(row);
        if (ref && parseRef(ref)) parentOf.set(`${table}:${String(row[key])}`, ref);
      }
    }),
  );

  const resolved = await resolveParents(ctx, [...new Set(parentOf.values())]);
  return rows.map((row) => {
    const ref = parentOf.get(`${row.table}:${row.ref}`);
    const parent = ref ? resolved.get(ref) : undefined;
    return parent ? { ...row, parent } : row;
  });
}

/**
 * Titles and links for parent refs. A table with a page is named the way a
 * ref is anywhere in the app (refTitles); one without is named by its
 * catalogue title column. A parent that cannot be read is left out.
 */
async function resolveParents(ctx: AskContext, refs: readonly string[]): Promise<Map<string, AskParent>> {
  const out = new Map<string, AskParent>();
  const paged = refs.filter((ref) => pageFor(parseRef(ref)!.table));
  const read = readRowsWith(ctx.db);
  const titled = await refTitles(paged, read);
  // A row the path walks past (an application) is known by the row above it
  // (its role), so it is named and linked by that row, as the breadcrumb does.
  const through = [...titled.values()].flatMap((t) =>
    !t.missing && t.parent && pageFor(t.table)?.page.passThrough ? [t.parent] : [],
  );
  const above = through.length > 0 ? await refTitles(through, read) : new Map<string, RefTarget>();
  for (const [ref, target] of titled) {
    if (target.missing) continue;
    const by = target.parent ? above.get(target.parent) : undefined;
    const named = by && !by.missing ? by : target;
    out.set(ref, { table: target.table, ref: target.id, title: named.title, href: named.href ?? target.href });
  }

  const unpaged = new Map<string, string[]>();
  for (const ref of refs) {
    const parsed = parseRef(ref)!;
    if (pageFor(parsed.table)) continue;
    unpaged.set(parsed.table, [...(unpaged.get(parsed.table) ?? []), parsed.id]);
  }
  await Promise.all(
    [...unpaged].map(async ([table, ids]) => {
      const found = readable(table);
      if (!found) return;
      const { source, schema, name, owner } = found;
      const client = await ctx.db(schema);
      const { data, error } = await client
        .from(name)
        .select([...new Set(['id', source.title])].join(', '))
        .eq(owner, ctx.userId)
        .in('id', ids);
      if (error) throw new Error(`${table}: ${error.message}`);
      for (const row of (data ?? []) as unknown as Record<string, unknown>[]) {
        const id = String(row.id);
        const raw = row[source.title];
        const title = clip(typeof raw === 'string' ? raw.split(/\r?\n/)[0] : raw == null ? null : String(raw), TITLE_CHARS);
        out.set(`${table}:${id}`, { table, ref: id, title: title ?? 'Untitled', href: null });
      }
    }),
  );
  return out;
}
