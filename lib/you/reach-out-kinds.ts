import type { SupabaseClient } from '@supabase/supabase-js';
import { todayInTimezone } from '@/lib/money';
import type { ReachOutParams, ReachOutWatch } from '@/lib/you/reach-out-rule';

/**
 * The fixed watch kinds a reach-out rule may name (plan #3030.3), beside the
 * plain "every new row of these tables" watch of #2931.
 *
 * A plain watch hands its person every new row of a table. A kind reads
 * something narrower or worked out: a charge over the amount they named, the
 * schedule for tomorrow, the newsletter stories on their topic, a return
 * window closing. Each kind has its own reader here, which the daily round's
 * due check (reach-out-due.ts) calls in place of the table reader, and one
 * table its rows are recorded under in you.advisor_reach_outs, so the
 * no-repeat window works for a kind as for any watch.
 *
 * Every reader runs on the service role, so each names the owner in its
 * query: by user_id, or through the join that reaches it (a shipment through
 * its order, a message through its mailbox).
 *
 * A reader's rows carry `at` when they are news once (a new issue, a new
 * charge), which the due check compares with the watch's last text; rows
 * that are a state (a balance under the line, a todo overdue) carry no `at`
 * and are held back by the no-repeat window alone.
 */

export const KIND_PARAMS = ['words', 'amount', 'days', 'from'] as const;
export type KindParam = (typeof KIND_PARAMS)[number];

export type KindRow = { table: string; ref: string; title: string; at: string | null };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type KindDb = (schema: string) => SupabaseClient<any, string, any>;

export type KindContext = {
  db: KindDb;
  userId: string;
  /** Rows newer than this are new; null reads them all. */
  since: string | null;
  params: ReachOutParams;
  now: number;
  /** The person's zone, read once per round when a kind asks for it. */
  timezone: () => Promise<string>;
};

export type ReachOutKind = {
  kind: string;
  /** The workspace it reads, as the prompt groups them. */
  area: 'News' | 'Finances' | 'Todo and calendar' | 'Shopping' | 'Mail' | 'Learn' | 'Goals';
  /** What it sends, for the prompt. */
  sends: string;
  /** The table its rows are recorded under (advisor_reach_outs.ref_table). */
  table: string;
  /** What it is told. A required one missing sends the ask to cannot_watch. */
  params: readonly KindParam[];
  required?: readonly (KindParam | 'words|from')[];
  /** Used when they gave no number of days. */
  defaultDays?: number;
  read: (ctx: KindContext) => Promise<KindRow[]>;
};

/** The most rows one kind reads in a round. */
export const KIND_ROWS = 100;

const DAY_MS = 24 * 60 * 60 * 1000;

function asText(value: unknown): string | null {
  if (typeof value === 'string') return value.trim() || null;
  if (typeof value === 'number') return String(value);
  return null;
}

/** "142.50", from cents. Currency signs are left to the text. */
export function money(cents: number): string {
  const whole = Math.floor(Math.abs(Math.round(cents)) / 100);
  const pence = Math.abs(Math.round(cents)) % 100;
  const grouped = String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return pence ? `${grouped}.${String(pence).padStart(2, '0')}` : grouped;
}

export function plusDays(day: string, days: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

/** Whether any of the words is in the text, ignoring case. */
export function mentionsAny(text: string, words: readonly string[]): boolean {
  const lower = text.toLowerCase();
  return words.some((word) => {
    const w = word.trim().toLowerCase();
    if (!w) return false;
    // A short word ("AI") must stand alone, so it does not match "said".
    if (w.length <= 3) return new RegExp(`(^|[^a-z0-9])${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9]|$)`).test(lower);
    return lower.includes(w);
  });
}

/** A PostgREST ilike pattern with its wildcards and the or() separators taken out. */
function likeOf(word: string): string {
  return `*${word.replace(/[%*,()\\]/g, ' ').trim()}*`;
}

type Rows = Record<string, unknown>[];

async function rows(promise: PromiseLike<{ data: unknown; error: { message: string } | null }>, what: string): Promise<Rows> {
  const { data, error } = await promise;
  if (error) throw new Error(`${what}: ${error.message}`);
  return (data ?? []) as Rows;
}

async function today(ctx: KindContext): Promise<string> {
  return todayInTimezone(await ctx.timezone(), new Date(ctx.now));
}

/** The day schedule for a day from now, read from the one combined schedule (plan #3027). */
async function scheduleRows(ctx: KindContext, offset: number): Promise<KindRow[]> {
  const [{ loadSchedule }, { clockOf }] = await Promise.all([import('@/lib/todo/schedule/load'), import('@/lib/todo/schedule/model')]);
  const { clientsOver } = await import('@/lib/todo/agenda/clients');
  const timezone = await ctx.timezone();
  const day = plusDays(todayInTimezone(timezone, new Date(ctx.now)), offset);
  const schedule = await loadSchedule(
    ctx.userId,
    { from: day, to: day },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    { clients: clientsOver((async (schema: string) => ctx.db(schema)) as any), now: new Date(ctx.now), timezone },
  );
  return schedule.entries.map((entry) => ({
    table: 'todo.events',
    ref: `${day}:${entry.key}`.slice(0, 400),
    title: `${clockOf(entry, timezone)} ${entry.title}${entry.location ? ` (${entry.location})` : ''}${entry.kind === 'due' ? ', due' : ''}`,
    at: null,
  }));
}

export const REACH_OUT_KINDS: readonly ReachOutKind[] = [
  {
    kind: 'news_issues',
    area: 'News',
    sends: 'New newsletter issues since the last text, each with its summary, for a news round-up.',
    table: 'news.issues',
    params: [],
    read: async (ctx) => {
      let q = ctx.db('news')
        .from('issues')
        .select('id, subject, summary_line, summary, received_at')
        .eq('user_id', ctx.userId)
        .or('purpose.is.null,purpose.eq.news');
      if (ctx.since) q = q.gt('received_at', ctx.since);
      const data = await rows(q.order('received_at', { ascending: false }).limit(KIND_ROWS), 'news.issues');
      return data.flatMap((r) => {
        const ref = asText(r.id);
        if (!ref) return [];
        const line = asText(r.summary_line) ?? asText(r.summary);
        return [{ table: 'news.issues', ref, title: `${asText(r.subject) ?? 'An issue'}${line ? `: ${line}` : ''}`, at: asText(r.received_at) }];
      });
    },
  },
  {
    kind: 'news_topics',
    area: 'News',
    sends: 'Newsletter stories whose headline or summary mentions a topic they name (words).',
    table: 'news.issues',
    params: ['words'],
    required: ['words'],
    read: async (ctx) => {
      const words = ctx.params.words ?? [];
      let q = ctx.db('news').from('issues').select('id, stories, received_at').eq('user_id', ctx.userId).not('stories', 'is', null);
      if (ctx.since) q = q.gt('received_at', ctx.since);
      const data = await rows(q.order('received_at', { ascending: false }).limit(KIND_ROWS), 'news.issues');
      const out: KindRow[] = [];
      for (const r of data) {
        const id = asText(r.id);
        if (!id || !Array.isArray(r.stories)) continue;
        r.stories.forEach((story: unknown, index: number) => {
          if (typeof story !== 'object' || story === null) return;
          const s = story as Record<string, unknown>;
          const headline = asText(s.headline);
          if (!headline) return;
          const text = [headline, asText(s.summary), asText(s.topic)].filter(Boolean).join(' ');
          if (!mentionsAny(text, words)) return;
          out.push({ table: 'news.issues', ref: `${id}:${index}`, title: headline, at: asText(r.received_at) });
        });
      }
      return out;
    },
  },
  {
    kind: 'charge_over',
    area: 'Finances',
    sends: 'A card or bank charge over an amount they name (amount).',
    table: 'finances.transactions',
    params: ['amount'],
    required: ['amount'],
    read: async (ctx) => {
      const cents = Math.round((ctx.params.amount ?? 0) * 100);
      // Money out is negative (lib/finances/sources.ts); transfers between their own accounts are left out.
      let q = ctx.db('finances')
        .from('transactions')
        .select('id, merchant, description, amount_cents, posted_on, created_at')
        .eq('user_id', ctx.userId)
        .lte('amount_cents', -cents)
        .is('internal_kind', null);
      if (ctx.since) q = q.gt('created_at', ctx.since);
      const data = await rows(q.order('created_at', { ascending: false }).limit(KIND_ROWS), 'finances.transactions');
      return data.flatMap((r) => {
        const ref = asText(r.id);
        if (!ref) return [];
        const who = asText(r.merchant) ?? asText(r.description) ?? 'A charge';
        return [{ table: 'finances.transactions', ref, title: `${who}, ${money(Number(r.amount_cents))} on ${asText(r.posted_on)}`, at: asText(r.created_at) }];
      });
    },
  },
  {
    kind: 'balance_under',
    area: 'Finances',
    sends: 'An account whose latest balance is under an amount they name (amount); named again while it stays under.',
    table: 'finances.accounts',
    params: ['amount'],
    required: ['amount'],
    read: async (ctx) => {
      const cents = Math.round((ctx.params.amount ?? 0) * 100);
      const accounts = await rows(
        ctx.db('finances').from('accounts').select('id, name, kind').eq('user_id', ctx.userId).eq('hidden', false).is('closed_on', null),
        'finances.accounts',
      );
      if (!accounts.length) return [];
      const since = new Date(ctx.now - 7 * DAY_MS).toISOString().slice(0, 10);
      const readings = await rows(
        ctx.db('finances')
          .from('balance_readings')
          .select('account_id, read_on, balance_cents')
          .eq('user_id', ctx.userId)
          .gte('read_on', since)
          .order('read_on', { ascending: false })
          .limit(1000),
        'finances.balance_readings',
      );
      const latest = new Map<string, Record<string, unknown>>();
      for (const r of readings) {
        const id = asText(r.account_id);
        if (id && !latest.has(id)) latest.set(id, r);
      }
      return accounts.flatMap((a) => {
        const id = asText(a.id);
        const reading = id ? latest.get(id) : undefined;
        // A card's balance is what is owed, so "under" is for cash accounts.
        if (!id || !reading || a.kind === 'credit' || a.kind === 'loan') return [];
        const balance = Number(reading.balance_cents);
        if (!Number.isFinite(balance) || balance >= cents) return [];
        return [{ table: 'finances.accounts', ref: id, title: `${asText(a.name) ?? 'An account'} is at ${money(balance)} (read ${asText(reading.read_on)})`, at: null }];
      });
    },
  },
  {
    kind: 'statement_due',
    area: 'Finances',
    sends: 'A card statement or payment due within a number of days (days, default 5), once per statement.',
    table: 'finances.accounts',
    params: ['days'],
    defaultDays: 5,
    read: async (ctx) => {
      const from = await today(ctx);
      const to = plusDays(from, ctx.params.days ?? 5);
      const data = await rows(
        ctx.db('finances')
          .from('accounts')
          .select('id, name, next_payment_due_on, statement_balance_cents, minimum_payment_cents')
          .eq('user_id', ctx.userId)
          .is('closed_on', null)
          .gte('next_payment_due_on', from)
          .lte('next_payment_due_on', to)
          .limit(KIND_ROWS),
        'finances.accounts',
      );
      return data.flatMap((r) => {
        const id = asText(r.id);
        const due = asText(r.next_payment_due_on);
        if (!id || !due) return [];
        const owed = r.statement_balance_cents == null ? '' : `, statement ${money(Number(r.statement_balance_cents))}`;
        const min = r.minimum_payment_cents == null ? '' : `, minimum ${money(Number(r.minimum_payment_cents))}`;
        return [{ table: 'finances.accounts', ref: `${id}:${due}`, title: `${asText(r.name) ?? 'A card'} due ${due}${owed}${min}`, at: null }];
      });
    },
  },
  {
    kind: 'recurring_new',
    area: 'Finances',
    sends: 'A new subscription or recurring payment found in their mail.',
    table: 'public.recurring_payments',
    params: [],
    read: async (ctx) => {
      let q = ctx.db('public')
        .from('recurring_payments')
        .select('id, payee, amount_cents, period, created_at')
        .eq('user_id', ctx.userId)
        .eq('status', 'active');
      if (ctx.since) q = q.gt('created_at', ctx.since);
      const data = await rows(q.order('created_at', { ascending: false }).limit(KIND_ROWS), 'public.recurring_payments');
      return data.flatMap((r) => {
        const ref = asText(r.id);
        if (!ref) return [];
        const amount = r.amount_cents == null ? '' : `, ${money(Number(r.amount_cents))}${r.period ? ` a ${asText(r.period)}` : ''}`;
        return [{ table: 'public.recurring_payments', ref, title: `${asText(r.payee) ?? 'A payment'}${amount}`, at: asText(r.created_at) }];
      });
    },
  },
  {
    kind: 'recurring_price_rise',
    area: 'Finances',
    sends: 'A subscription or bill whose price went up.',
    table: 'public.recurring_charges',
    params: [],
    read: async (ctx) => {
      let q = ctx.db('public')
        .from('recurring_charges')
        .select('id, payment_id, event, amount_cents, previous_amount_cents, created_at')
        .eq('user_id', ctx.userId)
        .eq('event', 'price_change');
      if (ctx.since) q = q.gt('created_at', ctx.since);
      const data = await rows(q.order('created_at', { ascending: false }).limit(KIND_ROWS), 'public.recurring_charges');
      const risen = data.filter((r) => r.previous_amount_cents == null || Number(r.amount_cents) > Number(r.previous_amount_cents));
      const ids = [...new Set(risen.map((r) => asText(r.payment_id)).filter((id): id is string => Boolean(id)))];
      const payees = new Map<string, string>();
      if (ids.length) {
        const named = await rows(
          ctx.db('public').from('recurring_payments').select('id, payee').eq('user_id', ctx.userId).in('id', ids),
          'public.recurring_payments',
        );
        for (const p of named) payees.set(String(p.id), asText(p.payee) ?? 'A payment');
      }
      return risen.flatMap((r) => {
        const ref = asText(r.id);
        if (!ref) return [];
        const was = r.previous_amount_cents == null ? '' : ` from ${money(Number(r.previous_amount_cents))}`;
        const name = payees.get(String(r.payment_id)) ?? 'A payment';
        return [{ table: 'public.recurring_charges', ref, title: `${name} went up${was} to ${money(Number(r.amount_cents))}`, at: asText(r.created_at) }];
      });
    },
  },
  {
    kind: 'schedule_today',
    area: 'Todo and calendar',
    sends: "Everything on today's schedule: their calendar, subscribed calendars, appointments, interviews and todos due.",
    table: 'todo.events',
    params: [],
    read: (ctx) => scheduleRows(ctx, 0),
  },
  {
    kind: 'schedule_tomorrow',
    area: 'Todo and calendar',
    sends: "Everything on tomorrow's schedule, from the same combined schedule.",
    table: 'todo.events',
    params: [],
    read: (ctx) => scheduleRows(ctx, 1),
  },
  {
    kind: 'todos_overdue',
    area: 'Todo and calendar',
    sends: 'Todos past their due day and still open; named again while they wait.',
    table: 'todo.tasks',
    params: [],
    read: async (ctx) => {
      const data = await rows(
        ctx.db('todo')
          .from('tasks')
          .select('id, title, due_on')
          .eq('user_id', ctx.userId)
          .eq('status', 'open')
          .lt('due_on', await today(ctx))
          .order('due_on', { ascending: true })
          .limit(KIND_ROWS),
        'todo.tasks',
      );
      return data.flatMap((r) => {
        const ref = asText(r.id);
        return ref ? [{ table: 'todo.tasks', ref, title: `${asText(r.title) ?? 'A todo'}, due ${asText(r.due_on)}`, at: null }] : [];
      });
    },
  },
  {
    kind: 'appointment_new',
    area: 'Todo and calendar',
    sends: 'A new appointment read from a booking email.',
    table: 'todo.appointments',
    params: [],
    read: async (ctx) => {
      let q = ctx.db('todo')
        .from('appointments')
        .select('id, title, provider, starts_on, starts_at, created_at, status')
        .eq('user_id', ctx.userId)
        .neq('status', 'cancelled');
      if (ctx.since) q = q.gt('created_at', ctx.since);
      const data = await rows(q.order('created_at', { ascending: false }).limit(KIND_ROWS), 'todo.appointments');
      return data.flatMap((r) => {
        const ref = asText(r.id);
        if (!ref) return [];
        const when = asText(r.starts_at) ?? asText(r.starts_on);
        const who = asText(r.provider);
        return [{ table: 'todo.appointments', ref, title: `${asText(r.title) ?? 'An appointment'}${who ? ` with ${who}` : ''}${when ? `, ${when}` : ''}`, at: asText(r.created_at) }];
      });
    },
  },
  {
    kind: 'return_window',
    area: 'Shopping',
    sends: 'An order whose return window closes within a number of days (days, default 7), once per order.',
    table: 'public.orders',
    params: ['days'],
    defaultDays: 7,
    read: async (ctx) => {
      const from = await today(ctx);
      const data = await rows(
        ctx.db('public')
          .from('orders')
          .select('id, merchant_id, external_order_number, return_deadline, total_cents')
          .eq('user_id', ctx.userId)
          .is('deleted_at', null)
          .is('cancelled_at', null)
          .not('status', 'in', '(returned,cancelled)')
          .gte('return_deadline', from)
          .lte('return_deadline', plusDays(from, ctx.params.days ?? 7))
          .order('return_deadline', { ascending: true })
          .limit(KIND_ROWS),
        'public.orders',
      );
      const ids = [...new Set(data.map((r) => asText(r.merchant_id)).filter((id): id is string => Boolean(id)))];
      const shops = new Map<string, string>();
      if (ids.length) {
        for (const m of await rows(ctx.db('public').from('merchants').select('id, name').in('id', ids), 'public.merchants')) {
          shops.set(String(m.id), asText(m.name) ?? 'A shop');
        }
      }
      return data.flatMap((r) => {
        const ref = asText(r.id);
        if (!ref) return [];
        const shop = shops.get(String(r.merchant_id)) ?? 'An order';
        const total = r.total_cents == null ? '' : `, ${money(Number(r.total_cents))}`;
        return [{ table: 'public.orders', ref, title: `${shop} order${total}, return by ${asText(r.return_deadline)}`, at: null }];
      });
    },
  },
  {
    kind: 'deliveries',
    area: 'Shopping',
    sends: 'A parcel out for delivery or due within a number of days (days, default 1), once per parcel.',
    table: 'public.shipments',
    params: ['days'],
    defaultDays: 1,
    read: async (ctx) => {
      const from = await today(ctx);
      const to = plusDays(from, ctx.params.days ?? 1);
      const data = await rows(
        ctx.db('public')
          .from('shipments')
          .select('id, carrier, status, expected_on, order:orders!inner(user_id, external_order_number)')
          .eq('order.user_id', ctx.userId)
          .is('delivered_at', null)
          .neq('status', 'delivered')
          .or(`status.eq.out_for_delivery,and(expected_on.gte.${from},expected_on.lte.${to})`)
          .limit(KIND_ROWS),
        'public.shipments',
      );
      return data.flatMap((r) => {
        const ref = asText(r.id);
        if (!ref) return [];
        const order = (r.order ?? {}) as Record<string, unknown>;
        const what = asText(order.external_order_number) ? `Order ${asText(order.external_order_number)}` : 'A parcel';
        const when = r.status === 'out_for_delivery' ? 'out for delivery' : `due ${asText(r.expected_on)}`;
        return [{ table: 'public.shipments', ref, title: `${what}${r.carrier ? ` by ${asText(r.carrier)}` : ''}, ${when}`, at: null }];
      });
    },
  },
  {
    kind: 'mail',
    area: 'Mail',
    // The sync wipes the sender and subject of mail no workspace claimed
    // (core.scrub_unclaimed_messages, migration 0029), so this reads the mail
    // the app keeps: jobs, orders, bills, bookings and mail awaiting a reply.
    sends:
      'A new email in any connected inbox from a sender they name (from) or about a subject they name (words), or both. Only mail the app keeps is read: job, order, bill and booking mail and mail awaiting a reply.',
    table: 'core.ingested_messages',
    params: ['from', 'words'],
    required: ['words|from'],
    read: async (ctx) => {
      let q = ctx.db('core')
        .from('ingested_messages')
        .select('id, from_address, subject, received_at, account:email_accounts!inner(user_id)')
        .eq('account.user_id', ctx.userId);
      if (ctx.params.from) q = q.ilike('from_address', likeOf(ctx.params.from).replace(/\*/g, '%'));
      const words = ctx.params.words ?? [];
      if (words.length) q = q.or(words.map((w) => `subject.ilike.${likeOf(w)}`).join(','));
      if (ctx.since) q = q.gt('received_at', ctx.since);
      const data = await rows(q.order('received_at', { ascending: false }).limit(KIND_ROWS), 'core.ingested_messages');
      return data.flatMap((r) => {
        const ref = asText(r.id);
        if (!ref) return [];
        return [{ table: 'core.ingested_messages', ref, title: `${asText(r.from_address) ?? 'Someone'}: ${asText(r.subject) ?? '(no subject)'}`, at: asText(r.received_at) }];
      });
    },
  },
  {
    kind: 'learn_videos',
    area: 'Learn',
    sends: 'New videos Dash judged worth watching for one of their subjects.',
    table: 'learn.watch_list',
    params: [],
    read: async (ctx) => {
      let q = ctx.db('learn')
        .from('watch_list')
        .select('video_id, why, judged_at, item:catalogue_items!watch_list_item_id_fkey(title)')
        .eq('user_id', ctx.userId)
        .eq('verdict', 'watch')
        .is('watched_at', null)
        .not('judged_at', 'is', null);
      if (ctx.since) q = q.gt('judged_at', ctx.since);
      const data = await rows(q.order('judged_at', { ascending: false }).limit(KIND_ROWS), 'learn.watch_list');
      return data.flatMap((r) => {
        const ref = asText(r.video_id);
        if (!ref) return [];
        const title = asText(((r.item ?? {}) as Record<string, unknown>).title) ?? ref;
        const why = asText(r.why);
        return [{ table: 'learn.watch_list', ref, title: `${title}${why ? `: ${why}` : ''}`, at: asText(r.judged_at) }];
      });
    },
  },
  {
    kind: 'review_due',
    area: 'Learn',
    sends: 'Review questions in Learn waiting for an answer; named again while they wait.',
    table: 'learn.review_questions',
    params: [],
    read: async (ctx) => {
      const data = await rows(
        ctx.db('learn')
          .from('review_questions')
          .select('id, question')
          .eq('user_id', ctx.userId)
          .is('answered_at', null)
          .order('created_at', { ascending: true })
          .limit(KIND_ROWS),
        'learn.review_questions',
      );
      return data.flatMap((r) => {
        const ref = asText(r.id);
        return ref ? [{ table: 'learn.review_questions', ref, title: asText(r.question) ?? 'A question', at: null }] : [];
      });
    },
  },
  {
    kind: 'goal_stalled',
    area: 'Goals',
    sends: 'A goal the daily review marked stalled, with the next move it named.',
    table: 'goals.items',
    params: [],
    read: async (ctx) => {
      let q = ctx.db('goals').from('reviews').select('item_id, reason, next_move, created_at').eq('user_id', ctx.userId).eq('verdict', 'stalled');
      if (ctx.since) q = q.gt('created_at', ctx.since);
      const data = await rows(q.order('created_at', { ascending: false }).limit(KIND_ROWS), 'goals.reviews');
      const ids = [...new Set(data.map((r) => asText(r.item_id)).filter((id): id is string => Boolean(id)))];
      if (!ids.length) return [];
      const goals = await rows(
        ctx.db('goals').from('items').select('id, title, closed_at, archived_at').eq('user_id', ctx.userId).in('id', ids),
        'goals.items',
      );
      const open = new Map(goals.filter((g) => !g.closed_at && !g.archived_at).map((g) => [String(g.id), asText(g.title) ?? 'A goal']));
      const seen = new Set<string>();
      return data.flatMap((r) => {
        const id = asText(r.item_id);
        if (!id || seen.has(id) || !open.has(id)) return [];
        seen.add(id);
        const next = asText(r.next_move);
        return [{ table: 'goals.items', ref: id, title: `${open.get(id)}${next ? `; next move: ${next}` : ''}`, at: asText(r.created_at) }];
      });
    },
  },
];

const BY_KIND = new Map(REACH_OUT_KINDS.map((k) => [k.kind, k]));

export function reachOutKind(kind: string | undefined | null): ReachOutKind | null {
  return kind ? (BY_KIND.get(kind) ?? null) : null;
}

/**
 * The params a kind reads, cleaned: unknown ones dropped, words trimmed, the
 * default days filled in. Null when a param the kind cannot run without is
 * missing, which sends the ask to cannot_watch.
 */
export function kindParams(def: ReachOutKind, raw: Record<string, unknown> | null | undefined): ReachOutParams | null {
  const out: ReachOutParams = {};
  const given = raw ?? {};
  if (def.params.includes('words') && Array.isArray(given.words)) {
    const words = [...new Set(given.words.map((w) => (typeof w === 'string' ? w.trim().slice(0, 60) : '')).filter(Boolean))].slice(0, 8);
    if (words.length) out.words = words;
  }
  if (def.params.includes('amount') && typeof given.amount === 'number' && given.amount > 0 && given.amount <= 10_000_000) {
    out.amount = given.amount;
  }
  if (def.params.includes('days')) {
    const days = typeof given.days === 'number' && Number.isInteger(given.days) && given.days >= 1 && given.days <= 90 ? given.days : def.defaultDays;
    if (days) out.days = days;
  }
  if (def.params.includes('from') && typeof given.from === 'string' && given.from.trim()) out.from = given.from.trim().slice(0, 200);
  for (const need of def.required ?? []) {
    if (need === 'words|from' ? !out.words && !out.from : out[need] === undefined) return null;
  }
  return out;
}

/** A kind's rows for a watch, or none for a kind this build does not know. */
export async function readKindRows(watch: Pick<ReachOutWatch, 'kind' | 'params'>, ctx: Omit<KindContext, 'params'>): Promise<KindRow[]> {
  const def = reachOutKind(watch.kind);
  if (!def) return [];
  return def.read({ ...ctx, params: watch.params ?? {} });
}
