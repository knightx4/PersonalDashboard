/**
 * The part of the `postgres` client that scripts/plan.ts uses, sent over
 * HTTPS to public.service_sql (migration 0241) instead of over a Postgres
 * connection.
 *
 * A cloud session's proxy carries HTTPS and nothing else, so `postgres`
 * cannot connect from there. This takes the same tagged templates, writes
 * each value into the statement as a quoted literal, and posts the statement
 * to the REST API with the service-role key. What plan.ts calls is covered:
 * values, `sql(ids)` for `in (…)`, `sql(row)` after `insert into` or `set`,
 * `sql(name)` for an identifier, `sql.json`, `sql.unsafe` with or without
 * `$n` parameters, and `sql.end`. There are no transactions: each statement
 * commits alone, as it does through `postgres` without `sql.begin`.
 *
 * Rows come back as JSON, so a timestamp arrives as text; one in the shape
 * Postgres writes into JSON is turned back into a Date, as `postgres` gives.
 */

type Transport = (query: string, returns: boolean) => Promise<Record<string, unknown>[]>;

class Helper {
  constructor(readonly value: unknown) {}
}

class Json {
  constructor(readonly value: unknown) {}
}

/** A statement or a piece of one, sent only when awaited. */
export class HttpsQuery implements PromiseLike<Record<string, unknown>[]> {
  constructor(
    readonly text: string,
    /** The statement's own words, without the values, for telling a write from a read. */
    readonly words: string,
    private readonly transport: Transport,
  ) {}

  then<A = Record<string, unknown>[], B = never>(
    resolve?: ((rows: Record<string, unknown>[]) => A | PromiseLike<A>) | null,
    reject?: ((reason: unknown) => B | PromiseLike<B>) | null,
  ): Promise<A | B> {
    return this.transport(this.text, returnsRows(this.words)).then(resolve, reject);
  }

  catch<B = never>(reject: (reason: unknown) => B | PromiseLike<B>) {
    return this.then(undefined, reject);
  }
}

/** A Postgres string literal. Supabase runs with standard_conforming_strings on. */
export function literal(text: string): string {
  if (text.includes('\0'))
    throw new Error('A value holds a NUL character, which Postgres refuses.');
  return `'${text.replace(/'/g, "''")}'`;
}

function identifier(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

function arrayLiteral(values: readonly unknown[]): string {
  const items = values.map((item) => {
    if (item === null || item === undefined) return 'NULL';
    const text = item instanceof Date ? item.toISOString() : String(item);
    return `"${text.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  });
  return literal(`{${items.join(',')}}`);
}

/** One value as SQL. */
export function valueSql(value: unknown): string {
  if (value === null || value === undefined) return 'NULL';
  if (value instanceof Json) return `${literal(JSON.stringify(value.value))}::jsonb`;
  if (value instanceof Date) return `${literal(value.toISOString())}::timestamptz`;
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`${value} cannot be written into a statement.`);
    return String(value);
  }
  if (typeof value === 'string') return literal(value);
  if (Array.isArray(value)) return arrayLiteral(value);
  return `${literal(JSON.stringify(value))}::jsonb`;
}

/** `sql(…)` as SQL, read from the words before it as postgres does. */
function helperSql(value: unknown, before: string): string {
  if (typeof value === 'string') return identifier(value);
  if (Array.isArray(value)) {
    return value.length === 0 ? '(NULL)' : `(${value.map(valueSql).join(', ')})`;
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value).filter(([, v]) => v !== undefined);
    if (/\bset\s*$/i.test(before)) {
      return entries.map(([key, v]) => `${identifier(key)} = ${valueSql(v)}`).join(', ');
    }
    const columns = entries.map(([key]) => identifier(key)).join(', ');
    return `(${columns}) values (${entries.map(([, v]) => valueSql(v)).join(', ')})`;
  }
  throw new Error('sql() takes a name, a list or a row.');
}

/** A template and its values as one statement, and its words alone. */
export function render(
  strings: readonly string[],
  values: readonly unknown[],
): { text: string; words: string } {
  let text = strings[0];
  let words = strings[0];
  values.forEach((value, index) => {
    if (value instanceof HttpsQuery) {
      text += value.text;
      words += value.words;
    } else if (value instanceof Helper) {
      text += helperSql(value.value, text);
      words += ' _ ';
    } else {
      text += valueSql(value);
      words += ' _ ';
    }
    text += strings[index + 1];
    words += strings[index + 1];
  });
  return { text, words };
}

/** `$1`, `$2` … in a raw statement replaced by its values, outside quoted text. */
export function withParameters(query: string, values: readonly unknown[]): string {
  return query.replace(/('(?:[^']|'')*')|\$(\d+)/g, (match, quoted: string | undefined, n) =>
    quoted !== undefined ? match : valueSql(values[Number(n) - 1]),
  );
}

/** Whether a statement gives back rows: anything but a write without `returning`. */
export function returnsRows(words: string): boolean {
  const writes = /\b(?:insert\s+into|update\s+[\w."]+\s+set|delete\s+from|truncate)\b/i.test(words);
  return !writes || /\breturning\b/i.test(words);
}

const STAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?[+-]\d{2}:\d{2}$/;

/** A row as `postgres` would give it: timestamps as Dates. */
export function revive(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    out[key] = typeof value === 'string' && STAMP.test(value) ? new Date(value) : value;
  }
  return out;
}

/**
 * Post one statement to public.service_sql, or with `settings` (goals.actor
 * and the like) to public.service_sql_with (migration 0256), which makes them
 * in the statement's own transaction first.
 */
export function restTransport(url: string, key: string, settings?: Record<string, string>): Transport {
  const name = settings ? 'service_sql_with' : 'service_sql';
  const endpoint = `${url.replace(/\/$/, '')}/rest/v1/rpc/${name}`;
  return async (query, returns) => {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(
        settings
          ? { p_settings: settings, p_query: query, p_returns: returns }
          : { p_query: query, p_returns: returns },
      ),
    });
    const body = await response.text();
    if (!response.ok) {
      let message = body;
      try {
        message = (JSON.parse(body) as { message?: string }).message ?? body;
      } catch {}
      throw new Error(message);
    }
    return (JSON.parse(body) as Record<string, unknown>[]).map(revive);
  };
}

/** A client shaped like `postgres(url)` for what plan.ts uses. */
export function httpsSql(transport: Transport) {
  function sql(strings: TemplateStringsArray, ...values: unknown[]): HttpsQuery;
  function sql(value: unknown): Helper;
  function sql(first: unknown, ...values: unknown[]): HttpsQuery | Helper {
    if (Array.isArray(first) && 'raw' in (first as object)) {
      const { text, words } = render(first as unknown as readonly string[], values);
      return new HttpsQuery(text, words, transport);
    }
    return new Helper(first);
  }
  return Object.assign(sql, {
    json: (value: unknown) => new Json(value),
    unsafe: (query: string, parameters: readonly unknown[] = []) =>
      new HttpsQuery(withParameters(query, parameters), query, transport),
    end: async () => {},
  });
}
