import { describe, expect, it } from 'vitest';
import { THREAD_TABLES, threadRef, threadSubject, type ThreadTarget } from './subjects';

const ID = '00000000-0000-4000-8000-000000000001';

describe('thread subjects', () => {
  it('reads back the target and row of every ref it writes', () => {
    for (const target of Object.keys(THREAD_TABLES) as ThreadTarget[]) {
      const ref = threadRef(target, ID);
      expect(threadSubject(ref)).toEqual({ ref, table: THREAD_TABLES[target], target, id: ID });
    }
  });

  it('names a step by the table core.conversations keys it under', () => {
    expect(threadRef('step', ID)).toBe(`public.plan_items:${ID}`);
    expect(threadRef('goal', ID)).toBe(`goals.items:${ID}`);
  });

  it('keys the rows of plan #1471 by their own tables', () => {
    expect(threadRef('task', ID)).toBe(`todo.tasks:${ID}`);
    expect(threadRef('order', ID)).toBe(`public.orders:${ID}`);
    expect(threadRef('item', ID)).toBe(`public.inventory_items:${ID}`);
    // The same ref a discussion on Quick read writes under (lib/news/quick/discuss.ts).
    expect(threadRef('story', ID)).toBe(`news.saved_stories:${ID}`);
    // A vault note by its id, never its path.
    expect(threadRef('vault_note', ID)).toBe(`obsidian.notes:${ID}`);
  });

  it('has nothing for a malformed ref or a table with no thread yet', () => {
    expect(threadSubject('public.plan_items')).toBeNull();
    expect(threadSubject('public.plan_items:')).toBeNull();
    expect(threadSubject(`public.shipments:${ID}`)).toBeNull();
  });
});
