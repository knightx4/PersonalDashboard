import { describe, expect, it } from 'vitest';
import { OWNER_ID, sqlRefusal } from './sql-guard';

describe('sqlRefusal', () => {
  it('lets a read through', () => {
    expect(sqlRefusal('select id, created_at from goals.goals')).toBeNull();
  });

  it('lets an owner-scoped insert and update through', () => {
    expect(sqlRefusal(`update goals.steps set status = 'done' where user_id = '${OWNER_ID}' and id = 4`)).toBeNull();
    expect(sqlRefusal(`insert into core.notes (user_id, body) values ('${OWNER_ID}', 'hi');`)).toBeNull();
  });

  it('lets an upsert through', () => {
    expect(
      sqlRefusal(`insert into t (user_id, k) values ('${OWNER_ID}', 1) on conflict (k) do update set k = 2`),
    ).toBeNull();
  });

  it('refuses a write that does not name the owner', () => {
    expect(sqlRefusal(`update goals.steps set status = 'done' where id = 4`)).toMatch(/scoped to the owner/);
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
      expect(sqlRefusal(statement)).toMatch(/not sent from here/);
    }
  });

  it('reads past words inside quotes and comments', () => {
    const note = `update plan_items set comment = $n$dropped; delete from it$n$ where user_id = '${OWNER_ID}'`;
    expect(sqlRefusal(note)).toBeNull();
    expect(sqlRefusal(`update t set c = 'truncate' where user_id = '${OWNER_ID}' -- drop`)).toBeNull();
  });

  it('refuses two statements in one call', () => {
    expect(sqlRefusal(`select 1; delete from goals.steps`)).toMatch(/one statement/);
    expect(sqlRefusal(`set local goals.actor = 'claude'; select 1`)).toMatch(/--set/);
  });
});
