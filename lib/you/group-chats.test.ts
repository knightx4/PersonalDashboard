import { describe, expect, it } from 'vitest';
import type { YouSupabaseClient } from '@/lib/you/db/schema-name';
import {
  cleanGroupTitle,
  cleanMemberKeys,
  createGroup,
  defaultGroupTitle,
  deleteGroup,
  memberChange,
  renameGroup,
  setGroupMembers,
} from '@/lib/you/group-chats';

const USER = 'u1';

type Call = { table: string; op: string; values?: unknown; filters: [string, string, unknown][]; options?: unknown };
type Answer = { data?: unknown; error?: { message: string; code?: string } | null };

/** Bots on the roster, as listRoster reads board_advisors. */
const ROSTER = ['ada', 'ben', 'cy', 'dee', 'eve', 'fay', 'gus', 'hal', 'ivy'].map((key) => ({
  id: `id-${key}`,
  key,
  name: `${key[0].toUpperCase()}${key.slice(1)} Smith`,
  kind: 'seat',
  question: '',
  focus: null,
  brain_status: 'ready',
  active: true,
  added_by: 'person',
  updated_at: '2026-11-01T00:00:00Z',
  made_by_you: false,
  persona: 'Card',
  colour: null,
}));

/** A client that keeps every call and answers each through `answer`. */
function fakeClient(answer: (call: Call) => Answer = () => ({})) {
  const calls: Call[] = [];
  const client = {
    from(table: string) {
      const call: Call = { table, op: 'select', filters: [] };
      calls.push(call);
      const done = () => {
        const a = answer(call);
        if (a.data !== undefined || a.error) return { data: a.data ?? null, error: a.error ?? null };
        if (table === 'board_advisors') return { data: ROSTER, error: null };
        return { data: null, error: null };
      };
      const filter = (kind: string) => (col: string, value: unknown) => {
        call.filters.push([kind, col, value]);
        return chain;
      };
      const chain: Record<string, unknown> = {
        select: () => chain,
        insert: (values: unknown) => ((call.op = 'insert'), (call.values = values), chain),
        update: (values: unknown) => ((call.op = 'update'), (call.values = values), chain),
        upsert: (values: unknown, options: unknown) => ((call.op = 'upsert'), (call.values = values), (call.options = options), chain),
        delete: () => ((call.op = 'delete'), chain),
        eq: filter('eq'),
        in: filter('in'),
        is: filter('is'),
        order: () => chain,
        limit: () => chain,
        single: () => Promise.resolve(done()),
        maybeSingle: () => Promise.resolve(done()),
        then: (resolve: (v: unknown) => void, reject: (e: unknown) => void) => Promise.resolve(done()).then(resolve, reject),
      };
      return chain;
    },
  };
  return { client: client as unknown as YouSupabaseClient, calls };
}

describe('the rules of a group (plan #2879.1.1)', () => {
  it('names a group with no name by its first names', () => {
    expect(defaultGroupTitle(['Ada Lovelace', 'Ben Franklin'])).toBe('Ada and Ben');
    expect(defaultGroupTitle(['Ada L', 'Ben F', 'Cy T'])).toBe('Ada, Ben and Cy');
    expect(defaultGroupTitle(['A', 'B', 'C', 'D', 'E'])).toBe('A, B, C and 2 more');
    expect(defaultGroupTitle([])).toBe('Group');
  });

  it('keeps two to eight bots, each once', () => {
    expect(cleanMemberKeys(['ada'])).toEqual({ ok: false, error: 'A group needs at least two bots.' });
    expect(cleanMemberKeys(['ada', 'ada'])).toMatchObject({ ok: false });
    expect(cleanMemberKeys(['ada', 'ben', 'ada'])).toEqual({ ok: true, keys: ['ada', 'ben'] });
    expect(cleanMemberKeys(ROSTER.map((r) => r.key))).toEqual({ ok: false, error: 'A group holds at most 8 bots.' });
    expect(cleanMemberKeys(ROSTER.slice(0, 8).map((r) => r.key))).toMatchObject({ ok: true });
  });

  it('treats an empty name as the default and refuses a long one', () => {
    expect(cleanGroupTitle('  ')).toEqual({ ok: true, title: null });
    expect(cleanGroupTitle(' Book  club ')).toEqual({ ok: true, title: 'Book club' });
    expect(cleanGroupTitle('x'.repeat(201))).toMatchObject({ ok: false });
  });

  it('works out who a change of members takes out and adds', () => {
    expect(memberChange(['a', 'b', 'c'], ['b', 'c', 'd'])).toEqual({ remove: ['a'], add: ['d'] });
  });
});

describe('createGroup', () => {
  it('writes a group chat with no bot of its own and one member row per bot', async () => {
    const { client, calls } = fakeClient((call) =>
      call.table === 'advisor_chats' && call.op === 'insert' ? { data: { id: 'g1' } } : {},
    );
    expect(await createGroup(client, USER, { keys: ['ada', 'ben', 'cy'], title: 'Board' })).toEqual({ ok: true, value: { chatId: 'g1' } });
    const chat = calls.find((c) => c.table === 'advisor_chats' && c.op === 'insert');
    expect(chat?.values).toEqual({ user_id: USER, kind: 'group', advisor_id: null, title: 'Board' });
    const members = calls.find((c) => c.table === 'advisor_chat_members' && c.op === 'insert');
    expect(members?.values).toEqual(['ada', 'ben', 'cy'].map((k) => ({ user_id: USER, chat_id: 'g1', advisor_id: `id-${k}` })));
  });

  it('writes nothing for one bot, nine, or a bot not on the roster', async () => {
    for (const keys of [['ada'], ROSTER.map((r) => r.key), ['ada', 'zed']]) {
      const { client, calls } = fakeClient();
      expect(await createGroup(client, USER, { keys })).toMatchObject({ ok: false });
      expect(calls.some((c) => c.op !== 'select')).toBe(false);
    }
  });

  it('takes the chat back out when its members cannot be written', async () => {
    const { client, calls } = fakeClient((call) => {
      if (call.table === 'advisor_chats' && call.op === 'insert') return { data: { id: 'g1' } };
      if (call.table === 'advisor_chat_members') return { error: { message: 'A group holds at most eight bots.' } };
      return {};
    });
    await expect(createGroup(client, USER, { keys: ['ada', 'ben'] })).rejects.toThrow('Adding the bots to the group failed');
    expect(calls.some((c) => c.table === 'advisor_chats' && c.op === 'delete')).toBe(true);
  });
});

describe('renameGroup and deleteGroup', () => {
  it('touch only a group of theirs', async () => {
    const { client, calls } = fakeClient(() => ({ data: [{ id: 'g1' }] }));
    expect(await renameGroup(client, USER, 'g1', '')).toEqual({ ok: true, value: null });
    expect(await deleteGroup(client, USER, 'g1')).toBe(true);
    const [rename, del] = calls.filter((c) => c.op !== 'select');
    expect(rename.values).toEqual({ title: null });
    for (const call of [rename, del]) {
      expect(call.filters).toEqual([
        ['eq', 'user_id', USER],
        ['eq', 'id', 'g1'],
        ['eq', 'kind', 'group'],
      ]);
    }
  });

  it('say so when the group is gone', async () => {
    const { client } = fakeClient(() => ({ data: [] }));
    expect(await renameGroup(client, USER, 'g1', 'New')).toEqual({ ok: false, error: 'That group is not there any more.' });
    expect(await deleteGroup(client, USER, 'g1')).toBe(false);
  });
});

describe('setGroupMembers', () => {
  const group = (call: Call): Answer => {
    if (call.table === 'advisor_chats') return { data: { id: 'g1', title: null, typing_until: null, last_read_at: null } };
    if (call.table === 'advisor_chat_members' && call.op === 'select') {
      return {
        data: [
          { chat_id: 'g1', advisor_id: 'id-ada', joined_at: '2026-11-01T00:00:00Z', left_at: null, typing_until: null },
          { chat_id: 'g1', advisor_id: 'id-ben', joined_at: '2026-11-01T00:00:00Z', left_at: null, typing_until: null },
          { chat_id: 'g1', advisor_id: 'id-cy', joined_at: '2026-11-01T00:00:00Z', left_at: '2026-11-02T00:00:00Z', typing_until: null },
        ],
      };
    }
    return {};
  };

  it('marks those taken out left and adds the rest, a former member on its old row', async () => {
    const { client, calls } = fakeClient(group);
    const now = Date.parse('2026-11-04T12:00:00Z');
    expect(await setGroupMembers(client, USER, 'g1', ['ben', 'cy', 'dee'], now)).toEqual({ ok: true, value: null });
    const left = calls.find((c) => c.table === 'advisor_chat_members' && c.op === 'update');
    expect(left?.values).toEqual({ left_at: '2026-11-04T12:00:00.000Z', typing_until: null });
    expect(left?.filters).toContainEqual(['in', 'advisor_id', ['id-ada']]);
    const added = calls.find((c) => c.table === 'advisor_chat_members' && c.op === 'upsert');
    expect((added?.values as { advisor_id: string }[]).map((v) => v.advisor_id)).toEqual(['id-cy', 'id-dee']);
    expect(added?.options).toEqual({ onConflict: 'chat_id,advisor_id' });
  });

  it('refuses to leave fewer than two', async () => {
    const { client, calls } = fakeClient(group);
    expect(await setGroupMembers(client, USER, 'g1', ['ben'])).toMatchObject({ ok: false });
    expect(calls.some((c) => c.op !== 'select')).toBe(false);
  });
});
