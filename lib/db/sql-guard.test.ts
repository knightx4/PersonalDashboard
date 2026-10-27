import { describe, expect, it } from 'vitest';
import { sqlRefusal, withOwner } from './sql-guard';

const OWNER_ID = '11111111-2222-3333-4444-555555555555';
const refuse = (statement: string) => sqlRefusal(statement, OWNER_ID);

describe('sqlRefusal', () => {
  it('lets a read through', () => {
    expect(refuse('select id, created_at from goals.goals')).toBeNull();
  });

  it('lets an owner-scoped insert and update through', () => {
    expect(
      refuse(`update goals.steps set status = 'done' where user_id = '${OWNER_ID}' and id = 4`),
    ).toBeNull();
    expect(
      refuse(`insert into core.notes (user_id, body) values ('${OWNER_ID}', 'hi');`),
    ).toBeNull();
  });

  it('lets an upsert through', () => {
    expect(
      refuse(
        `insert into t (user_id, k) values ('${OWNER_ID}', 1) on conflict (k) do update set k = 2`,
      ),
    ).toBeNull();
  });

  it('refuses a write that does not name the owner', () => {
    expect(refuse(`update goals.steps set status = 'done' where id = 4`)).toMatch(
      /scoped to the owner/,
    );
  });

  it('refuses deletes and schema changes', () => {
    for (const statement of [
      `delete from goals.steps where user_id = '${OWNER_ID}'`,
      `with gone as (delete from goals.steps where user_id = '${OWNER_ID}' returning id) select * from gone`,
      'truncate goals.steps',
      'drop table goals.steps',
      'alter table goals.steps add column x int',
      'create table x (id int)',
      'grant all on goals.steps to anon',
      `do $$ begin delete from goals.steps; end $$`,
    ]) {
      expect(refuse(statement)).toMatch(/not sent from here/);
    }
  });

  it('reads past words inside quotes and comments', () => {
    const note = `update plan_items set comment = $n$dropped; delete from it$n$ where user_id = '${OWNER_ID}'`;
    expect(refuse(note)).toBeNull();
    expect(refuse(`update t set c = 'truncate' where user_id = '${OWNER_ID}' -- drop`)).toBeNull();
  });

  it('refuses two statements in one call', () => {
    expect(refuse(`select 1; delete from goals.steps`)).toMatch(/one statement/);
    expect(refuse(`set local goals.actor = 'claude'; select 1`)).toMatch(/--set/);
  });
});

describe('withOwner', () => {
  it('puts the owner in for :owner, quoted or not, and leaves casts alone', () => {
    expect(withOwner('update t set c = 1::int where user_id = :owner', OWNER_ID)).toBe(
      `update t set c = 1::int where user_id = '${OWNER_ID}'`,
    );
    expect(withOwner("insert into t (user_id) values (':owner')", OWNER_ID)).toBe(
      `insert into t (user_id) values ('${OWNER_ID}')`,
    );
    expect(withOwner('select x::owner_kind from t', OWNER_ID)).toBe('select x::owner_kind from t');
  });

  it('refuses every write while no owner is set', () => {
    expect(sqlRefusal("update t set c = 1 where user_id = 'x'", null)).toMatch(/No owner is set/);
    expect(sqlRefusal('select 1', null)).toBeNull();
  });
});
