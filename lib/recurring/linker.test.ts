import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MessageEnvelope } from '@/lib/core/inbox/envelopes';
import { clearHandoverCache } from '@/lib/core/mailroom/route';

const extract = vi.fn();

vi.mock('@/lib/email/providers/gmail', () => ({
  gmailProvider: {
    getMessage: vi.fn(async () => ({ subject: null, text: 'body', fromAddress: null })),
  },
}));
vi.mock('./extract', () => ({
  extractRecurringFromEmail: (input: unknown) => extract(input),
}));
vi.mock('./store', () => ({
  fileRecurringReading: vi.fn(async () => ({ chargeId: 'charge-1' })),
}));

const { recurringLinker } = await import('./linker');

function envelope(id: string, subject: string, fromAddress = 'billing@smallwater.example'): MessageEnvelope {
  return {
    id,
    providerMessageId: `p-${id}`,
    threadId: null,
    receivedAt: '2026-09-28T10:00:00Z',
    fromAddress,
    replyToAddress: null,
    subject,
    isNew: true,
  };
}

/** The public client: no earlier verdicts, and the verdicts written are kept. */
function fakeSupabase() {
  const written: { id: string; claimed: boolean; parse_status: string }[] = [];
  const client = {
    from: () => ({
      select: () => ({ in: async () => ({ data: [], error: null }) }),
      upsert: async (rows: typeof written) => {
        written.push(...rows);
        return { error: null };
      },
    }),
  };
  return { supabase: client as never, written };
}

/** The core client: Jev on, the agreement report, and Jev's piles. */
function fakeCore(agree: number, piles: Record<string, string>) {
  return {
    from(table: string) {
      if (table === 'account_settings') {
        return {
          select: () => ({
            eq: () => ({ maybeSingle: async () => ({ data: { jev_enabled: true }, error: null }) }),
          }),
        };
      }
      if (table === 'mail_piles') {
        return {
          select: () => ({
            in: (_c: string, ids: string[]) => ({
              gte: async () => ({
                data: ids.filter((id) => piles[id]).map((id) => ({ id, pile: piles[id], confidence: 0.9 })),
                error: null,
              }),
            }),
          }),
        };
      }
      return { insert: async () => ({ error: null }) };
    },
    rpc: async () => ({
      data: [{ linker: 'recurring', pile: 'bill', agree, rules_only: 0 }],
      error: null,
    }),
  } as never;
}

const opts = (envelopes: MessageEnvelope[]) => ({
  userId: 'u',
  accountId: 'a',
  accountEmail: 'me@example.com',
  accessToken: 't',
  envelopes,
});

describe('the recurring linker routed by Jev (plan #1180)', () => {
  beforeEach(() => {
    clearHandoverCache();
    extract.mockReset();
    extract.mockResolvedValue({ ok: false, notRecurring: true, reason: 'not_recurring' });
  });

  // No rule matches this sender or subject.
  const bill = envelope('bill', 'Your October water account');
  // The rules claim this one on its subject.
  const ruled = envelope('ruled', 'Your bill is ready');

  it('sends a bill the rules miss to the extractor on Jev\'s pile alone', async () => {
    const { supabase, written } = fakeSupabase();
    const linker = recurringLinker(supabase, fakeCore(50, { bill: 'bill', ruled: 'newsletter' }));
    const counters = await linker.link(opts([bill, ruled]));

    expect(extract).toHaveBeenCalledTimes(1);
    expect(extract.mock.calls[0]![0]).toMatchObject({ hint: 'subscription' });
    expect(counters.claimed).toBe(1);
    // Jev was sure the rules' match is a newsletter, so it was not read.
    expect(written.find((v) => v.id === 'ruled')).toMatchObject({ claimed: false, parse_status: 'skipped' });
  });

  it('keeps the rules in charge while the gate is shut', async () => {
    const { supabase } = fakeSupabase();
    const linker = recurringLinker(supabase, fakeCore(3, { bill: 'bill', ruled: 'newsletter' }));
    await linker.link(opts([bill, ruled]));

    expect(extract).toHaveBeenCalledTimes(1);
    expect(extract.mock.calls[0]![0]).toMatchObject({ subject: 'Your bill is ready', hint: 'bill' });
  });

  it('falls back to the rules for mail Jev was not sure about', async () => {
    const { supabase } = fakeSupabase();
    const linker = recurringLinker(supabase, fakeCore(50, {}));
    await linker.link(opts([bill, ruled]));

    expect(extract).toHaveBeenCalledTimes(1);
    expect(extract.mock.calls[0]![0]).toMatchObject({ hint: 'bill' });
  });
});
