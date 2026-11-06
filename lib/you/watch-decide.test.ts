import { describe, expect, it } from 'vitest';
import type { DashChange } from '@/lib/talk/changes';
import type { YouSupabaseClient } from '@/lib/you/db/schema-name';
import { decideWatch, withWatches } from './watch-decide';
import { cadenceWords, matchedWords, watchCardFrom, watchIdOf, watchRhythm } from './watch-card-model';

type Row = Record<string, unknown>;

const WATCH: Row = {
  id: 'w1',
  about: 'Vault notes that mention Ruth',
  sends_when: 'A note naming Ruth is new or changed.',
  sample: 'Your note mentions Ruth.',
  every_days: 1,
  mode: 'roundup',
  tables: ['obsidian.notes'],
  status: 'proposed',
  matched: 3,
};

/** A you client over one table of rows, answering the chains watch-decide makes. */
function fakeYou(rows: Row[]) {
  const updates: Row[] = [];
  const client = {
    from: (table: string) => {
      expect(table).toBe('advisor_watches');
      const filters: [string, unknown][] = [];
      let ids: unknown[] | null = null;
      let patch: Row | null = null;
      const matching = () => rows.filter((r) => filters.every(([k, v]) => r[k] === v) && (!ids || ids.includes(r.id)));
      const chain = {
        select: () => chain,
        update: (values: Row) => {
          patch = values;
          return chain;
        },
        eq: (column: string, value: unknown) => {
          filters.push([column, value]);
          return chain;
        },
        in: (column: string, values: unknown[]) => {
          expect(column).toBe('id');
          ids = values;
          return Promise.resolve({ data: matching(), error: null });
        },
        maybeSingle: () => {
          const found = matching()[0] ?? null;
          if (found && patch) {
            Object.assign(found, patch);
            updates.push(patch);
          }
          return Promise.resolve({ data: found, error: null });
        },
      };
      return chain;
    },
  };
  return { you: client as unknown as YouSupabaseClient, updates };
}

function change(fields: Partial<DashChange>): DashChange {
  return {
    id: 'c1',
    kind: 'set_reach_out',
    input: {},
    status: 'done',
    conversationId: '',
    turnId: null,
    subjectRef: 'you.advisor_watches:w1',
    writtenTable: 'you.advisor_watches',
    writtenRef: 'w1',
    undo: null,
    createdAt: '2026-11-06T09:00:00Z',
    doneAt: '2026-11-06T09:00:00Z',
    declinedAt: null,
    undoneAt: null,
    ...fields,
  } as DashChange;
}

describe('the watch card model', () => {
  it('names the watch only on a set_reach_out change that wrote one', () => {
    expect(watchIdOf(change({}))).toBe('w1');
    expect(watchIdOf(change({ writtenTable: 'you.advisor_reach_outs', writtenRef: 'r1' }))).toBeNull();
    expect(watchIdOf(change({ kind: 'add_todo' } as Partial<DashChange>))).toBeNull();
  });

  it('reads a row and refuses one with an unknown status', () => {
    expect(watchCardFrom(WATCH)).toMatchObject({ id: 'w1', sendsWhen: WATCH.sends_when, everyDays: 1, mode: 'roundup', matched: 3 });
    expect(watchCardFrom({ ...WATCH, status: 'gone' })).toBeNull();
    expect(watchCardFrom(null)).toBeNull();
  });

  it('says the rhythm and the matches in words', () => {
    expect(cadenceWords(7)).toBe('every week');
    expect(watchRhythm({ everyDays: 1, mode: 'each' })).toBe('Every day, a text for each new match');
    expect(watchRhythm({ everyDays: 3, mode: 'roundup' })).toBe('Every 3 days, one text about everything new');
    expect(matchedWords(0)).toBe('Nothing matches yet');
    expect(matchedWords(1)).toBe('One row matches now');
    expect(matchedWords(null)).toBeNull();
  });
});

describe('withWatches', () => {
  it('attaches each watch as it is now and leaves other changes alone', async () => {
    const { you } = fakeYou([{ ...WATCH, status: 'active' }]);
    const todo = change({ id: 'c2', kind: 'add_todo', writtenTable: 'todo.tasks', writtenRef: 't1' } as Partial<DashChange>);
    const [watched, other] = await withWatches(you, [change({}), todo]);
    expect(watched.watch?.status).toBe('active');
    expect(other).toBe(todo);
  });

  it('draws a change whose watch was taken back as before', async () => {
    const { you } = fakeYou([]);
    const [watched] = await withWatches(you, [change({})]);
    expect(watched.watch).toBeUndefined();
  });
});

describe('decideWatch', () => {
  it('approves a proposed watch and stamps when', async () => {
    const { you, updates } = fakeYou([{ ...WATCH }]);
    const decided = await decideWatch(you, 'w1', 'approve', '2026-11-06T10:00:00Z');
    expect(decided).toMatchObject({ ok: true, watch: { status: 'active' } });
    expect(updates).toEqual([{ status: 'active', decided_at: '2026-11-06T10:00:00Z' }]);
  });

  it('declines a proposed watch, and the toast puts it back', async () => {
    const { you, updates } = fakeYou([{ ...WATCH }]);
    expect(await decideWatch(you, 'w1', 'decline', '2026-11-06T10:00:00Z')).toMatchObject({ ok: true, watch: { status: 'declined' } });
    expect(await decideWatch(you, 'w1', 'reopen')).toMatchObject({ ok: true, watch: { status: 'proposed' } });
    expect(updates.at(-1)).toEqual({ status: 'proposed', decided_at: null });
  });

  it('moves nothing on a second press and says where it stands', async () => {
    const { you, updates } = fakeYou([{ ...WATCH, status: 'active' }]);
    const decided = await decideWatch(you, 'w1', 'decline');
    expect(decided).toMatchObject({ ok: false, error: 'That watch is already approved.', watch: { status: 'active' } });
    expect(updates).toEqual([]);
  });

  it('says so when the watch was taken back', async () => {
    const { you } = fakeYou([]);
    expect(await decideWatch(you, 'w1', 'approve')).toMatchObject({ ok: false, watch: null });
  });
});
