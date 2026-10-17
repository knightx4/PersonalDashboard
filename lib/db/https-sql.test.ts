import { describe, expect, it } from 'vitest';
import { httpsSql, literal, render, returnsRows, revive, withParameters } from './https-sql';

type Sent = { query: string; returns: boolean };

function client() {
  const sent: Sent[] = [];
  const sql = httpsSql(async (query, returns) => {
    sent.push({ query, returns });
    return [];
  });
  return { sql, sent };
}

describe('https-sql', () => {
  it('writes values in as literals, doubling quotes', async () => {
    const { sql, sent } = client();
    await sql`select * from ideas where body = ${"it's"} and n = ${3} and ok = ${true} and gone = ${null}`;
    expect(sent[0].query).toBe(
      "select * from ideas where body = 'it''s' and n = 3 and ok = true and gone = NULL",
    );
    expect(sent[0].returns).toBe(true);
  });

  it('does not take a value for SQL', () => {
    expect(literal("'; drop table plan_items; --")).toBe("'''; drop table plan_items; --'");
    expect(() => literal('a\0b')).toThrow();
  });

  it('writes a list for in (…), and an empty one that matches nothing', async () => {
    const { sql, sent } = client();
    await sql`select 1 from plan_runs where id in ${sql(['a', 'b'])}`;
    await sql`select 1 from plan_runs where id in ${sql([])}`;
    expect(sent[0].query).toBe("select 1 from plan_runs where id in ('a', 'b')");
    expect(sent[1].query).toBe('select 1 from plan_runs where id in (NULL)');
  });

  it('writes a row after insert into, and columns after set', async () => {
    const { sql, sent } = client();
    await sql`insert into core.model_spend ${sql({ user_id: 'u', cost: 2, skip: undefined })}`;
    await sql`update plan_runs set ${sql({ status: 'failed', note: null })} where id = ${'r'}`;
    expect(sent[0].query).toBe(`insert into core.model_spend ("user_id", "cost") values ('u', 2)`);
    expect(sent[0].returns).toBe(false);
    expect(sent[1].query).toBe(
      `update plan_runs set "status" = 'failed', "note" = NULL where id = 'r'`,
    );
  });

  it('writes JSON, dates and arrays as typed literals', async () => {
    const { sql, sent } = client();
    await sql`select ${sql.json({ a: "b'c" })}, ${new Date('2026-10-15T01:00:00Z')}, ${['x', 'y"z']}`;
    expect(sent[0].query).toBe(
      `select '{"a":"b''c"}'::jsonb, '2026-10-15T01:00:00.000Z'::timestamptz, '{"x","y\\"z"}'`,
    );
  });

  it('puts an unsafe piece in as written, and fills $n outside quotes', async () => {
    const { sql, sent } = client();
    await sql`select ${sql.unsafe('id, body')} from ideas where user_id = ${'u'}`;
    await sql.unsafe("select '$1' as kept, body from ideas where user_id = $1", ["o'k"]);
    expect(sent[0].query).toBe("select id, body from ideas where user_id = 'u'");
    expect(sent[1].query).toBe("select '$1' as kept, body from ideas where user_id = 'o''k'");
    expect(withParameters('$2 $1', [1, 2])).toBe('2 1');
  });

  it('tells a write from a read by its own words, not its values', () => {
    expect(returnsRows('update plan_items set status = _ where id = _')).toBe(false);
    expect(returnsRows('update plan_items set status = _ returning number')).toBe(true);
    expect(
      returnsRows(
        'with recursive tree as (select id from plan_items) update plan_items set x = 1 returning number',
      ),
    ).toBe(true);
    expect(returnsRows('select id from chain')).toBe(true);
    const { words } = render(['select ', ''], ['delete from plan_items']);
    expect(returnsRows(words)).toBe(true);
  });

  it('gives timestamps back as Dates and leaves other text alone', () => {
    const row = revive({
      created_at: '2026-10-15T01:19:12.646097+00:00',
      body: '2026-10-15',
      n: 4,
    });
    expect(row.created_at).toBeInstanceOf(Date);
    expect((row.created_at as Date).toISOString()).toBe('2026-10-15T01:19:12.646Z');
    expect(row.body).toBe('2026-10-15');
    expect(row.n).toBe(4);
  });

  it('sends nothing until a statement is awaited', async () => {
    const { sql, sent } = client();
    const piece = sql.unsafe('id');
    expect(sent).toHaveLength(0);
    await sql`select ${piece} from ideas`.catch(() => {});
    expect(sent).toHaveLength(1);
  });
});
