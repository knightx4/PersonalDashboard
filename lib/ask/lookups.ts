import { loadLatestReviews } from '@/lib/goals/reviews-store';
import { VERDICT_LABELS } from '@/lib/goals/reviews';
import type { GoalsSupabaseClient } from '@/lib/goals/db/schema-name';
import {
  formatMoney,
  monthlySpendByMerchant,
  spendByMerchant,
  type MerchantSpendOrder,
} from '@/lib/money';
import type { ModuleId } from '@/lib/modules';
import { searchEverything } from '@/lib/search/search';
import { HIT_KINDS, type HitKind } from '@/lib/search/sources';
import { SOURCES } from '@/lib/sources/catalogue';
import { readableName, type Source } from '@/lib/sources/types';
import { noteHref } from '@/lib/vault/paths';
import { transcriptHref } from '@/lib/you/education';
import { recordSpend, type SpendClient } from '@/lib/core/spend/record';
import { fileHref } from '@/lib/files/files';
import { refHref, toRef } from '@/lib/core/refs';
import type { Author } from '@/lib/memory/passages';
import {
  DEV_MEMORY_SOURCES,
  RECALL_OPERATION,
  groupByRow,
  memorySourcesFor,
  searchMemory,
  splitPassage,
  type MemoryRowHit,
} from '@/lib/memory/search';
import {
  AskInputError,
  clip,
  daysBefore,
  isUuid,
  matchedNote,
  nextDay,
  optionalDate,
  optionalString,
  readIn,
  type AskContext,
  type AskRow,
  type AskSchema,
  type AskToolResult,
} from './db';
import { devAccess, devRecallHrefs } from './dev';
import { deriveApplicationState, type ApplicationStatus, type PipelineEvent } from '@/lib/jobs/pipeline';
import { stepHref } from '@/lib/goals/all-goals';

/**
 * Each of Dash's read tools (plan #1088), as a function of its input and the
 * asker. The definitions the model is sent, and the dispatch that checks the
 * workspace is on and that every row has a link, are in tools.ts.
 *
 * Every read is filtered to `ctx.userId` as well as scoped by row level
 * security, so a lookup handed a client that could see more still answers
 * for one person. Nothing here writes.
 */

type Input = Record<string, unknown>;

/** The most rows any one lookup lists. Totals are over everything read, not just these. */
export const MAX_ROWS = 50;

// ---------------------------------------------------------------------------
// search: the command box's registry, all eight sources
// ---------------------------------------------------------------------------

/** Which table a search hit is a row of, for its citation. */
export const HIT_TABLES: Record<HitKind, string> = {
  company: 'job_search.companies',
  role: 'job_search.roles',
  contact: 'job_search.contacts',
  order: 'public.orders',
  inventory: 'public.inventory_items',
  saved: 'public.saved_items',
  task: 'todo.tasks',
  note: 'obsidian.notes',
  course: 'you.courses',
  reading: 'learn.readings',
  track: 'learn.tracks',
  subject: 'learn.subjects',
  plan: 'public.plan_items',
  // A spec is a file in docs/, not a row; its ref is the slug.
  spec: 'docs.specs',
  idea: 'public.ideas',
  feedback: 'public.feedback_items',
  raise: 'public.raised_items',
  // A vision's ref is its workspace id, or `app` for the app as a whole.
  vision: 'public.module_visions',
  // A story is one entry in an issue's list; its ref is `<issue id>:<index>`.
  story: 'news.issues',
  area: 'goals.areas',
  goal: 'goals.items',
  step: 'goals.items',
  file: 'core.files',
};

export const HIT_KIND_IDS = Object.keys(HIT_KINDS) as HitKind[];

export async function searchLookup(ctx: AskContext, input: Input): Promise<AskToolResult> {
  const query = optionalString(input, 'query');
  if (!query || query.length < 2) throw new AskInputError('query needs at least two characters.');
  const kinds = Array.isArray(input.kinds)
    ? (input.kinds.filter((k) => typeof k === 'string' && k in HIT_KINDS) as HitKind[])
    : undefined;

  const { hits, failed, found, capped } = await searchEverything({
    userId: ctx.userId,
    query,
    sources: [...ctx.searchSources],
    enabledModules: ctx.enabledModules,
    kinds: kinds && kinds.length > 0 ? kinds : undefined,
    perSourceLimit: 8,
    totalLimit: 20,
    db: ctx.db,
  });

  return {
    ok: true,
    rows: hits.map((hit) => ({
      table: HIT_TABLES[hit.kind],
      ref: hit.id,
      title: hit.title,
      href: hit.href,
      detail: { kind: HIT_KINDS[hit.kind], about: hit.subtitle },
    })),
    note:
      'Matches titles and names only, not the words inside a row. ' +
      (failed.length > 0 ? `Could not read: ${failed.join(', ')}. ` : '') +
      `${matchedNote(found ?? hits.length, hits.length, capped === true)}.`,
  };
}

// ---------------------------------------------------------------------------
// open: one row by catalogue entry and ref
// ---------------------------------------------------------------------------

/** The workspace each schema's rows show in, for the switched-off check. */
export const SCHEMA_MODULES: Record<AskSchema, ModuleId> = {
  public: 'shopping',
  core: 'goals',
  job_search: 'jobs',
  obsidian: 'vault',
  todo: 'todo',
  learn: 'learn',
  news: 'news',
  goals: 'goals',
  you: 'you',
};

/** Where the catalogue's link is a list page and a row can be pointed at more closely. */
const BETTER_HREFS: Record<string, (ref: string) => string> = {
  'todo.tasks': (id) => `/todo/all?status=all&focus=${id}`,
};

/** The owner column, when a table is tied to its owner by one; null when through a join. */
function ownerColumn(source: Source): string | null {
  if (!source.owner) return 'user_id';
  return /^\w+$/.test(source.owner) ? source.owner : null;
}

/**
 * The catalogue entries a row can be opened from: those with a page to link
 * to, tied to their owner by a column this read can filter on, in a schema
 * with a client.
 */
export const OPENABLE: readonly Source[] = SOURCES.filter(
  (s) => s.href && ownerColumn(s) !== null && s.table.split('.')[0] in SCHEMA_MODULES,
);

export function openableSource(table: string): Source | null {
  return OPENABLE.find((s) => s.table === table) ?? null;
}

/**
 * How much of one long text column open_row returns at a time. Before, every
 * column was flattened onto one line and cut at 1,500 characters, with no way
 * to read on: asked where they left off on a take-home exercise, Dash could
 * only see the opening of the note and said so (21 October 2026).
 */
export const OPEN_PART_CHARS = 8000;

/**
 * Text as a person wrote it, line breaks kept and runs of blank lines and
 * spaces closed up, split into parts of about OPEN_PART_CHARS at a line
 * break where one is near.
 */
export function textParts(text: string, size: number = OPEN_PART_CHARS): string[] {
  const tidy = text
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  const parts: string[] = [];
  let rest = tidy;
  while (rest.length > size) {
    const window = rest.slice(0, size);
    const at = Math.max(window.lastIndexOf('\n'), window.lastIndexOf('. ') + 1);
    const cut = at > size / 2 ? at : size;
    parts.push(rest.slice(0, cut).trimEnd());
    rest = rest.slice(cut).trimStart();
  }
  if (rest) parts.push(rest);
  return parts;
}

export async function openLookup(ctx: AskContext, input: Input): Promise<AskToolResult> {
  const table = optionalString(input, 'table');
  const ref = optionalString(input, 'ref');
  if (!table || !ref) throw new AskInputError('Give both table and ref.');
  const part = input.part === undefined || input.part === null ? 1 : Number(input.part);
  if (!Number.isInteger(part) || part < 1) throw new AskInputError('part is a whole number from 1.');
  const source = openableSource(table);
  if (!source) throw new AskInputError(`${table} is not a table that can be opened.`);

  const [schema, name] = table.split('.') as [AskSchema, string];
  const refColumn = source.ref ?? 'id';
  const owner = ownerColumn(source) as string;
  // A row found by search is named by id even where the catalogue links it by
  // something else (a note by path, a company by slug), so an id is taken too.
  const byId = refColumn !== 'id' && refColumn !== owner && isUuid(ref);
  const columns = [
    ...new Set([refColumn, ...(refColumn !== owner ? ['id'] : []), source.title, ...source.search, ...(source.facts ?? [])]),
  ];

  const client = await ctx.db(schema);
  const { data, error } = await client
    .from(readableName(source))
    .select(columns.join(', '))
    .eq(owner, ctx.userId)
    .eq(byId ? 'id' : refColumn, ref)
    .limit(1);
  if (error) throw new Error(`${table}: ${error.message}`);
  const row = ((data ?? []) as unknown as Record<string, unknown>[])[0];
  if (!row) return { ok: true, rows: [], note: `No ${table} row ${ref} of theirs.` };

  const canonical = String(row[refColumn] ?? row.id ?? ref);
  const href = (BETTER_HREFS[table] ?? source.href!)(canonical);
  const detail: Record<string, string | null> = {};
  const longer: string[] = [];
  let more = false;
  for (const column of source.search) {
    const text = asText(row[column]);
    const parts = text ? textParts(text) : [];
    if (part > Math.max(parts.length, 1)) continue;
    detail[column] = parts[part - 1] ?? null;
    if (parts.length > 1) longer.push(`${column} is part ${part} of ${parts.length}`);
    if (parts.length > part) more = true;
  }
  if (part > 1 && Object.keys(detail).length === 0) {
    throw new AskInputError(`${table} row ${ref} has no part ${part}: its text is shorter than that.`);
  }
  if (part === 1) {
    for (const column of source.facts ?? []) detail[column] = clip(asText(row[column]), 1500);
    const comments = typeof row.id === 'string' ? await rowThread(ctx, table, row.id) : null;
    if (comments) detail.comments = comments;
  }
  const note =
    longer.length === 0
      ? undefined
      : more
        ? `Long text: ${longer.join('; ')}. Call open_row with the same table and ref and part ${part + 1} to read on.`
        : `Long text: ${longer.join('; ')}. This is the last part.`;

  return {
    ok: true,
    ...(note ? { note } : {}),
    rows: [
      {
        table,
        ref: canonical,
        title: clip(asText(row[source.title]), 200) ?? canonical,
        href,
        detail,
      },
    ],
  };
}

/** The most recent comments open_row reads from under a row. */
export const ROW_THREAD_TURNS = 8;

/**
 * The newest comments under a row, oldest of them first, one line each.
 *
 * Prepare with Dash and a comment tagged @dash both answer on the row's own
 * thread, so this is where "did that finish, and where is it" is answered
 * (notes 1527e0bf, ae78d95e). A thread that cannot be read leaves the row as
 * it was rather than failing the open.
 */
async function rowThread(ctx: AskContext, table: string, id: string): Promise<string | null> {
  try {
    const { data, error } = await (await ctx.db('core'))
      .from('thread_turns')
      .select('author, body, created_at')
      .eq('user_id', ctx.userId)
      .eq('ref', toRef(table, id))
      .order('created_at', { ascending: false })
      .limit(ROW_THREAD_TURNS);
    if (error) throw new Error(error.message);
    const turns = (data ?? []) as unknown as { author: string; body: string; created_at: string }[];
    if (turns.length === 0) return null;
    return turns
      .reverse()
      .map((turn) => {
        const who = turn.author === 'claude' ? 'Dash' : turn.author === 'me' ? 'You' : turn.author;
        return `[${turn.created_at.slice(0, 16).replace('T', ' ')}] ${who}: ${clip(turn.body, 1200)}`;
      })
      .join('\n');
  } catch (error) {
    console.error('ask open_row thread', error instanceof Error ? error.message : error);
    return null;
  }
}

function asText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value;
  return JSON.stringify(value);
}

// ---------------------------------------------------------------------------
// spend: by merchant and month
// ---------------------------------------------------------------------------

type OrderRow = {
  id: string;
  merchant_id: string | null;
  external_order_number: string | null;
  order_date: string;
  total_cents: number;
  currency: string;
  cancelled_at: string | null;
  status: string;
};

type RefundRow = { id: string; order_id: string; refund_amount_cents: number; refunded_at: string };

function monthsSpanned(from: string, to: string): number {
  const [fy, fm] = from.split('-').map(Number);
  const [ty, tm] = to.split('-').map(Number);
  return (ty - fy) * 12 + (tm - fm) + 1;
}

export async function spendLookup(ctx: AskContext, input: Input): Promise<AskToolResult> {
  const from = optionalDate(input, 'from');
  const to = optionalDate(input, 'to') ?? ctx.today;
  if (!from) throw new AskInputError('from is required.');
  if (from > to) throw new AskInputError('from is after to.');
  const merchantQuery = optionalString(input, 'merchant')?.toLowerCase() ?? null;

  const db = await ctx.db('public');
  const { data, error } = await db
    .from('orders')
    .select(
      'id, merchant_id, external_order_number, order_date, total_cents, currency, cancelled_at, status',
    )
    .eq('user_id', ctx.userId)
    .is('deleted_at', null)
    .gte('order_date', from)
    .lte('order_date', to)
    .order('order_date', { ascending: false });
  if (error) throw new Error(`orders: ${error.message}`);
  const placed = (data ?? []) as OrderRow[];

  const refunds = await (async () => {
    const { data: rows, error: refundError } = await db
      .from('returns')
      .select('id, order_id, refund_amount_cents, refunded_at')
      .eq('user_id', ctx.userId)
      .eq('status', 'refunded')
      .gte('refunded_at', from)
      .lte('refunded_at', to);
    if (refundError) throw new Error(`returns: ${refundError.message}`);
    return (rows ?? []) as RefundRow[];
  })();

  // A refund can land on an order placed before the period, so its order is
  // read on its own to know the merchant and currency.
  const placedIds = new Set(placed.map((o) => o.id));
  const earlier = await readIn<OrderRow>(
    db,
    'orders',
    'id, merchant_id, external_order_number, order_date, total_cents, currency, cancelled_at, status',
    'id',
    refunds.map((r) => r.order_id).filter((id) => !placedIds.has(id)),
    ctx.userId,
  );
  const ordersById = new Map([...placed, ...earlier].map((o) => [o.id, o]));

  const merchantIds = [...ordersById.values()]
    .map((o) => o.merchant_id)
    .filter((id): id is string => id !== null);
  // Merchants are shared across accounts, so they have no owner to filter on.
  const merchants = await readIn<{ id: string; name: string }>(
    db,
    'merchants',
    'id, name',
    'id',
    merchantIds,
    null,
  );
  const merchantName = new Map(merchants.map((m) => [m.id, m.name]));
  const nameOf = (o: OrderRow) =>
    (o.merchant_id && merchantName.get(o.merchant_id)) || 'Unknown merchant';
  const wanted = (o: OrderRow) => !merchantQuery || nameOf(o).toLowerCase().includes(merchantQuery);

  const orders = placed.filter(wanted);
  const cancelled = (o: OrderRow) => o.cancelled_at !== null || o.status === 'cancelled';
  const refundsHere = refunds.filter((r) => {
    const order = ordersById.get(r.order_id);
    return order !== undefined && wanted(order);
  });

  // Per currency: adding dollars to pounds gives a number that means nothing.
  const currencies = [...new Set(orders.map((o) => o.currency))].sort();
  const months = Math.min(monthsSpanned(from, to), 24);
  const byMerchant: Record<string, unknown>[] = [];
  const rows: AskRow[] = [];

  for (const currency of currencies) {
    const inCurrency: MerchantSpendOrder[] = orders
      .filter((o) => o.currency === currency)
      .map((o) => ({
        orderDate: o.order_date,
        totalCents: o.total_cents,
        cancelled: cancelled(o),
        merchantId: o.merchant_id,
        merchantName: nameOf(o),
      }));
    const monthly = monthlySpendByMerchant(inCurrency, to, months);
    for (const slice of spendByMerchant(inCurrency, { start: from, end: to })) {
      const key = slice.merchantId ?? '__unknown__';
      byMerchant.push({
        merchant: slice.name,
        currency,
        spent: formatMoney(slice.cents, currency),
        cents: slice.cents,
        orders: inCurrency.filter((o) => (o.merchantId ?? '__unknown__') === key && !o.cancelled)
          .length,
        by_month: (monthly.get(key) ?? [])
          .filter((p) => p.cents > 0)
          .map((p) => ({ month: p.month, spent: formatMoney(p.cents, currency) })),
      });
      if (slice.merchantId) {
        rows.push({
          table: 'public.merchants',
          ref: slice.merchantId,
          title: slice.name,
          href: `/shopping/orders?range=last_12_months&merchant=${slice.merchantId}`,
          detail: { currency, spent: formatMoney(slice.cents, currency) },
        });
      }
    }
  }

  const counted = orders.filter((o) => !cancelled(o));
  for (const order of counted.slice(0, MAX_ROWS)) {
    rows.push({
      table: 'public.orders',
      ref: order.id,
      title: `${nameOf(order)} order${order.external_order_number ? ` ${order.external_order_number}` : ''}`,
      href: `/shopping/orders/${order.id}`,
      detail: {
        date: order.order_date,
        total: formatMoney(order.total_cents, order.currency),
        status: order.status,
      },
    });
  }
  for (const refund of refundsHere.slice(0, MAX_ROWS)) {
    const order = ordersById.get(refund.order_id)!;
    rows.push({
      table: 'public.returns',
      ref: refund.id,
      title: `Refund on ${nameOf(order)} order${order.external_order_number ? ` ${order.external_order_number}` : ''}`,
      href: `/shopping/orders/${order.id}`,
      detail: {
        refunded_on: refund.refunded_at,
        amount: formatMoney(refund.refund_amount_cents, order.currency),
      },
    });
  }

  const refundedByCurrency: Record<string, string> = {};
  for (const currency of new Set(refundsHere.map((r) => ordersById.get(r.order_id)!.currency))) {
    const cents = refundsHere
      .filter((r) => ordersById.get(r.order_id)!.currency === currency)
      .reduce((sum, r) => sum + r.refund_amount_cents, 0);
    refundedByCurrency[currency] = formatMoney(cents, currency);
  }

  return {
    ok: true,
    rows,
    totals: {
      from,
      to,
      merchant_filter: merchantQuery,
      orders_counted: counted.length,
      by_merchant: byMerchant,
      refunds_landed_in_period: refundedByCurrency,
    },
    note:
      'Spend is orders placed in the period, cancelled ones left out. Refunds are counted in the period they landed, not taken off the merchant totals.' +
      (counted.length > MAX_ROWS ? ` Only the newest ${MAX_ROWS} orders are listed.` : ''),
  };
}

// ---------------------------------------------------------------------------
// applications: by status and date, with the stage a rejection came at
// ---------------------------------------------------------------------------

type ApplicationRow = {
  id: string;
  role_id: string;
  status: string;
  status_manual_override: string | null;
  submitted_at: string | null;
  closed_at: string | null;
  outcome: string | null;
  rejection_stage: string | null;
  rejection_stage_override: string | null;
  next_action: string | null;
  next_action_due: string | null;
  created_at: string;
};

/** Still waiting on the company: what "heard nothing from" is asked about. */
const OPEN_STATUSES = ['submitted', 'acknowledged', 'in_process', 'final_round'];

/** Events that are the company saying something, rather than the person doing something. */
const HEARD_KINDS = new Set([
  'confirmation',
  'recruiter_reply',
  'screen_scheduled',
  'assessment_sent',
  'interview_scheduled',
  'offer',
  'rejection',
]);

export const APPLICATION_STATUSES = [
  'lead',
  'drafting',
  'submitted',
  'acknowledged',
  'in_process',
  'final_round',
  'offer',
  'rejected',
  'withdrawn',
  'ghosted',
  'role_closed',
] as const;

/** The most applications read before filtering. */
const APPLICATIONS_READ = 1000;

type EventRow = {
  application_id: string;
  kind: string;
  occurred_at: string;
  source: PipelineEvent['source'];
  payload: PipelineEvent['payload'];
};

/**
 * An application's status as it stood at `at`, folded from its events up to
 * then, the way the status itself is folded (lib/jobs/pipeline.ts). A move by
 * hand is a status_override event carrying the status it moved to, so the
 * latest one before `at` is the override that held then (note 4056ed9d).
 * Going quiet is not a change anybody made, so it never reads as ghosted.
 */
export function statusAt(events: readonly EventRow[], at: Date): ApplicationStatus {
  const before = events
    .filter((event) => new Date(event.occurred_at) < at)
    .map((event) => ({
      kind: event.kind as PipelineEvent['kind'],
      occurredAt: new Date(event.occurred_at),
      source: event.source,
      payload: event.payload,
    }));
  const override = before
    .filter((event) => event.kind === 'status_override' && event.payload?.status)
    .sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime())
    .at(-1)?.payload?.status;
  return deriveApplicationState(before, {
    manualOverride: override ?? null,
    now: at,
    ghostThresholdDays: Number.POSITIVE_INFINITY,
  }).status;
}

/** Statuses of an application that was never sent. */
const NOT_SENT_STATUSES = ['lead', 'drafting'];

export async function applicationsLookup(ctx: AskContext, input: Input): Promise<AskToolResult> {
  const from = optionalDate(input, 'from');
  const to = optionalDate(input, 'to');
  const statuses = Array.isArray(input.status)
    ? input.status.filter((s): s is string => typeof s === 'string')
    : [];
  const quietDays =
    typeof input.quiet_for_days === 'number' && input.quiet_for_days > 0
      ? Math.floor(input.quiet_for_days)
      : null;
  const noReply = input.no_reply === true;
  // Dated by a change of status rather than by the day sent: "what did I move
  // to submitted this week that wasn't before" (note 4056ed9d).
  const changed = input.changed_status === true;
  const changedFrom = from ?? daysBefore(ctx.today, 6);
  const changedTo = to ?? ctx.today;

  const db = await ctx.db('job_search');
  const query = db
    .from('applications')
    .select(
      'id, role_id, status, status_manual_override, submitted_at, closed_at, outcome, rejection_stage, rejection_stage_override, next_action, next_action_due, created_at',
    )
    .eq('user_id', ctx.userId);
  // Not narrowed by date here: an application is dated by when it was sent,
  // which can be long after the row was added, so the period is applied below.
  const { data, error } = await query.order('created_at', { ascending: false }).limit(APPLICATIONS_READ);
  if (error) throw new Error(`applications: ${error.message}`);
  let applications = (data ?? []) as ApplicationRow[];
  // Filters below run over what was read, so a full read means the count is a floor.
  const readCapped = applications.length >= APPLICATIONS_READ;

  const roles = await readIn<{ id: string; title: string; company_id: string | null }>(
    db,
    'roles',
    'id, title, company_id',
    'id',
    applications.map((a) => a.role_id),
    ctx.userId,
  );
  const companies = await readIn<{ id: string; name: string; slug: string | null }>(
    db,
    'companies',
    'id, name, slug',
    'id',
    roles.map((r) => r.company_id).filter((id): id is string => id !== null),
    ctx.userId,
  );
  const events = await readIn<EventRow>(
    db,
    'application_events',
    'application_id, kind, occurred_at, source, payload',
    'application_id',
    applications.map((a) => a.id),
    ctx.userId,
  );

  const roleById = new Map(roles.map((r) => [r.id, r]));
  const companyById = new Map(companies.map((c) => [c.id, c]));
  const lastHeard = new Map<string, string>();
  const replied = new Set<string>();
  for (const event of events) {
    if (!HEARD_KINDS.has(event.kind)) continue;
    if (event.kind !== 'confirmation') replied.add(event.application_id);
    const held = lastHeard.get(event.application_id);
    if (!held || event.occurred_at > held) lastHeard.set(event.application_id, event.occurred_at);
  }
  const statusOf = (a: ApplicationRow) => a.status_manual_override ?? a.status;
  const sentOn = (a: ApplicationRow) => (a.submitted_at ?? a.created_at).slice(0, 10);

  // Its status when the period began and when it ended, for changed_status.
  const moves = new Map<string, { before: string; after: string }>();
  if (changed) {
    const eventsOf = new Map<string, EventRow[]>();
    for (const event of events) {
      eventsOf.set(event.application_id, [...(eventsOf.get(event.application_id) ?? []), event]);
    }
    const start = new Date(`${changedFrom}T00:00:00Z`);
    const end = new Date(`${nextDay(changedTo)}T00:00:00Z`);
    for (const a of applications) {
      const own = eventsOf.get(a.id) ?? [];
      // By its events, not by when the row was added: an import added this
      // week can carry a send from last month.
      const before = statusAt(own, start);
      const after = statusAt(own, end);
      if (new Date(a.created_at) < end && before !== after) moves.set(a.id, { before, after });
    }
    applications = applications.filter((a) => moves.has(a.id));
  }

  // Dated by when it was sent; one never sent is dated by when it was added.
  if (!changed && (from || to)) {
    applications = applications.filter((a) => {
      const day = sentOn(a);
      return (!from || day >= from) && (!to || day <= to);
    });
  }
  // With changed_status, the status it changed to in the period.
  const statusFor = (a: ApplicationRow) => moves.get(a.id)?.after ?? statusOf(a);
  if (statuses.length > 0) applications = applications.filter((a) => statuses.includes(statusFor(a)));
  // Sent, and nothing from a person since: an automatic confirmation is not a reply.
  if (noReply) applications = applications.filter((a) => a.submitted_at !== null && !replied.has(a.id));
  if (quietDays !== null) {
    const since = daysBefore(ctx.today, quietDays);
    applications = applications.filter(
      (a) =>
        OPEN_STATUSES.includes(statusOf(a)) &&
        (lastHeard.get(a.id) ?? a.submitted_at ?? a.created_at).slice(0, 10) < since,
    );
  }

  const byStatus: Record<string, number> = {};
  const rejectedAt: Record<string, number> = {};
  for (const a of applications) {
    const status = statusFor(a);
    byStatus[status] = (byStatus[status] ?? 0) + 1;
    if (status === 'rejected') {
      const stage = a.rejection_stage_override ?? a.rejection_stage ?? 'unknown';
      rejectedAt[stage] = (rejectedAt[stage] ?? 0) + 1;
    }
  }

  // "How many have I applied to": a lead or a draft was never sent. One with no
  // sent day (added by hand, already past that stage) still counts, dated by
  // the day it was added; the thumbs down of turn 43830566 was a count of 2
  // taken from the sent days alone when 40 had been added and sent on.
  const sentApplications = applications.filter((a) => !NOT_SENT_STATUSES.includes(statusFor(a)));
  const sentWithoutDay = sentApplications.filter((a) => a.submitted_at === null).length;

  const rows: AskRow[] = applications.slice(0, MAX_ROWS).map((a) => {
    const role = roleById.get(a.role_id);
    const company = role?.company_id ? companyById.get(role.company_id) : undefined;
    const status = statusOf(a);
    return {
      table: 'job_search.applications',
      ref: a.id,
      title: `${role?.title ?? 'A role'}${company ? ` at ${company.name}` : ''}`,
      // The role's page carries its application; the pipeline is one long list.
      href: role ? `/jobs/roles/${role.id}` : '/jobs/pipeline',
      detail: {
        company: company?.name ?? null,
        status,
        sent_on: a.submitted_at ? a.submitted_at.slice(0, 10) : null,
        last_heard_on: lastHeard.get(a.id)?.slice(0, 10) ?? null,
        closed_on: a.closed_at?.slice(0, 10) ?? null,
        rejected_at_stage:
          status === 'rejected' ? (a.rejection_stage_override ?? a.rejection_stage ?? 'unknown') : null,
        next_action: a.next_action,
        next_action_due: a.next_action_due,
        ...(changed
          ? { status_before: moves.get(a.id)?.before, status_after: statusFor(a) }
          : {}),
      },
    };
  });

  return {
    ok: true,
    rows,
    totals: {
      count: applications.length,
      sent: sentApplications.length,
      sent_without_sent_day: sentWithoutDay,
      by_status: byStatus,
      rejected_at_stage: rejectedAt,
    },
    note:
      `sent counts the applications that are not a lead or a draft; ${sentWithoutDay} of them have no sent day and are dated by the day they were added. For "how many did I apply to" answer with sent, and say how many have no sent day. ` +
      (noReply
        ? 'Sent applications with no reply from the company: no reply, screen, assessment, interview, offer or rejection, an automatic confirmation aside. '
        : '') +
      (changed
        ? `Applications whose status changed between ${changedFrom} and ${changedTo}: status_before is what it was when the period began, status_after what it was at the end. `
        : '') +
      (quietDays !== null
        ? `Open applications with nothing heard from the company in the ${quietDays} days before ${ctx.today}; last heard is the newest reply, screen, interview, offer or rejection, or the day it was sent when nothing came back. `
        : '') +
      `${matchedNote(applications.length, rows.length, readCapped)}.`,
  };
}

// ---------------------------------------------------------------------------
// todos: done in a period, and overdue now
// ---------------------------------------------------------------------------

type TaskRow = {
  id: string;
  title: string;
  status: string;
  due_on: string | null;
  completed_at: string | null;
};

const TASK_COLUMNS = 'id, title, status, due_on, completed_at';

const taskHref = (id: string) => `/todo/all?status=all&focus=${id}`;

export async function todosLookup(ctx: AskContext, input: Input): Promise<AskToolResult> {
  const from = optionalDate(input, 'from') ?? daysBefore(ctx.today, 6);
  const to = optionalDate(input, 'to') ?? ctx.today;
  if (from > to) throw new AskInputError('from is after to.');

  const client = await ctx.db('todo');
  const [done, overdue, tagged] = await Promise.all([
    client
      .from('tasks')
      .select(TASK_COLUMNS)
      .eq('user_id', ctx.userId)
      .eq('status', 'done')
      .gte('completed_at', from)
      .lt('completed_at', nextDay(to))
      .order('completed_at', { ascending: false }),
    client
      .from('tasks')
      .select(TASK_COLUMNS)
      .eq('user_id', ctx.userId)
      .eq('status', 'open')
      .lt('due_on', ctx.today)
      .order('due_on', { ascending: true }),
    // Every tag they use, so Dash tags a todo with theirs rather than new ones.
    client.from('task_tags').select('task_id, tag, tasks!inner(user_id)').eq('tasks.user_id', ctx.userId),
  ]);
  if (done.error) throw new Error(`tasks: ${done.error.message}`);
  if (overdue.error) throw new Error(`tasks: ${overdue.error.message}`);
  if (tagged.error) throw new Error(`task_tags: ${tagged.error.message}`);
  const tagRows = (tagged.data ?? []) as { task_id: string; tag: string }[];
  const tagsInUse = [...new Set(tagRows.map((row) => row.tag))].sort((a, b) => a.localeCompare(b));
  /** A row's tags, by name and comma-separated, or null for none (plan #2340.4). */
  const taskTags = (task: TaskRow): string | null =>
    tagRows
      .filter((row) => row.task_id === task.id)
      .map((row) => row.tag)
      .sort((a, b) => a.localeCompare(b))
      .join(', ') || null;
  const doneRows = (done.data ?? []) as TaskRow[];
  const overdueRows = (overdue.data ?? []) as TaskRow[];

  const rows: AskRow[] = [
    ...doneRows.slice(0, MAX_ROWS).map((t) => ({
      table: 'todo.tasks',
      ref: t.id,
      title: t.title,
      href: taskHref(t.id),
      detail: { list: 'done', done_on: t.completed_at?.slice(0, 10) ?? null, was_due: t.due_on, tags: taskTags(t) },
    })),
    ...overdueRows.slice(0, MAX_ROWS).map((t) => ({
      table: 'todo.tasks',
      ref: t.id,
      title: t.title,
      href: taskHref(t.id),
      detail: { list: 'overdue', due_on: t.due_on, tags: taskTags(t) },
    })),
  ];

  return {
    ok: true,
    rows,
    totals: { from, to, done: doneRows.length, overdue_today: overdueRows.length, tags_in_use: tagsInUse },
    note:
      `Done means finished between ${from} and ${to}; overdue means still open and due before ${ctx.today}. ` +
      `Done: ${matchedNote(doneRows.length, Math.min(doneRows.length, MAX_ROWS))}. Overdue: ${matchedNote(overdueRows.length, Math.min(overdueRows.length, MAX_ROWS))}.`,
  };
}

// ---------------------------------------------------------------------------
// goals: each goal's newest verdict
// ---------------------------------------------------------------------------

type GoalRow = { id: string; title: string; status: string; due_on: string | null };

export async function goalsLookup(ctx: AskContext, input: Input): Promise<AskToolResult> {
  const withProposed = input.include_proposed === true;
  const client = await ctx.db('goals');
  const { data, error } = await client
    .from('items')
    .select('id, title, status, due_on')
    .eq('user_id', ctx.userId)
    .eq('level', 'goal')
    .is('archived_at', null)
    .in('status', withProposed ? ['open', 'proposed'] : ['open'])
    .order('position', { ascending: true });
  if (error) throw new Error(`goals: ${error.message}`);
  const goals = (data ?? []) as GoalRow[];
  const latest = await loadLatestReviews(client as GoalsSupabaseClient, {
    userId: ctx.userId,
    now: ctx.now,
  });

  const byVerdict: Record<string, number> = {};
  const rows: AskRow[] = goals.slice(0, MAX_ROWS).map((goal) => {
    const review = latest.get(goal.id);
    const verdict = review ? VERDICT_LABELS[review.verdict] : 'Not reviewed in four weeks';
    byVerdict[verdict] = (byVerdict[verdict] ?? 0) + 1;
    return {
      table: 'goals.items',
      ref: goal.id,
      title: goal.title,
      href: `/goals/${goal.id}`,
      detail: {
        status: goal.status,
        due_on: goal.due_on,
        verdict,
        reviewed_on: review?.createdAt.slice(0, 10) ?? null,
        why: review?.reason ?? null,
        next_move: review?.nextMove ?? null,
        next_on: review?.nextOn ?? null,
      },
    };
  });

  return {
    ok: true,
    rows,
    totals: { goals: goals.length, by_verdict: byVerdict },
    note: `The verdict is the newest from the daily goals review in the last four weeks. ${matchedNote(goals.length, rows.length)}.`,
  };
}

// ---------------------------------------------------------------------------
// vault: notes changed in a period, or matching words in their text
// ---------------------------------------------------------------------------

type NoteRow = {
  id: string;
  path: string;
  title: string | null;
  body: string | null;
  git_updated_at: string | null;
};

/** The sentence or so around the first word of the query found in the body. */
function excerpt(body: string | null, query: string | null): string | null {
  if (!body) return null;
  const flat = body.replace(/\s+/g, ' ');
  if (query) {
    const words = query.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? [];
    const lower = flat.toLowerCase();
    for (const word of words) {
      const at = lower.indexOf(word);
      if (at >= 0) {
        const start = Math.max(0, at - 120);
        return `${start > 0 ? '…' : ''}${clip(flat.slice(start), 320)}`;
      }
    }
  }
  return clip(flat, 240);
}

export async function vaultLookup(ctx: AskContext, input: Input): Promise<AskToolResult> {
  const from = optionalDate(input, 'from');
  const to = optionalDate(input, 'to');
  const query = optionalString(input, 'query');
  if (!from && !to && !query) throw new AskInputError('Give a period (from, to), a query, or both.');

  const client = await ctx.db('obsidian');
  // readable_notes leaves out the notes that hold credentials.
  let read = client
    .from('readable_notes')
    .select('id, path, title, body, git_updated_at', { count: 'exact' })
    .eq('user_id', ctx.userId)
    .is('deleted_at', null);
  if (query) read = read.textSearch('search_tsv', query, { type: 'websearch', config: 'english' });
  if (from) read = read.gte('git_updated_at', from);
  if (to) read = read.lt('git_updated_at', nextDay(to));
  const { data, error, count } = await read
    .order('git_updated_at', { ascending: false, nullsFirst: false })
    .limit(MAX_ROWS);
  if (error) throw new Error(`notes: ${error.message}`);
  const notes = (data ?? []) as NoteRow[];
  const matched = Math.max(count ?? notes.length, notes.length);

  return {
    ok: true,
    rows: notes.map((note) => ({
      table: 'obsidian.notes',
      ref: note.path,
      title: note.title?.trim() || note.path.split('/').pop() || note.path,
      href: noteHref(note.path),
      detail: {
        folder: note.path.split('/').slice(0, -1).join('/') || null,
        changed_on: note.git_updated_at?.slice(0, 10) ?? null,
        excerpt: excerpt(note.body, query),
      },
    })),
    note:
      (query ? 'Matched on the words of the whole note, not just its title. ' : '') +
      (from || to ? 'Changed means last changed in the vault within the period. ' : '') +
      `${matchedNote(matched, notes.length)}.`,
  };
}

// ---------------------------------------------------------------------------
// recall: passages across the workspaces, by meaning (plan #1248)
// ---------------------------------------------------------------------------

/** Rows recall lists, and passages shown for each. */
export const RECALL_ROWS = 12;
const RECALL_PASSAGES_PER_ROW = 2;
const RECALL_PASSAGE_CHARS = 700;

/** Where a row with no page of its own, or one whose page could not be read, opens. */
const RECALL_LANDING: Record<string, string> = {
  'job_search.thoughts': '/jobs/settings#career-goals',
  'job_search.profiles': '/jobs/settings',
  'job_search.notes': '/jobs',
  'job_search.interviews': '/jobs',
  'goals.items': '/goals',
  'goals.captures': '/goals',
  'learn.aims': '/goals',
  'learn.card_notes': '/learn/now',
  'learn.feed_cards': '/learn/now',
  'public.order_items': '/shopping/orders',
  'public.plan_items': '/dev/plan',
  'you.dash_questions': '/you/answer',
};

/** What kind of thing each source is, for the model reading the result. */
const RECALL_KINDS: Record<string, string> = {
  'obsidian.notes': 'Vault note',
  'you.transcripts': 'Transcript (courses taken)',
  'you.dash_questions': 'Their answer to a question Dash asked',
  'job_search.thoughts': 'Job search thoughts',
  'job_search.notes': 'Job search note',
  'job_search.interviews': 'Interview notes',
  'job_search.profiles': 'Job search profile',
  'goals.items': 'Goal or step',
  'goals.captures': 'Goals capture',
  'core.files': 'File',
  'learn.aims': 'Learn aim',
  'learn.card_notes': 'Learn note',
  'learn.feed_cards': 'Learn card',
  'public.order_items': 'Purchase',
  'public.ideas': 'Idea (Dev)',
  'public.feedback_items': 'Bug or request (Dev)',
  'public.plan_items': 'Plan step (Dev)',
  'public.raised_items': 'Raise (Dev)',
  'docs.specs': 'Spec section (Dev)',
  'core.conversations': 'What the person said in a thread or to Ask',
};

const key = (table: string, ref: string) => `${table}\u0000${ref}`;

/**
 * Where a thread recall found opens: the row a row thread sits under, by its
 * ref, or the Ask conversation, whose ref is its own id (plan #1466).
 */
function threadHref(ref: string): string | null {
  if (ref.includes(':')) return refHref(ref);
  return isUuid(ref) ? `/ask/${ref}` : null;
}

/**
 * The page each row opens on. Most are the row's ref run through a fixed
 * pattern; a job search note, a goal step, a Learn note or card and a
 * purchase open on the page of the thing they belong to, which takes one read
 * per table. A read that fails leaves the workspace's landing page.
 */
async function recallHrefs(ctx: AskContext, hits: readonly MemoryRowHit[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const refs = (table: string) => hits.filter((h) => h.sourceTable === table).map((h) => h.sourceRef);

  for (const hit of hits) {
    const direct =
      hit.sourceTable === 'obsidian.notes'
        ? noteHref(hit.sourceRef)
        : hit.sourceTable === 'core.files'
          ? fileHref(hit.sourceRef)
          : hit.sourceTable === 'you.transcripts'
            ? transcriptHref(hit.sourceRef)
            : hit.sourceTable === 'core.conversations'
              ? threadHref(hit.sourceRef)
              : RECALL_LANDING[hit.sourceTable];
    if (direct) out.set(key(hit.sourceTable, hit.sourceRef), direct);
  }

  const reads: Promise<void>[] = [];
  const attempt = (label: string, work: () => Promise<void>) =>
    reads.push(
      work().catch((error) => {
        console.error(`ask recall links ${label}`, error instanceof Error ? error.message : error);
      }),
    );

  const jobNotes = refs('job_search.notes').filter(isUuid);
  if (jobNotes.length > 0) {
    attempt('job_search.notes', async () => {
      const client = await ctx.db('job_search');
      type NoteLink = { id: string; role_id: string | null; company_id: string | null; contact_id: string | null };
      const notes = await readIn<NoteLink>(client, 'notes', 'id, role_id, company_id, contact_id', 'id', jobNotes, ctx.userId);
      const companyIds = notes.filter((n) => !n.role_id && n.company_id).map((n) => n.company_id as string);
      const companies =
        companyIds.length > 0
          ? await readIn<{ id: string; slug: string | null }>(client, 'companies', 'id, slug', 'id', companyIds, ctx.userId)
          : [];
      const slugs = new Map(companies.map((c) => [c.id, c.slug]));
      for (const note of notes) {
        const slug = note.company_id ? slugs.get(note.company_id) : null;
        const href = note.role_id
          ? `/jobs/roles/${note.role_id}`
          : slug
            ? `/jobs/companies/${slug}`
            : note.contact_id
              ? `/jobs/contacts/${note.contact_id}`
              : null;
        if (href) out.set(key('job_search.notes', note.id), href);
      }
    });
  }

  // An interview opens on its role's page, by way of its application.
  const interviews = refs('job_search.interviews').filter(isUuid);
  if (interviews.length > 0) {
    attempt('job_search.interviews', async () => {
      const client = await ctx.db('job_search');
      type InterviewLink = { id: string; application_id: string | null };
      const rows = await readIn<InterviewLink>(client, 'interviews', 'id, application_id', 'id', interviews, ctx.userId);
      const applicationIds = rows.map((r) => r.application_id).filter((id): id is string => Boolean(id));
      const applications =
        applicationIds.length > 0
          ? await readIn<{ id: string; role_id: string | null }>(client, 'applications', 'id, role_id', 'id', applicationIds, ctx.userId)
          : [];
      const roles = new Map(applications.map((a) => [a.id, a.role_id]));
      for (const row of rows) {
        const roleId = row.application_id ? roles.get(row.application_id) : null;
        if (roleId) out.set(key('job_search.interviews', row.id), `/jobs/roles/${roleId}`);
      }
    });
  }

  const goalItems = refs('goals.items').filter(isUuid);
  if (goalItems.length > 0) {
    attempt('goals.items', async () => {
      const client = await ctx.db('goals');
      type ItemLink = { id: string; level: string; parent_id: string | null };
      const seen = new Map<string, ItemLink>();
      let wanted = goalItems;
      // A step sits under a goal, perhaps under another step first; climb to the goal.
      for (let depth = 0; depth < 6 && wanted.length > 0; depth += 1) {
        const rows = await readIn<ItemLink>(client, 'items', 'id, level, parent_id', 'id', wanted, ctx.userId);
        for (const row of rows) seen.set(row.id, row);
        wanted = rows
          .filter((row) => row.level !== 'goal' && row.parent_id && !seen.has(row.parent_id))
          .map((row) => row.parent_id as string);
      }
      for (const id of goalItems) {
        const item = seen.get(id);
        if (!item) continue;
        let goal: ItemLink | undefined = item;
        for (let depth = 0; goal && goal.level !== 'goal' && depth < 7; depth += 1) {
          goal = goal.parent_id ? seen.get(goal.parent_id) : undefined;
        }
        if (goal) out.set(key('goals.items', id), goal.id === id ? `/goals/${id}` : stepHref(goal.id, id));
      }
    });
  }

  const cardNotes = refs('learn.card_notes').filter(isUuid);
  const feedCards = refs('learn.feed_cards').filter(isUuid);
  if (cardNotes.length > 0 || feedCards.length > 0) {
    attempt('learn', async () => {
      const client = await ctx.db('learn');
      if (cardNotes.length > 0) {
        const notes = await readIn<{ id: string; concept_id: string | null }>(
          client, 'card_notes', 'id, concept_id', 'id', cardNotes, ctx.userId,
        );
        for (const note of notes) {
          if (note.concept_id) out.set(key('learn.card_notes', note.id), `/learn/c/${note.concept_id}`);
        }
      }
      if (feedCards.length > 0) {
        const cards = await readIn<{ id: string; concept_id: string | null; reading_id: string | null }>(
          client, 'feed_cards', 'id, concept_id, reading_id', 'id', feedCards, ctx.userId,
        );
        for (const card of cards) {
          const href = card.concept_id
            ? `/learn/c/${card.concept_id}`
            : card.reading_id
              ? `/learn/r/${card.reading_id}`
              : null;
          if (href) out.set(key('learn.feed_cards', card.id), href);
        }
      }
    });
  }

  const orderItems = refs('public.order_items').filter(isUuid);
  if (orderItems.length > 0) {
    attempt('public.order_items', async () => {
      const client = await ctx.db('public');
      // Tied to its owner through its order, so row level security does the filtering.
      const items = await readIn<{ id: string; order_id: string }>(
        client, 'order_items', 'id, order_id', 'id', orderItems, null,
      );
      for (const item of items) out.set(key('public.order_items', item.id), `/shopping/orders/${item.order_id}`);
    });
  }

  const dev = hits.filter((h) => DEV_MEMORY_SOURCES.includes(h.sourceTable));
  if (dev.length > 0) {
    attempt('dev', async () => {
      for (const [table, ref, href] of await devRecallHrefs(ctx, dev)) out.set(key(table, ref), href);
    });
  }

  await Promise.all(reads);
  return out;
}

const BY: Record<Author, string> = { me: 'the person', dash: 'Dash' };

export async function recallLookup(ctx: AskContext, input: Input): Promise<AskToolResult> {
  const question = optionalString(input, 'question');
  if (!question || question.length < 3) throw new AskInputError('question needs at least three characters.');
  if (input.only_mine !== undefined && typeof input.only_mine !== 'boolean') {
    throw new AskInputError('only_mine must be true or false.');
  }
  const onlyMine = input.only_mine === true;

  // Dev passages exist only under the owner's id, and are asked for only when
  // the asker is the owner with the workspace on (plan #1321).
  let sources = memorySourcesFor(ctx.enabledModules);
  if (sources.some((table) => DEV_MEMORY_SOURCES.includes(table)) && !(await devAccess(ctx)).ok) {
    sources = sources.filter((table) => !DEV_MEMORY_SOURCES.includes(table));
  }

  const core = await ctx.db('core');
  const searched = await searchMemory(core, {
    userId: ctx.userId,
    question,
    sources,
    authors: onlyMine ? ['me'] : undefined,
    embed: ctx.embedQuestion,
    onSpend: (report) => {
      void recordSpend(core as unknown as SpendClient, ctx.userId, {
        module: 'core',
        operation: RECALL_OPERATION,
        model: report.model,
        usage: report.usage,
      });
    },
  });
  if (!searched.ok) {
    if (searched.reason !== 'no-key') console.error('ask recall', searched.reason, searched.detail);
    return {
      ok: false,
      error:
        searched.reason === 'no-key'
          ? 'Searching by meaning is not set up on this deployment. Use vault_notes with a few words instead.'
          : 'The question could not be turned into a search. Try vault_notes with a few words instead.',
    };
  }

  const hits = groupByRow(searched.passages);
  // What the floor let through, for reading it again from real questions (RECALL_MIN_SIMILARITY).
  console.info(
    '[ask recall]',
    JSON.stringify({
      passages: searched.passages.length,
      rows: hits.length,
      top: hits.slice(0, 5).map((h) => Math.round(h.similarity * 1000) / 1000),
      last: searched.passages.length
        ? Math.round(searched.passages[searched.passages.length - 1].similarity * 1000) / 1000
        : null,
    }),
  );

  const listed = hits.slice(0, RECALL_ROWS);
  const hrefs = await recallHrefs(ctx, listed);

  const rows: AskRow[] = listed.map((hit) => {
    const shown = hit.passages.slice(0, RECALL_PASSAGES_PER_ROW).map((passage) => ({
      by: BY[passage.author],
      ...splitPassage(passage.body),
    }));
    const title =
      shown.find((p) => p.title)?.title ??
      (hit.sourceTable === 'obsidian.notes' ? hit.sourceRef.split('/').pop()?.replace(/\.md$/i, '') : null) ??
      RECALL_KINDS[hit.sourceTable] ??
      hit.sourceTable;
    const detail: Record<string, string | number | null> = {
      kind: RECALL_KINDS[hit.sourceTable] ?? hit.sourceTable,
      closeness: Math.round(hit.similarity * 100) / 100,
    };
    shown.forEach((passage, index) => {
      const suffix = index === 0 ? '' : `_${index + 1}`;
      detail[`passage${suffix}`] = clip(passage.text || passage.title, RECALL_PASSAGE_CHARS);
      detail[`passage${suffix}_by`] = passage.by;
    });
    return {
      table: hit.sourceTable,
      ref: hit.sourceRef,
      title: clip(title, 200) ?? hit.sourceTable,
      href: hrefs.get(key(hit.sourceTable, hit.sourceRef)) ?? '',
      detail,
    };
  });

  const byDash = searched.passages.some((passage) => passage.author === 'dash');
  return {
    ok: true,
    rows,
    totals: { passages: searched.passages.length, rows: hits.length },
    note:
      'Ranked by closeness of meaning to the question, not by shared words, so a passage can be near without answering it: use only the ones that do, and say so if none does. ' +
      "Each passage says who wrote it: 'the person' is their own writing, 'Dash' is text Dash wrote for them (drafts, files, results, Learn cards). When they ask what they said or wrote, answer from their own passages and name anything of Dash's as Dash's. " +
      (byDash && !onlyMine ? 'Pass only_mine to leave Dash’s writing out. ' : '') +
      `${matchedNote(hits.length, listed.length)}, closest first.`,
  };
}
