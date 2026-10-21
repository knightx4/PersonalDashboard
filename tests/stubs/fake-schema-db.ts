import type { AskSchema, SchemaClient } from '@/lib/ask/db';
import { APPLICATION_CHILDREN, ROLE_CHILDREN } from '@/lib/dash/jobs-writes';

/**
 * An in-memory stand-in for the person's Supabase clients, one per schema,
 * all sharing one set of tables keyed `schema.table`.
 *
 * Enough of the query builder for code that reads a row, writes one and
 * reads it back: select, insert, upsert (on its conflict columns, `id` by
 * default, merging or with ignoreDuplicates leaving the row alone and
 * returning nothing for it), update and delete, the filters eq, neq, gt,
 * gte, lt, is, ilike (without wildcards), in, not (is null) and or (of eq,
 * neq and is null), order, limit, single and maybeSingle. Every query returns whole
 * rows whatever columns it selected. An insert without an id gets one, and a
 * created_at, so a writer that asks for its new row's id gets one back; an
 * insert with one is kept exactly as given.
 *
 * The shared thread store (lib/thread/store.ts) is there too: `schema(name)`
 * hands back that schema's client, core.thread_turns is the same list as
 * core.conversation_turns (a thread's turns carry `ref` and `author`), `like`
 * matches a trailing `%`, and `rpc('add_thread_turn', ...)` adds a turn,
 * starting the row's conversation in core.conversations when it has none.
 *
 * `rpc('merge_roles', ...)` on job_search folds roles as the function in
 * migration 0058 does: the rows on each other application, then on each
 * merged role, move onto the ones kept by the foreign keys the lists in
 * lib/dash/jobs-writes.ts record (tests/merge-children-jobs.test.ts holds
 * those to the database), a row whose twin is already there under a unique
 * key is taken out, and the merged applications and roles are deleted.
 */

type Row = Record<string, unknown>;
export type FakeTables = Record<string, Row[]>;

let made = 0;

/** A fresh uuid-shaped id, distinct within the run. */
export function fakeId(): string {
  made += 1;
  return `00000000-0000-4000-9000-${String(made).padStart(12, '0')}`;
}

export function fakeSchemaDb(tables: FakeTables, now = '2026-10-03T08:00:00Z') {
  return function client(schema: string): SchemaClient {
    return {
      schema: (name: string) => client(name),
      rpc(name: string, args: Row) {
        if (schema === 'core' && name === 'acknowledge_thread_turn') {
          // Only the person's own comment under that row takes the mark.
          const conversation = (tables['core.conversations'] ?? []).find(
            (c) => c.user_id === args.p_user_id && c.subject_kind === 'row' && c.subject_ref === args.p_ref,
          );
          const turn = (tables['core.conversation_turns'] ?? []).find(
            (t) =>
              t.id === args.p_turn &&
              t.user_id === args.p_user_id &&
              t.role === 'user' &&
              conversation !== undefined &&
              t.conversation_id === conversation.id,
          );
          if (!turn) {
            return Promise.resolve({
              data: null,
              error: { message: `acknowledge_thread_turn: ${String(args.p_turn)} is not a comment of yours under ${String(args.p_ref)}` },
            });
          }
          turn.acknowledged_at ??= now;
          return Promise.resolve({ data: turn.acknowledged_at, error: null });
        }
        if (schema === 'job_search' && name === 'merge_roles') return Promise.resolve(mergeRoles(tables, args));
        if (schema !== 'core' || name !== 'add_thread_turn') {
          return Promise.resolve({ data: null, error: { message: `no function ${schema}.${name}` } });
        }
        // One conversation per account and row, as core.conversations keeps.
        const conversations = (tables['core.conversations'] ??= []);
        let conversation = conversations.find(
          (c) => c.user_id === args.p_user_id && c.subject_kind === 'row' && c.subject_ref === args.p_ref,
        );
        if (!conversation) {
          conversation = { id: fakeId(), user_id: args.p_user_id, subject_kind: 'row', subject_ref: args.p_ref, created_at: now };
          conversations.push(conversation);
        }
        const row = {
          id: fakeId(),
          conversation_id: conversation.id,
          user_id: args.p_user_id,
          ref: args.p_ref,
          author: args.p_author,
          role: args.p_author === 'me' ? 'user' : 'assistant',
          body: args.p_body,
          created_at: now,
        };
        (tables['core.conversation_turns'] ??= []).push(row);
        return Promise.resolve({ data: row.id, error: null });
      },
      from(table: string) {
        const key = schema === 'core' && table === 'thread_turns' ? 'core.conversation_turns' : `${schema}.${table}`;
        const rows = (tables[key] ??= []);
        const filters: ((row: Row) => boolean)[] = [];
        let op: 'select' | 'insert' | 'upsert' | 'update' | 'delete' = 'select';
        let conflict = { columns: ['id'], ignore: false };
        let payload: Row[] = [];
        let patch: Row = {};
        let limit = Infinity;
        let single: 'one' | 'maybe' | null = null;
        let order: { column: string; ascending: boolean } | null = null;

        function run() {
          let out: Row[];
          if (op === 'upsert') {
            out = [];
            for (const value of payload) {
              const found = rows.find((r) => conflict.columns.every((c) => c in value && r[c] === value[c]));
              if (found) {
                if (conflict.ignore) continue;
                Object.assign(found, value);
                out.push(found);
              } else {
                const row = { id: fakeId(), created_at: now, ...value };
                rows.push(row);
                out.push(row);
              }
            }
          } else if (op === 'insert') {
            out = [];
            for (const value of payload) {
              // A row given its own id is one being put back as it was.
              const row = 'id' in value ? { ...value } : { id: fakeId(), created_at: now, ...value };
              if (rows.some((r) => r.id === row.id)) {
                return { data: null, error: { message: 'duplicate key' } };
              }
              rows.push(row);
              out.push(row);
            }
          } else {
            out = rows.filter((row) => filters.every((f) => f(row)));
            if (order) {
              const { column, ascending } = order;
              out = [...out].sort((a, b) => {
                const x = String(a[column] ?? '');
                const y = String(b[column] ?? '');
                return (x < y ? -1 : x > y ? 1 : 0) * (ascending ? 1 : -1);
              });
            }
            if (op === 'update') for (const row of out) Object.assign(row, patch);
            if (op === 'delete') for (const row of out) rows.splice(rows.indexOf(row), 1);
          }
          out = out.slice(0, limit).map((row) => ({ ...row }));
          if (single === 'one') {
            return out.length === 1
              ? { data: out[0], error: null }
              : { data: null, error: { message: 'expected one row' } };
          }
          if (single === 'maybe') return { data: out[0] ?? null, error: null };
          return { data: out, error: null };
        }

        const query = {
          select: () => query,
          insert: (value: Row | Row[]) => (
            (op = 'insert'), (payload = Array.isArray(value) ? value : [value]), query
          ),
          upsert: (value: Row | Row[], opts: { onConflict?: string; ignoreDuplicates?: boolean } = {}) => (
            (op = 'upsert'),
            (payload = Array.isArray(value) ? value : [value]),
            (conflict = {
              columns: (opts.onConflict ?? 'id').split(',').map((c) => c.trim()),
              ignore: opts.ignoreDuplicates ?? false,
            }),
            query
          ),
          update: (value: Row) => ((op = 'update'), (patch = value), query),
          delete: () => ((op = 'delete'), query),
          eq: (c: string, v: unknown) => (filters.push((r) => r[c] === v), query),
          neq: (c: string, v: unknown) => (filters.push((r) => r[c] !== v), query),
          gt: (c: string, v: string) => (filters.push((r) => String(r[c]) > v), query),
          gte: (c: string, v: string) => (filters.push((r) => r[c] != null && String(r[c]) >= v), query),
          lt: (c: string, v: string) => (filters.push((r) => r[c] != null && String(r[c]) < v), query),
          is: (c: string, v: unknown) => (filters.push((r) => (r[c] ?? null) === v), query),
          ilike: (c: string, v: string) => (
            filters.push((r) => typeof r[c] === 'string' && (r[c] as string).toLowerCase() === v.toLowerCase()), query
          ),
          in: (c: string, vs: unknown[]) => (filters.push((r) => vs.includes(r[c])), query),
          like: (c: string, v: string) => (
            filters.push((r) => typeof r[c] === 'string' && (r[c] as string).startsWith(v.replace(/%$/, ''))), query
          ),
          not: (c: string) => (filters.push((r) => (r[c] ?? null) !== null), query),
          or: (spec: string) => {
            const parts = spec.split(',').map((part) => part.split('.'));
            filters.push((r) =>
              parts.some(([c, operator, v]) =>
                operator === 'is' ? (r[c] ?? null) === null : operator === 'neq' ? r[c] !== v : r[c] === v,
              ),
            );
            return query;
          },
          order: (column: string, opts: { ascending?: boolean } = {}) => (
            (order = { column, ascending: opts.ascending ?? true }), query
          ),
          limit: (n: number) => ((limit = n), query),
          single: () => ((single = 'one'), query),
          maybeSingle: () => ((single = 'maybe'), query),
          then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) => {
            try {
              return Promise.resolve(resolve(run()));
            } catch (error) {
              return reject ? Promise.resolve(reject(error)) : Promise.reject(error);
            }
          },
        };
        return query;
      },
    } as unknown as SchemaClient;
  };
}

type Key = { table: string; column: string; unique: string | null };

/** job_search.move_children: repoint rows from one parent to another, taking out a row whose twin is there. */
function moveChildren(tables: FakeTables, keys: readonly Key[], from: string, to: string): number {
  let moved = 0;
  for (const key of keys) {
    const rows = tables[key.table] ?? [];
    for (const row of rows.filter((r) => r[key.column] === from)) {
      const value = key.unique ? row[key.unique] : null;
      const twin =
        key.unique !== null &&
        value !== null &&
        value !== undefined &&
        rows.some((r) => r !== row && r[key.column] === to && r[key.unique as string] === value);
      if (twin) rows.splice(rows.indexOf(row), 1);
      else {
        row[key.column] = to;
        moved += 1;
      }
    }
  }
  return moved;
}

/** job_search.merge_roles, as migration 0058 writes it. */
function mergeRoles(tables: FakeTables, args: Row): { data: unknown; error: { message: string; code: string } | null } {
  const refuse = (message: string, code = '22023') => ({ data: null, error: { message, code } });
  const keep = args.p_keep_role as string;
  const merged = [...new Set(((args.p_merge_roles as string[] | null) ?? []).filter(Boolean))];
  if (merged.length === 0) return refuse('Pick the roles to merge in.');
  if (merged.includes(keep)) return refuse('Pick a different role to merge into.');
  const roles = (tables['job_search.roles'] ??= []);
  const kept = roles.find((r) => r.id === keep);
  if (!kept || roles.filter((r) => merged.includes(r.id as string)).length !== merged.length) {
    return refuse('One of those roles no longer exists.', 'P0002');
  }
  if (roles.some((r) => merged.includes(r.id as string) && (r.company_id !== kept.company_id || r.user_id !== kept.user_id))) {
    return refuse('Roles can only be merged within the same company.');
  }
  const refs = merged.map((id) => `job_search.roles:${id}`);
  if ((tables['core.conversation_turns'] ?? []).some((t) => refs.includes(t.ref as string))) {
    return refuse('One of those roles has comments in its thread, which a merge would leave behind. Keep that role instead.');
  }

  let moved = 0;
  const apps = (tables['job_search.applications'] ??= []);
  const all = [...merged, keep];
  if (apps.some((a) => all.includes(a.role_id as string))) {
    const target = apps.find((a) => a.id === args.p_keep_application && all.includes(a.role_id as string));
    if (!target) return refuse("Name the application to keep, one of those roles'.");
    let override: unknown = null;
    for (const app of apps.filter((a) => all.includes(a.role_id as string) && a !== target)) {
      moved += moveChildren(tables, APPLICATION_CHILDREN, app.id as string, target.id as string);
      if ((target.status_manual_override ?? null) === null && override === null) override = app.status_manual_override ?? null;
      apps.splice(apps.indexOf(app), 1);
    }
    target.role_id = keep;
    target.attempt = 1;
    target.status_manual_override = target.status_manual_override ?? override;
  }
  // Every key to a role but the applications', the old thread notes' included.
  const roleKeys: Key[] = [...ROLE_CHILDREN, { table: 'job_search.notes', column: 'role_id', unique: null }];
  for (const id of merged) {
    moved += moveChildren(tables, roleKeys, id, keep);
    roles.splice(roles.findIndex((r) => r.id === id), 1);
  }
  return { data: { kept: keep, merged: merged.length, moved }, error: null };
}

/** The deps recordDashAction and undoDashAction take, over the same tables. */
export function fakeDashDeps(tables: FakeTables, userId: string, now = '2026-10-03T12:00:00Z') {
  const client = fakeSchemaDb(tables);
  return {
    userId,
    core: client('core'),
    db: async (schema: AskSchema) => client(schema),
    now: () => now,
  };
}
