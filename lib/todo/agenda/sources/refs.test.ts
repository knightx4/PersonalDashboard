import { describe, expect, it, vi } from 'vitest';
import { parseRef } from '@/lib/core/refs';
import type { AgendaClients } from '@/lib/todo/agenda/clients';
import type { AgendaSource, SourceContext } from '@/lib/todo/agenda/sources';

/**
 * Every agenda source names the row behind each item and each day context by
 * a ref (plan #1451). The database is a stand-in that hands back one row per
 * table whatever the query, which is enough: what is checked is the table a
 * source names and that parseRef accepts the result. The goal steps source
 * has its own test (goal-steps.test.ts), which checks its refs too.
 */

vi.mock('server-only', () => ({}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/todo/agenda/clients', () => ({ sessionClients: {} }));
vi.mock('@/lib/todo/agenda/dismissals', () => ({ dismiss: vi.fn(), undismiss: vi.fn() }));

const DAY = '2026-10-05';

/** One row per table, shaped as each source selects it. */
const ROWS: Record<string, Record<string, unknown>[]> = {
  appointments: [
    { id: 'ap1', title: 'Haircut', provider: null, starts_on: DAY, starts_at: null, location: null },
  ],
  recurring_payments: [
    { id: 'rp1', payee: 'Power', kind: 'bill', amount_cents: 4000, currency: 'USD', next_date: DAY },
  ],
  shipments: [
    { id: 'sh1', status: 'in_transit', carrier: null, expected_on: DAY, orders: { id: 'o1', merchants: { name: 'Shop' } } },
  ],
  drafted_messages: [
    {
      id: 'dm1',
      kind: 'return_request',
      about_id: 'o1',
      about_label: 'Shop',
      to_address: 'a@b.c',
      from_inbox: null,
      subject: 'Return',
      body: 'Hello',
      reason: null,
      show_on: DAY,
    },
  ],
  interviews: [
    {
      id: 'iv1',
      scheduled_at: `${DAY}T14:00:00.000Z`,
      kind: 'recruiter_screen',
      duration_minutes: 30,
      meeting_url: null,
      group_id: null,
      interview_groups: null,
      applications: { roles: { id: 'r1', title: 'Analyst', companies: { name: 'Acme' } } },
    },
  ],
  reminders: [
    { id: 'rm1', kind: 'custom', body: 'Follow up', due_at: `${DAY}T12:00:00.000Z`, application_id: null, applications: null },
  ],
  orders: [
    { id: 'or1', return_deadline: DAY, external_order_number: null, status: 'delivered', merchants: { name: 'Shop' } },
  ],
};

/** A query builder that takes any chain of filters and resolves to the table's rows. */
function client() {
  return {
    from(table: string) {
      const result = { data: ROWS[table] ?? [], error: null };
      const builder: object = new Proxy(
        {},
        {
          get(_target, key) {
            if (key === 'then') return (resolve: (value: unknown) => void) => resolve(result);
            return () => builder;
          },
        },
      );
      return builder;
    },
  };
}

const clients = Object.fromEntries(
  ['shopping', 'jobs', 'todo', 'goals', 'core', 'learn', 'vault', 'news'].map((name) => [name, async () => client()]),
) as unknown as AgendaClients;

const ctx: SourceContext = {
  userId: 'u',
  timezone: 'UTC',
  from: '2026-10-01',
  to: '2026-10-14',
  now: new Date('2026-10-03T12:00:00Z'),
  clients,
};

async function refsOf(source: AgendaSource): Promise<string[]> {
  const items = await source.fetch(ctx);
  const context = source.context ? await source.context(ctx) : [];
  return [...items.map((item) => item.ref), ...context.map((entry) => entry.ref)];
}

const cases: [string, () => Promise<AgendaSource>, string][] = [
  ['appointments', async () => (await import('./appointments')).appointmentsSource, 'todo.appointments:ap1'],
  ['bills', async () => (await import('./bills')).billsSource, 'public.recurring_payments:rp1'],
  ['deliveries', async () => (await import('./deliveries')).deliveriesSource, 'public.shipments:sh1'],
  ['drafts', async () => (await import('./drafts')).draftsSource, 'core.drafted_messages:dm1'],
  ['job interviews', async () => (await import('./job-interviews')).jobInterviewsSource, 'job_search.interviews:iv1'],
  ['job reminders', async () => (await import('./job-reminders')).jobRemindersSource, 'job_search.reminders:rm1'],
  ['return deadlines', async () => (await import('./return-deadlines')).returnDeadlinesSource, 'public.orders:or1'],
];

describe('agenda source refs', () => {
  it.each(cases)('%s names its row by a ref', async (_name, load, expected) => {
    const refs = await refsOf(await load());
    expect(refs).toEqual([expected]);
    for (const ref of refs) expect(parseRef(ref)).not.toBeNull();
  });
});
