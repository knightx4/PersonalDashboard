import { describe, expect, it } from 'vitest';
import type { GoalsSupabaseClient } from '@/lib/goals/db/schema-name';
import { loadLiveTree, setStepNotify } from '@/lib/goals/steps-store';

/**
 * A query that answers every filter by returning itself and resolves to the
 * table's rows, which is all loadLiveTree asks of the client.
 */
function fakeClient(tables: Record<string, unknown[]>, selected: Record<string, string>) {
  return {
    from(table: string) {
      const result = { data: tables[table] ?? [], error: null };
      const query: Record<string, unknown> = {
        select(columns: string) {
          selected[table] = columns;
          return query;
        },
        is: () => query,
        eq: () => query,
        order: () => query,
        then: (resolve: (value: typeof result) => unknown) => resolve(result),
      };
      return query;
    },
  } as unknown as GoalsSupabaseClient;
}

const base = {
  area_id: null,
  detail: null,
  acceptance: null,
  resolution: null,
  dismissed_at: null,
  due_on: null,
  starts_on: null,
  rhythm_count: null,
  rhythm_period: null,
  on_todo: false,
  result: null,
  result_url: null,
  reviewed_at: null,
  unit: null,
  target: null,
  collection_id: null,
  asks_for: null,
  questions: null,
  block_ask: null,
  block_kind: null,
  acts: null,
  help_kinds: [],
  proposed_help_kinds: [],
  kept_open_at: null,
  prepares_id: null,
  prep_checked_at: null,
};

describe('loadLiveTree and Dash prep steps (plan #1215)', () => {
  it('reads which step a prep step prepares and when your step was judged', async () => {
    const selected: Record<string, string> = {};
    const client = fakeClient(
      {
        areas: [{ id: 'area', name: 'Work' }],
        items: [
          { ...base, id: 'goal', level: 'goal', area_id: 'area', parent_id: null, kind: null,
            status: 'open', title: 'Find temp work', position: 0 },
          { ...base, id: 'call', level: 'step', parent_id: 'goal', kind: 'mine', status: 'open',
            title: 'Call three staffing firms', position: 1,
            prep_checked_at: '2026-09-29T07:00:00Z' },
          { ...base, id: 'list', level: 'step', parent_id: 'goal', kind: 'claude', status: 'open',
            title: 'Shortlist staffing firms', position: 0, prepares_id: 'call' },
        ],
        dependencies: [],
      },
      selected,
    );

    const { byGoal } = await loadLiveTree(client, { userId: 'user' });
    const steps = byGoal.get('goal') ?? [];
    expect(selected.items).toContain('prepares_id');
    expect(selected.items).toContain('prep_checked_at');
    const byId = new Map(steps.map((s) => [s.id, s]));
    expect(byId.get('list')).toMatchObject({ preparesId: 'call', prepCheckedAt: null });
    expect(byId.get('call')).toMatchObject({
      preparesId: null,
      prepCheckedAt: '2026-09-29T07:00:00Z',
    });
  });
});

describe('setStepNotify (plan #2376.2)', () => {
  /** Records every filter the update is narrowed by, and answers with `rows`. */
  function recordingClient(rows: unknown[], calls: unknown[][]) {
    return {
      from(table: string) {
        calls.push(['from', table]);
        const query: Record<string, unknown> = {};
        for (const name of ['update', 'eq', 'not', 'is', 'select']) {
          query[name] = (...args: unknown[]) => {
            calls.push([name, ...args]);
            return query;
          };
        }
        query.then = (resolve: (value: unknown) => unknown) => resolve({ data: rows, error: null });
        return query;
      },
    } as unknown as GoalsSupabaseClient;
  }

  it("sets the switch only on an open, live step of Dash's", async () => {
    const calls: unknown[][] = [];
    expect(await setStepNotify(recordingClient([{ id: 's1' }], calls), 's1', true)).toBe(true);
    expect(calls).toEqual([
      ['from', 'items'],
      ['update', { notify_on_done: true }],
      ['eq', 'id', 's1'],
      ['eq', 'level', 'step'],
      ['eq', 'kind', 'claude'],
      ['not', 'status', 'in', '(done,dropped)'],
      ['is', 'archived_at', null],
      ['select', 'id'],
    ]);
  });

  it('says nothing changed when no such step took it', async () => {
    expect(await setStepNotify(recordingClient([], []), 's1', false)).toBe(false);
  });
});
