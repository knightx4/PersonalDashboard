/**
 * A message to a contact can be kept as a draft and marked sent later
 * (plan #2457.1). A draft leaves the contact's status alone until it is sent.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

interface Call {
  table: string;
  op: 'insert' | 'update';
  values: Record<string, unknown>;
  filters: Array<[string, unknown]>;
}

const calls: Call[] = [];
let touchRow: Record<string, unknown> | null = null;

function builder(table: string) {
  const call: Call = { table, op: 'update', values: {}, filters: [] };
  const b: Record<string, unknown> = {
    insert(values: Record<string, unknown>) {
      call.op = 'insert';
      call.values = values;
      calls.push(call);
      return b;
    },
    update(values: Record<string, unknown>) {
      call.op = 'update';
      call.values = values;
      calls.push(call);
      return b;
    },
    eq(col: string, v: unknown) {
      call.filters.push([col, v]);
      return b;
    },
    in(col: string, v: unknown) {
      call.filters.push([col, v]);
      return b;
    },
    select: () => b,
    single: async () => ({
      data: { id: 't-1', channel: 'email', direction: 'outbound', sent_at: 'x', responded_at: null, message: null, ...call.values },
      error: null,
    }),
    maybeSingle: async () => ({ data: touchRow, error: null }),
    then: (res: (v: { error: null }) => unknown) => Promise.resolve({ error: null }).then(res),
  };
  return b;
}

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({ redirect: vi.fn() }));
vi.mock('@/lib/jobs/auth/server', () => ({
  requireUser: async () => ({ id: 'u-1' }),
  createClient: async () => ({ from: (t: string) => builder(t) }),
}));
vi.mock('@/lib/jobs/contacts/draft-outreach', () => ({ draftOutreach: vi.fn() }));
vi.mock('@/lib/core/spend/session', () => ({ recordSessionSpend: vi.fn() }));

const { logTouch, markTouchSent } = await import('@/app/jobs/(app)/contacts/actions');

const contactMoves = () => calls.filter((c) => c.table === 'contacts');

beforeEach(() => {
  calls.length = 0;
  touchRow = null;
});

describe('logTouch with draft', () => {
  it('stores a draft with the flag set and leaves the contact status alone', async () => {
    const r = await logTouch({ contactId: 'c-1', channel: 'email', direction: 'outbound', message: 'Hi', draft: true });
    expect(r.touch?.draft).toBe(true);
    expect(calls[0].values.draft).toBe(true);
    expect(contactMoves()).toHaveLength(0);
  });

  it('stores a send as not a draft and moves the contact to contacted', async () => {
    const r = await logTouch({ contactId: 'c-1', channel: 'email', direction: 'outbound' });
    expect(r.touch?.draft).toBe(false);
    expect(calls[0].values.draft).toBe(false);
    expect(contactMoves()[0].values).toEqual({ status: 'contacted' });
  });
});

describe('markTouchSent', () => {
  const id = '11111111-1111-4111-8111-111111111111';

  it('sets the time, clears the flag, and moves the contact to contacted', async () => {
    touchRow = { contact_id: 'c-1', direction: 'outbound' };
    const r = await markTouchSent(id);
    expect(r.error).toBeNull();
    expect(r.sentAt).toBeTruthy();
    const upd = calls[0];
    expect(upd.table).toBe('contact_touches');
    expect(upd.values).toMatchObject({ draft: false, sent_at: r.sentAt });
    // Only a draft can be marked sent.
    expect(upd.filters).toContainEqual(['draft', true]);
    expect(contactMoves()[0].values).toEqual({ status: 'contacted' });
  });

  it('refuses a touch that is not a draft and moves nothing', async () => {
    touchRow = null;
    const r = await markTouchSent(id);
    expect(r.error).toMatch(/already sent or gone/);
    expect(contactMoves()).toHaveLength(0);
  });

  it('refuses an id that is not a uuid', async () => {
    expect((await markTouchSent('nope')).error).toMatch(/not a draft/);
    expect(calls).toHaveLength(0);
  });
});
