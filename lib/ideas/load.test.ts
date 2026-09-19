import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  FILED_IDEAS_SQL,
  IDEA_COLUMNS,
  ideaListFrom,
  ideaRowFrom,
  loadFiledIdeas,
} from '@/lib/ideas/load';

const idea = (over: {
  id: string;
  source?: string;
  dismissed_at?: string | null;
  plan_item?: { id: string; number: number; title: string; status: string } | null;
  from_plan_item?: { number: number; title: string } | null;
}) => ({
  id: over.id,
  body: `idea ${over.id}`,
  module: 'dev',
  created_at: '2026-09-12T09:00:00Z',
  source: over.source ?? 'me',
  dismissed_at: over.dismissed_at ?? null,
  plan_item: over.plan_item ?? null,
  from_plan_item: over.from_plan_item ?? null,
});

describe('the ideas list', () => {
  it('keeps suggestions out of your own list', () => {
    const list = ideaListFrom(
      [idea({ id: 'mine' }), idea({ id: 'suggested', source: 'claude' })].map(ideaRowFrom),
    );

    expect(list.mine.map((row) => row.id)).toEqual(['mine']);
    expect(list.suggested.map((row) => row.id)).toEqual(['suggested']);
  });

  it('takes a dismissed idea out of every live pile', () => {
    const list = ideaListFrom(
      [
        idea({ id: 'put-aside', source: 'claude', dismissed_at: '2026-09-13T09:00:00Z' }),
        idea({
          id: 'dismissed-but-shaped',
          dismissed_at: '2026-09-13T09:00:00Z',
          plan_item: { id: 'a', number: 12, title: 'A feature', status: 'proposed' },
        }),
      ].map(ideaRowFrom),
    );

    expect(list.dismissed.map((row) => row.id)).toEqual(['put-aside', 'dismissed-but-shaped']);
    expect(list.suggested).toEqual([]);
    expect(list.shaped).toEqual([]);
    expect(list.mine).toEqual([]);
  });

  it('moves a shaped idea out of the pile it was in', () => {
    const list = ideaListFrom(
      [
        idea({
          id: 'shaped',
          source: 'claude',
          plan_item: { id: 'a', number: 12, title: 'A feature', status: 'proposed' },
        }),
      ].map(ideaRowFrom),
    );

    expect(list.shaped.map((row) => row.id)).toEqual(['shaped']);
    expect(list.suggested).toEqual([]);
  });

  it('reads the feature a suggestion came out of', () => {
    const [row] = [
      idea({
        id: 'suggested',
        source: 'claude',
        from_plan_item: { number: 338, title: 'Talk back to Claude inside the app' },
      }),
    ].map(ideaRowFrom);

    expect(row.from).toEqual({ number: 338, title: 'Talk back to Claude inside the app' });
  });

  it('reads an unknown source as yours', () => {
    const [row] = [idea({ id: 'odd', source: 'somebody-else' })].map(ideaRowFrom);

    expect(row.source).toBe('me');
  });

  it('selects the dismissal, so the page can tell a live idea from a put-aside one', () => {
    expect(IDEA_COLUMNS).toContain('dismissed_at');
  });
});

/**
 * The read a new idea is compared against, as the filters it asks the
 * database for. What it must not ask for is a dismissed_at filter: #646
 * settled that an idea you put aside is still compared against, and leaving
 * it out of the set is what made the same suggestion come back every morning.
 */
describe('the list a new idea is checked against', () => {
  function stubClient(rows: ReadonlyArray<{ id: string; body: string }>) {
    const filters: Array<[string, unknown]> = [];
    const read = {
      select: () => read,
      eq: (column: string, value: unknown) => {
        filters.push([column, value]);
        return read;
      },
      is: (column: string, value: unknown) => {
        filters.push([column, value]);
        return read;
      },
      order: () => read,
      then: (resolve: (value: { data: unknown; error: null }) => unknown) =>
        resolve({ data: rows.map((row) => ({ ...row })), error: null }),
    };
    return {
      filters,
      supabase: { from: () => ({ select: () => read }) } as unknown as SupabaseClient,
    };
  }

  it('asks for the account and for ideas not shaped into the plan, and for nothing else', async () => {
    const { supabase, filters } = stubClient([]);

    await loadFiledIdeas(supabase, 'user-1');

    expect(filters).toEqual([
      ['user_id', 'user-1'],
      ['plan_item_id', null],
    ]);
  });

  it('reads the body and id of each one, which is what a refusal names', async () => {
    const { supabase } = stubClient([{ id: 'filed-1', body: 'Sort the ideas page by module' }]);

    await expect(loadFiledIdeas(supabase, 'user-1')).resolves.toEqual([
      { id: 'filed-1', body: 'Sort the ideas page by module' },
    ]);
  });

  /**
   * scripts/plan.ts reads the same set over a direct connection, so the
   * statement it runs is checked against the same rule.
   */
  it('selects the same set for the command line', () => {
    expect(FILED_IDEAS_SQL).toContain('plan_item_id is null');
    expect(FILED_IDEAS_SQL).toContain('user_id = $1');
    expect(FILED_IDEAS_SQL).not.toContain('dismissed_at');
  });
});
