import { describe, expect, it } from 'vitest';
import type { YouSupabaseClient } from '@/lib/you/db/schema-name';
import { addPerson, deletePerson, savePerson, type CleanPerson } from '@/lib/you/people-cards';
import { EMPTY_BRIEF } from '@/lib/you/people-cards-model';

type Call = { table: string; op: string; values?: Record<string, unknown>; filters: [string, unknown][] };

/** A client that answers every select with `rows[table]` and keeps every write. */
function fakeClient(rows: Record<string, unknown>) {
  const calls: Call[] = [];
  const client = {
    from(table: string) {
      const call: Call = { table, op: 'select', filters: [] };
      const chain = {
        select: () => chain,
        insert: (values: Record<string, unknown>) => {
          call.op = 'insert';
          call.values = values;
          calls.push(call);
          return Promise.resolve({ error: null });
        },
        update: (values: Record<string, unknown>) => {
          call.op = 'update';
          call.values = values;
          calls.push(call);
          return chain;
        },
        eq: (col: string, value: unknown) => {
          call.filters.push([col, value]);
          return chain;
        },
        maybeSingle: () => Promise.resolve({ data: rows[table] ?? null, error: null }),
        then: (resolve: (v: unknown) => void) => resolve({ data: rows[table] ?? [], error: null }),
      };
      return chain;
    },
  };
  return { client: client as unknown as YouSupabaseClient, calls };
}

const USER = 'u1';
const person = (persona: string): CleanPerson => ({
  name: 'Benjamin Franklin',
  colour: '#4a5fd0',
  brief: { ...EMPTY_BRIEF, who: 'Money and habits', tone: 'Dry' },
  persona,
  joinsMeetings: true,
});

describe('savePerson', () => {
  it('keeps the card it replaces, saying who wrote it', async () => {
    const { client, calls } = fakeClient({
      board_advisors: { id: 'a1', key: 'franklin', persona: 'Old card', persona_brief: { card_by: 'dash', card_ask: 'shorter' } },
    });
    const key = await savePerson(client, USER, 'a1', person('New card'), { by: 'you', ask: null });
    expect(key).toBe('franklin');
    const kept = calls.find((c) => c.table === 'advisor_persona_versions');
    expect(kept?.values).toEqual({ user_id: USER, advisor_id: 'a1', persona: 'Old card', made_by: 'dash', ask: 'shorter' });
    const saved = calls.find((c) => c.table === 'board_advisors' && c.op === 'update');
    expect(saved?.values).toMatchObject({ persona: 'New card', focus: 'Money and habits', persona_brief: { card_by: 'you', tone: 'Dry' } });
    expect(saved?.filters).toEqual([
      ['user_id', USER],
      ['id', 'a1'],
    ]);
  });

  it('keeps no version when the card is unchanged, and keeps who wrote it', async () => {
    const { client, calls } = fakeClient({ board_advisors: { id: 'a1', key: 'franklin', persona: 'Same', persona_brief: null } });
    await savePerson(client, USER, 'a1', person('Same'), { by: 'you', ask: null });
    expect(calls.some((c) => c.table === 'advisor_persona_versions')).toBe(false);
    const saved = calls.find((c) => c.op === 'update');
    expect(saved?.values?.persona_brief).toMatchObject({ card_by: 'dash' });
  });
});

describe('addPerson', () => {
  it('adds someone of your own, in Chat only unless asked', async () => {
    const { client, calls } = fakeClient({ board_advisors: [{ key: 'benjamin_franklin' }] });
    const key = await addPerson(client, USER, { ...person('Card'), joinsMeetings: false }, { by: 'dash', ask: null });
    expect(key).toBe('benjamin_franklin_2');
    expect(calls[0].values).toMatchObject({ made_by_you: true, joins_meetings: false, kind: 'guest', persona: 'Card', user_id: USER });
  });
});

/** A client for deletePerson: the advisor its read finds, what the delete answers, and the panels holding the key. */
function deleteClient(advisor: { key: string; kind: string } | null, deleteError: { code: string; message: string } | null, panels: unknown[] = []) {
  const calls: Call[] = [];
  const client = {
    from(table: string) {
      const call: Call = { table, op: 'select', filters: [] };
      const answer = () => {
        if (call.op === 'delete' && table === 'board_advisors') return { error: deleteError };
        if (call.op === 'select' && table === 'board_panels') return { data: panels, error: null };
        return { data: null, error: null };
      };
      const chain = {
        select: () => chain,
        delete: () => {
          call.op = 'delete';
          calls.push(call);
          return chain;
        },
        update: (values: Record<string, unknown>) => {
          call.op = 'update';
          call.values = values;
          calls.push(call);
          return chain;
        },
        eq: (col: string, value: unknown) => {
          call.filters.push([col, value]);
          return chain;
        },
        contains: (col: string, value: unknown) => {
          call.filters.push([col, value]);
          return chain;
        },
        maybeSingle: () => Promise.resolve({ data: advisor, error: null }),
        then: (resolve: (v: unknown) => void) => resolve(answer()),
      };
      return chain;
    },
  };
  return { client: client as unknown as YouSupabaseClient, calls };
}

describe('deletePerson (plan #2879.3)', () => {
  it('deletes a guest and takes its key off the panels that hold it', async () => {
    const { client, calls } = deleteClient({ key: 'franklin', kind: 'guest' }, null, [{ id: 'p1', advisors: ['cfo', 'franklin'] }]);
    expect(await deletePerson(client, USER, 'a1')).toBe(true);
    const removed = calls.find((c) => c.table === 'board_advisors' && c.op === 'delete');
    expect(removed?.filters).toEqual([
      ['user_id', USER],
      ['id', 'a1'],
    ]);
    expect(calls.some((c) => c.table === 'advisor_chats')).toBe(false);
    const panel = calls.find((c) => c.table === 'board_panels' && c.op === 'update');
    expect(panel?.values).toEqual({ advisors: ['cfo'] });
    expect(panel?.filters).toEqual([
      ['user_id', USER],
      ['id', 'p1'],
    ]);
  });

  it('retires a guest the board minutes hold, deleting its chats', async () => {
    const { client, calls } = deleteClient({ key: 'franklin', kind: 'guest' }, { code: '23503', message: 'board_turns' });
    expect(await deletePerson(client, USER, 'a1')).toBe(true);
    const chats = calls.find((c) => c.table === 'advisor_chats' && c.op === 'delete');
    expect(chats?.filters).toEqual([
      ['user_id', USER],
      ['advisor_id', 'a1'],
    ]);
    const retired = calls.find((c) => c.table === 'board_advisors' && c.op === 'update');
    expect(retired?.values).toEqual({ active: false, joins_meetings: false });
  });

  it('never deletes a seat, nor someone not found', async () => {
    for (const advisor of [{ key: 'skeptic', kind: 'seat' }, null]) {
      const { client, calls } = deleteClient(advisor, null);
      expect(await deletePerson(client, USER, 'a1')).toBe(false);
      expect(calls).toEqual([]);
    }
  });

  it('throws on any other failure', async () => {
    const { client } = deleteClient({ key: 'franklin', kind: 'guest' }, { code: '42501', message: 'denied' });
    await expect(deletePerson(client, USER, 'a1')).rejects.toThrow('Deleting them failed: denied');
  });
});
