import 'server-only';

import { createClient as createShoppingClient } from '@/lib/auth/server';
import { createClient as createJobsClient } from '@/lib/jobs/auth/server';
import { createNewsClient } from '@/lib/news/auth/server';
import { formatMoney } from '@/lib/money';
import type { ModuleId } from '@/lib/modules';
import {
  UPDATE_WINDOW_DAYS,
  jobEventLabel,
  mergeUpdates,
  type Update,
} from '@/lib/shell/home-model';

/**
 * What changed in the last few days, across the workspaces, for the home page.
 *
 * The briefs say what needs you. This says what happened: a recruiter wrote
 * back, an order came in, a newsletter arrived. Each line names the thing
 * itself, so the page can be read without opening a workspace to find out
 * what a count was counting.
 *
 * Each source fails on its own. A schema that is not exposed, or a query that
 * errors, costs the feed that source's lines and nothing else.
 */

const DAY_MS = 86_400_000;

async function safe<T>(work: PromiseLike<T>, fallback: T): Promise<T> {
  try {
    return await work;
  } catch {
    return fallback;
  }
}

type RoleJoin = { id: string; title: string; companies: { name: string } | null } | null;

type EventRow = {
  id: string;
  kind: string;
  summary: string | null;
  created_at: string;
  applications: { roles: RoleJoin } | null;
};

async function jobUpdates(userId: string, since: string): Promise<Update[]> {
  const supabase = await createJobsClient();
  const { data, error } = await supabase
    .from('application_events')
    .select(
      'id, kind, summary, created_at, applications!inner ( roles!inner ( id, title, companies!inner ( name ) ) )',
    )
    .eq('user_id', userId)
    // created_at, as the jobs brief reads it: when the app learned about it.
    .gte('created_at', since)
    // Notes and overrides are things you wrote yourself, not news.
    .not('kind', 'in', '(note,status_override)')
    .order('created_at', { ascending: false })
    .limit(8);
  if (error) throw new Error(error.message);

  return ((data ?? []) as unknown as EventRow[]).map((row) => {
    const role = row.applications?.roles ?? null;
    const company = role?.companies?.name ?? 'A company';
    const text = jobEventLabel(row.kind, company);
    return {
      key: `job-${row.id}`,
      module: 'jobs' as ModuleId,
      at: row.created_at,
      text,
      detail: row.summary?.trim() || role?.title || null,
      href: role ? `/jobs/roles/${role.id}` : '/jobs/activity',
    };
  });
}

type OrderRow = {
  id: string;
  created_at: string;
  total_cents: number;
  currency: string;
  merchants: { name: string } | null;
};

async function orderUpdates(userId: string, since: string): Promise<Update[]> {
  const supabase = await createShoppingClient();
  const { data, error } = await supabase
    .from('orders')
    .select('id, created_at, total_cents, currency, merchants ( name )')
    .eq('user_id', userId)
    .is('deleted_at', null)
    .is('cancelled_at', null)
    // Placed recently, not imported recently: a backfill of last year's mail
    // is not a new order.
    .gte('order_date', since.slice(0, 10))
    .order('created_at', { ascending: false })
    .limit(6);
  if (error) throw new Error(error.message);

  return ((data ?? []) as unknown as OrderRow[]).map((row) => ({
    key: `order-${row.id}`,
    module: 'shopping' as ModuleId,
    at: row.created_at,
    text: `New order from ${row.merchants?.name ?? 'a shop'}`,
    detail:
      row.total_cents > 0
        ? formatMoney(row.total_cents, row.currency || 'USD')
        : null,
    href: `/shopping/orders/${row.id}`,
  }));
}

type IssueRow = {
  id: string;
  subject: string | null;
  summary_line: string | null;
  received_at: string;
  senders: { name: string | null; email: string; muted: boolean } | null;
};

async function newsUpdates(since: string): Promise<Update[]> {
  const client = await createNewsClient();
  const { data, error } = await client
    .from('issues')
    .select('id, subject, summary_line, received_at, senders ( name, email, muted )')
    .is('read_at', null)
    .gte('received_at', since)
    .order('received_at', { ascending: false })
    .limit(10);
  if (error) throw new Error(error.message);

  return ((data ?? []) as unknown as IssueRow[])
    .filter((row) => !row.senders?.muted)
    .slice(0, 4)
    .map((row) => {
      const from = row.senders?.name ?? row.senders?.email ?? 'A newsletter';
      return {
        key: `issue-${row.id}`,
        module: 'news' as ModuleId,
        at: row.received_at,
        text: row.summary_line?.trim() || row.subject?.trim() || `New issue from ${from}`,
        detail: from,
        href: `/news/i/${row.id}`,
      };
    });
}

/**
 * The feed, newest first. `on` says which workspaces this account has
 * switched on; a switched-off workspace is never read.
 */
export async function loadUpdates(
  userId: string,
  on: (id: ModuleId) => boolean,
  now: Date = new Date(),
): Promise<Update[]> {
  const since = new Date(now.getTime() - UPDATE_WINDOW_DAYS * DAY_MS).toISOString();
  const groups = await Promise.all([
    on('jobs') ? safe(jobUpdates(userId, since), []) : [],
    on('shopping') ? safe(orderUpdates(userId, since), []) : [],
    on('news') ? safe(newsUpdates(since), []) : [],
  ]);
  return mergeUpdates(groups);
}
