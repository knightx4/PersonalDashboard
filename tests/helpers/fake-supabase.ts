/**
 * A stand-in for the PostgREST client, small enough to read.
 *
 * The sweep talks to Supabase over HTTP, so there is no local Postgres it can
 * be pointed at -- `npm run db:reset` builds the database, not the API in front
 * of it. Mocking the whole client away would leave the rules untested; this
 * instead implements the handful of builder methods the sweep actually uses
 * (`select`, `eq`, `in`, `is`, `not`, `lt`, `gt`, `order`, `limit`, `insert`)
 * against rows held in memory, which is enough to ask what a rule does with a
 * given day's data.
 *
 * It also records every (table, column) pair a query names, in filters and in
 * the select list alike. That list is what tests/jobs-sweep.test.ts checks
 * against the real schema: PostgREST rejects a query naming a column that is
 * not there, and a rule filtering on a dropped column is exactly the failure
 * this helper exists to make visible.
 *
 * Timestamps are compared as strings, which is correct for the ISO-8601 UTC
 * values the app writes and reads, and is not correct for anything else.
 */

export type Touch = { table: string; column: string };
export type Row = Record<string, unknown>;
export type Insert = { table: string; row: Row };
export type Failure = { message: string; code?: string };

export type FakeOptions = {
  /** Rows the reads see, by table. A table absent here reads as empty. */
  tables?: Record<string, Row[]>;
  /** RPC results, by function name. Anything unlisted returns 0. */
  rpc?: Record<string, unknown>;
  /** Make a table's reads fail, the way a bad column name does. */
  failRead?: (table: string) => Failure | null;
  /** Make a write fail -- a duplicate rule_key, or something worse. */
  failWrite?: (table: string, row: Row) => Failure | null;
};

export type FakeSupabase = {
  client: unknown;
  /** Every column named by a query, in the order they were named. */
  touched: Touch[];
  /** Every row the sweep tried to write. */
  inserted: Insert[];
};

/** Split a select list on commas that are not inside an embed's parentheses. */
function splitTopLevel(list: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (const character of list) {
    if (character === '(') depth += 1;
    if (character === ')') depth -= 1;
    if (character === ',' && depth === 0) {
      parts.push(current);
      current = '';
      continue;
    }
    current += character;
  }
  parts.push(current);
  return parts.map((part) => part.trim()).filter(Boolean);
}

/**
 * `id, user_id, roles!inner ( title, companies!inner ( name ) )` selected from
 * `applications` names three tables, and a column on each of them.
 */
function selectedColumns(table: string, list: string, into: Touch[]): void {
  for (const part of splitTopLevel(list)) {
    const open = part.indexOf('(');
    if (open === -1) {
      if (part !== '*') into.push({ table, column: part });
      continue;
    }
    const embedded = part.slice(0, open).split('!')[0].trim();
    selectedColumns(embedded, part.slice(open + 1, part.lastIndexOf(')')), into);
  }
}

type Predicate = (row: Row) => boolean;

class Query implements PromiseLike<{ data: Row[] | null; error: Failure | null }> {
  private readonly predicates: Predicate[] = [];
  private cap = Infinity;

  constructor(
    private readonly table: string,
    private readonly rows: Row[],
    private readonly touched: Touch[],
    private readonly failure: Failure | null,
  ) {}

  private note(column: string): this {
    this.touched.push({ table: this.table, column });
    return this;
  }

  select(list: string): this {
    selectedColumns(this.table, list, this.touched);
    return this;
  }

  eq(column: string, value: unknown): this {
    this.predicates.push((row) => row[column] === value);
    return this.note(column);
  }

  in(column: string, values: unknown[]): this {
    this.predicates.push((row) => values.includes(row[column]));
    return this.note(column);
  }

  is(column: string, value: unknown): this {
    this.predicates.push((row) => (row[column] ?? null) === value);
    return this.note(column);
  }

  not(column: string, operator: string, value: unknown): this {
    if (operator !== 'is') throw new Error(`fake supabase: not(${operator}) is not implemented`);
    this.predicates.push((row) => (row[column] ?? null) !== value);
    return this.note(column);
  }

  lt(column: string, value: string): this {
    this.predicates.push((row) => row[column] != null && String(row[column]) < value);
    return this.note(column);
  }

  gt(column: string, value: string): this {
    this.predicates.push((row) => row[column] != null && String(row[column]) > value);
    return this.note(column);
  }

  order(column: string, options?: { ascending?: boolean }): this {
    const ascending = options?.ascending ?? true;
    const sorted = [...this.rows].sort((a, b) =>
      String(a[column] ?? '').localeCompare(String(b[column] ?? '')),
    );
    if (!ascending) sorted.reverse();
    this.rows.length = 0;
    this.rows.push(...sorted);
    return this.note(column);
  }

  limit(count: number): this {
    this.cap = count;
    return this;
  }

  then<TResult1 = { data: Row[] | null; error: Failure | null }, TResult2 = never>(
    onfulfilled?:
      | ((value: { data: Row[] | null; error: Failure | null }) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    const result = this.failure
      ? { data: null, error: this.failure }
      : {
          data: this.rows.filter((row) => this.predicates.every((p) => p(row))).slice(0, this.cap),
          error: null,
        };
    return Promise.resolve(result).then(onfulfilled, onrejected);
  }
}

export function fakeSupabase(options: FakeOptions = {}): FakeSupabase {
  const touched: Touch[] = [];
  const inserted: Insert[] = [];

  const client = {
    rpc: async (name: string) => ({ data: options.rpc?.[name] ?? 0, error: null }),
    from: (table: string) => ({
      select: (list: string) =>
        new Query(
          table,
          [...(options.tables?.[table] ?? [])],
          touched,
          options.failRead?.(table) ?? null,
        ).select(list),
      insert: (row: Row) => {
        inserted.push({ table, row });
        return Promise.resolve({ error: options.failWrite?.(table, row) ?? null });
      },
    }),
  };

  return { client, touched, inserted };
}
