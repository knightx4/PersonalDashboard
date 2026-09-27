import { describe, expect, it } from 'vitest';
import {
  checkDraft,
  closingReturns,
  DEFAULT_REPLY_DAYS,
  draftExpiry,
  draftReason,
  draftTitle,
  isNoReply,
  MAX_NEW_PER_DAY,
  quietApplications,
  usualReplyDays,
  type ApplicationFacts,
  type FollowUpCandidate,
  type ReturnCandidate,
  type ReturnItemFacts,
} from './find';
import { runDraftsFor, type DraftPorts, type DraftRow } from './run';
import { addressFromThread, draftPrompt, plainDraft, type DraftContext } from './write';

const NOW = new Date('2026-09-27T08:00:00Z');

function daysAgo(days: number): string {
  return new Date(NOW.getTime() - days * 86_400_000).toISOString();
}

function app(overrides: Partial<ApplicationFacts> = {}): ApplicationFacts {
  return {
    id: 'app-1',
    status: 'acknowledged',
    companyId: 'co-1',
    companyName: 'Zenity',
    roleTitle: 'Security Engineer',
    submittedAt: daysAgo(20),
    firstHumanResponseAt: null,
    ...overrides,
  };
}

describe('usualReplyDays', () => {
  it('falls back to fourteen days with nothing to measure', () => {
    expect(usualReplyDays([])).toBe(DEFAULT_REPLY_DAYS);
  });

  it('takes the median, kept within bounds', () => {
    expect(usualReplyDays([6, 9, 40])).toBe(9);
    expect(usualReplyDays([1, 2])).toBe(5);
    expect(usualReplyDays([60])).toBe(28);
  });
});

describe('quietApplications', () => {
  it('finds an application quiet past the fourteen-day fallback', () => {
    const found = quietApplications({
      applications: [app()],
      events: [{ applicationId: 'app-1', kind: 'confirmation', occurredAt: daysAgo(16) }],
      upcomingInterviews: new Set(),
      now: NOW,
    });
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ quietDays: 16, usualDays: 14, measured: false });
    expect(found[0].basis).toBe(daysAgo(16));
  });

  it("uses the company's own reply time from earlier applications", () => {
    const earlier = app({
      id: 'app-0',
      status: 'rejected',
      submittedAt: daysAgo(100),
      firstHumanResponseAt: daysAgo(94),
    });
    const found = quietApplications({
      applications: [earlier, app()],
      events: [{ applicationId: 'app-1', kind: 'confirmation', occurredAt: daysAgo(8) }],
      upcomingInterviews: new Set(),
      now: NOW,
    });
    expect(found.map((c) => [c.aboutId, c.usualDays, c.measured])).toEqual([['app-1', 6, true]]);
  });

  it('leaves out one not yet quiet, one long past, a closed one and one with an interview coming', () => {
    const found = quietApplications({
      applications: [
        app({ id: 'recent' }),
        app({ id: 'stale' }),
        app({ id: 'closed', status: 'rejected' }),
        app({ id: 'interview' }),
      ],
      events: [
        { applicationId: 'recent', kind: 'recruiter_reply', occurredAt: daysAgo(5) },
        { applicationId: 'stale', kind: 'confirmation', occurredAt: daysAgo(40) },
        { applicationId: 'closed', kind: 'confirmation', occurredAt: daysAgo(20) },
        { applicationId: 'interview', kind: 'confirmation', occurredAt: daysAgo(20) },
      ],
      upcomingInterviews: new Set(['interview']),
      now: NOW,
    });
    expect(found).toEqual([]);
  });

  it("does not count the person's own notes as word from the company", () => {
    const found = quietApplications({
      applications: [app()],
      events: [
        { applicationId: 'app-1', kind: 'confirmation', occurredAt: daysAgo(15) },
        { applicationId: 'app-1', kind: 'note', occurredAt: daysAgo(1) },
      ],
      upcomingInterviews: new Set(),
      now: NOW,
    });
    expect(found[0]?.quietDays).toBe(15);
  });

  it('puts the most recently crossed first', () => {
    const found = quietApplications({
      applications: [app({ id: 'a' }), app({ id: 'b' })],
      events: [
        { applicationId: 'a', kind: 'confirmation', occurredAt: daysAgo(25) },
        { applicationId: 'b', kind: 'confirmation', occurredAt: daysAgo(15) },
      ],
      upcomingInterviews: new Set(),
      now: NOW,
    });
    expect(found.map((c) => c.aboutId)).toEqual(['b', 'a']);
  });
});

function item(overrides: Partial<ReturnItemFacts> = {}): ReturnItemFacts {
  return {
    orderId: 'order-1',
    orderStatus: 'delivered',
    deletedAt: null,
    returnDeadline: '2026-09-29',
    merchantName: 'Uniqlo',
    externalOrderNumber: 'A123',
    orderDate: '2026-09-01',
    itemName: 'Wool jumper',
    variant: 'M',
    costCents: 4990,
    ...overrides,
  };
}

describe('closingReturns', () => {
  it('writes one request per order, listing its items', () => {
    const found = closingReturns(
      [item(), item({ itemName: 'Scarf', variant: null, costCents: 1990 })],
      '2026-09-27',
    );
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ aboutId: 'order-1', basis: '2026-09-29', daysLeft: 2 });
    expect(found[0].items.map((i) => i.name)).toEqual(['Wool jumper', 'Scarf']);
  });

  it('waits until the window is within three days, and drops one already past or settled', () => {
    expect(closingReturns([item({ returnDeadline: '2026-10-05' })], '2026-09-27')).toEqual([]);
    expect(closingReturns([item({ returnDeadline: '2026-09-26' })], '2026-09-27')).toEqual([]);
    expect(closingReturns([item({ orderStatus: 'returned' })], '2026-09-27')).toEqual([]);
    expect(closingReturns([item({ deletedAt: '2026-09-20T00:00:00Z' })], '2026-09-27')).toEqual([]);
    expect(closingReturns([item({ returnDeadline: '2026-09-27' })], '2026-09-27')).toHaveLength(1);
  });
});

describe('the words around a draft', () => {
  it('says why it is due', () => {
    const follow: FollowUpCandidate = {
      kind: 'follow_up',
      aboutId: 'a',
      basis: daysAgo(16),
      companyName: 'Zenity',
      roleTitle: 'Security Engineer',
      submittedAt: daysAgo(16),
      quietDays: 16,
      usualDays: 14,
      measured: false,
    };
    expect(draftReason(follow)).toBe(
      'Security Engineer, quiet for 16 days; no reply after 14 days is the usual point to ask',
    );
    expect(draftReason({ ...follow, measured: true, usualDays: 9 })).toContain(
      'they usually reply within 9 days',
    );
    expect(draftTitle('follow_up', 'Zenity')).toBe('Send the follow-up to Zenity');
    expect(draftTitle('return_request', 'Uniqlo')).toBe('Send the return request to Uniqlo');
  });

  it('withdraws a draft three days after it appears', () => {
    expect(draftExpiry(NOW)).toBe('2026-09-30T08:00:00.000Z');
  });

  it('knows a no-reply address', () => {
    expect(isNoReply('no-reply@greenhouse.io')).toBe(true);
    expect(isNoReply('donotreply@shop.com')).toBe(true);
    expect(isNoReply('jane.doe@zenity.io')).toBe(false);
    expect(isNoReply(null)).toBe(false);
  });

  it('turns dashes into commas and refuses an empty or overlong draft', () => {
    expect(checkDraft({ subject: 'Hello — there', body: 'One — two\n\n\n\nthree  ' })).toEqual({
      subject: 'Hello, there',
      body: 'One, two\n\nthree',
    });
    expect(checkDraft({ subject: ' ', body: 'x' })).toBeNull();
    expect(checkDraft({ subject: 'x', body: 'y'.repeat(3001) })).toBeNull();
  });
});

describe('addressFromThread', () => {
  it('writes to the latest sender who reads replies', () => {
    const found = addressFromThread([
      {
        from_address: 'Greenhouse <no-reply@greenhouse.io>',
        reply_to_address: null,
        email_address: 'me@example.com',
        subject: 'Your application',
        received_at: daysAgo(3),
      },
      {
        from_address: 'Jane Doe <jane@zenity.io>',
        reply_to_address: null,
        email_address: 'me@example.com',
        subject: 'Next steps',
        received_at: daysAgo(10),
      },
    ]);
    expect(found).toMatchObject({
      toAddress: 'jane@zenity.io',
      recipientName: 'Jane Doe',
      fromInbox: 'me@example.com',
    });
    expect(found.thread.map((line) => line.from)).toEqual(['Greenhouse', 'Jane Doe']);
  });

  it('leaves the recipient empty when only no-reply addresses wrote', () => {
    const found = addressFromThread([
      {
        from_address: 'no-reply@shop.com',
        reply_to_address: null,
        email_address: 'me@example.com',
        subject: 'Order shipped',
        received_at: daysAgo(3),
      },
    ]);
    expect(found.toAddress).toBeNull();
  });
});

const RETURN: ReturnCandidate = {
  kind: 'return_request',
  aboutId: 'order-1',
  basis: '2026-09-29',
  merchantName: 'Uniqlo',
  externalOrderNumber: 'A123',
  orderDate: '2026-09-01',
  deadline: '2026-09-29',
  daysLeft: 2,
  items: [{ name: 'Wool jumper', variant: 'M', costCents: 4990 }],
};

function context(candidate: FollowUpCandidate | ReturnCandidate): DraftContext {
  return {
    candidate,
    thread: [{ at: daysAgo(20), from: 'Uniqlo', subject: 'Your order has shipped' }],
    events: [],
    recipientName: null,
    senderName: 'Chris',
    today: '2026-09-27',
  };
}

describe('the prompt and the plain draft', () => {
  it('gives the model the order, the items and the thread', () => {
    const prompt = draftPrompt(context(RETURN));
    expect(prompt).toContain('Order number: A123');
    expect(prompt).toContain('- Wool jumper (M), 49.90');
    expect(prompt).toContain('Return window closes: 2026-09-29');
    expect(prompt).toContain('| Uniqlo | Your order has shipped');
    expect(prompt).toContain('Sign off as: Chris');
  });

  it('writes a plain return request naming the order, items and deadline', () => {
    const draft = plainDraft(context(RETURN));
    expect(draft.subject).toBe('Return request for order #A123');
    expect(draft.body).toContain('- Wool jumper (M)');
    expect(draft.body).toContain('closes on 2026-09-29');
    expect(draft.body.trim().endsWith('Chris')).toBe(true);
  });
});

function ports(
  overrides: Partial<DraftPorts> = {},
): DraftPorts & { saved: DraftRow[]; spent: string[] } {
  const saved: DraftRow[] = [];
  const spent: string[] = [];
  const base: DraftPorts = {
    kinds: async () => ['follow_up', 'return_request'],
    followUps: async () => [],
    returns: async () => [RETURN],
    drafted: async () => new Set(),
    writtenToday: async () => ({ follow_up: 0, return_request: 0 }),
    addressing: async () => ({
      toAddress: 'returns@uniqlo.com',
      fromInbox: 'me@example.com',
      context: { thread: [], events: [], recipientName: null },
    }),
    senderName: async () => 'Chris',
    write: async (_context, onSpend) => {
      onSpend({ model: 'claude-sonnet-5', usage: { inputTokens: 1, outputTokens: 1 } } as never);
      return {
        model: 'claude-sonnet-5',
        draft: { subject: 'Return for A123', body: 'Hello — please.' },
      };
    },
    ledger: async (userId) => {
      spent.push(userId);
    },
    save: async (row) => {
      saved.push(row);
      return true;
    },
  };
  return { ...base, ...overrides, saved, spent };
}

function followUp(id: string): FollowUpCandidate {
  return {
    kind: 'follow_up',
    aboutId: id,
    basis: daysAgo(15),
    companyName: `Company ${id}`,
    roleTitle: null,
    submittedAt: daysAgo(15),
    quietDays: 15,
    usualDays: 14,
    measured: false,
  };
}

describe('runDraftsFor', () => {
  it("stores the model's draft to show today and expire in three days", async () => {
    const p = ports();
    const result = await runDraftsFor(p, { userId: 'u', today: '2026-09-27' }, NOW);
    expect(result).toEqual({ written: 1, considered: 1 });
    expect(p.saved[0]).toMatchObject({
      kind: 'return_request',
      about_id: 'order-1',
      basis: '2026-09-29',
      about_label: 'Uniqlo',
      to_address: 'returns@uniqlo.com',
      subject: 'Return for A123',
      body: 'Hello, please.',
      model: 'claude-sonnet-5',
      show_on: '2026-09-27',
      expires_at: '2026-09-30T08:00:00.000Z',
    });
    expect(p.spent).toEqual(['u']);
  });

  it('stores the plain draft when there is no model', async () => {
    const p = ports({ write: async () => null });
    await runDraftsFor(p, { userId: 'u', today: '2026-09-27' }, NOW);
    expect(p.saved[0]).toMatchObject({ model: null, subject: 'Return request for order #A123' });
  });

  it('stores the plain draft when the model fails', async () => {
    const p = ports({
      write: async () => {
        throw new Error('overloaded');
      },
    });
    await runDraftsFor(p, { userId: 'u', today: '2026-09-27' }, NOW);
    expect(p.saved[0]?.model).toBeNull();
  });

  it('does nothing when the agenda source is off', async () => {
    const p = ports({ kinds: async () => [] });
    expect(await runDraftsFor(p, { userId: 'u', today: '2026-09-27' }, NOW)).toEqual({
      written: 0,
      considered: 0,
    });
    expect(p.saved).toEqual([]);
  });

  it('does not write the same draft twice', async () => {
    const p = ports({ drafted: async () => new Set(['return_request:order-1:2026-09-29']) });
    expect((await runDraftsFor(p, { userId: 'u', today: '2026-09-27' }, NOW)).written).toBe(0);
  });

  it(`writes at most ${MAX_NEW_PER_DAY} of a kind a day, counting the earlier hours`, async () => {
    const many = ['a', 'b', 'c', 'd', 'e'].map(followUp);
    const p = ports({
      followUps: async () => many,
      returns: async () => [],
      writtenToday: async () => ({ follow_up: 1, return_request: 0 }),
    });
    const result = await runDraftsFor(p, { userId: 'u', today: '2026-09-27' }, NOW);
    expect(result.written).toBe(MAX_NEW_PER_DAY - 1);
    expect(p.saved.map((row) => row.about_id)).toEqual(['a', 'b']);
  });
});
