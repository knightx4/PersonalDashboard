import { describe, expect, it } from 'vitest';
import type { YouSupabaseClient } from '@/lib/you/db/schema-name';
import { addPerson, savePerson, type CleanPerson } from '@/lib/you/people-cards';
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
