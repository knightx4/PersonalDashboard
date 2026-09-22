import 'server-only';

import { createClient as createShoppingClient } from '@/lib/auth/server';
import { createClient as createJobsClient } from '@/lib/jobs/auth/server';
import { createTodoClient } from '@/lib/todo/auth/server';
import { createVaultClient } from '@/lib/vault/auth/server';
import { createLearnClient } from '@/lib/learn/auth/server';
import { todayInTimezone } from '@/lib/money';
import type { ModuleId } from '@/lib/modules';

/**
 * The one thing this workspace would tell you if it could only say one thing.
 *
 * It lives in the middle of the top bar, which was empty, and it is read on
 * arrival rather than watched. That is what separates it from the status line
 * at the bottom: the status line says what the *system* just did, in machine
 * voice; this says what is true of *your* data right now, in a sentence.
 *
 * Strictly one line, and strictly the most important one -- these are ordered
 * by urgency and the first match wins. A brief that lists three things is a
 * dashboard, and there is already a dashboard.
 *
 * Silence is a valid answer, and the common one. A quiet workspace says
 * nothing rather than reaching for something to report, on exactly the rule
 * the rest of the app follows.
 */
export interface Brief {
  text: string;
  href?: string;
  /** caution earns a colour; everything else is said quietly. */
  tone?: 'caution';
}

async function safe<T>(work: PromiseLike<T>, fallback: T): Promise<T> {
  try {
    return await work;
  } catch {
    return fallback;
  }
}

const plural = (count: number, one: string, many = `${one}s`) =>
  `${count} ${count === 1 ? one : many}`;

function addDays(day: string, days: number): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export async function loadShoppingBrief(
  userId: string,
  timezone: string,
  reviewCount: number,
): Promise<Brief | null> {
  if (reviewCount > 0) {
    return {
      text: `${plural(reviewCount, 'thing')} to review`,
      href: '/shopping/review',
      tone: 'caution',
    };
  }

  const today = todayInTimezone(timezone);
  const supabase = await createShoppingClient();

  const closing = await safe(
    supabase
      .from('orders')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .is('deleted_at', null)
      .not('return_deadline', 'is', null)
      .gte('return_deadline', today)
      .lte('return_deadline', addDays(today, 7))
      .then((result) => result.count ?? 0),
    0,
  );

  if (closing > 0) {
    return {
      text: `${plural(closing, 'return window')} close${closing === 1 ? 's' : ''} this week`,
      href: '/shopping/returns',
      tone: 'caution',
    };
  }

  const arrived = await safe(
    supabase
      .from('orders')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .is('deleted_at', null)
      .gte('order_date', today)
      .then((result) => result.count ?? 0),
    0,
  );

  return arrived > 0 ? { text: `${plural(arrived, 'order')} arrived today` } : null;
}

export async function loadJobsBrief(
  userId: string,
  reviewCount: number,
): Promise<Brief | null> {
  if (reviewCount > 0) {
    return {
      text: `${plural(reviewCount, 'thing')} to review`,
      href: '/jobs/review',
      tone: 'caution',
    };
  }

  const supabase = await createJobsClient();
  const now = new Date();
  const soon = new Date(now.getTime() + 2 * 86_400_000);

  const interviews = await safe(
    supabase
      .from('interviews')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .gte('scheduled_at', now.toISOString())
      .lte('scheduled_at', soon.toISOString())
      .then((result) => result.count ?? 0),
    0,
  );

  if (interviews > 0) {
    return {
      text: `${plural(interviews, 'interview')} in the next two days`,
      href: '/jobs/today',
      tone: 'caution',
    };
  }

  const events = await safe(
    supabase
      .from('application_events')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      // created_at, not occurred_at: "in the last day" means the app learned
      // about it in the last day, which is the thing worth telling you. A
      // rejection dated three weeks ago that arrived this morning is news.
      .gte('created_at', new Date(now.getTime() - 86_400_000).toISOString())
      .then((result) => result.count ?? 0),
    0,
  );

  return events > 0 ? { text: `${plural(events, 'update')} in the last day` } : null;
}

export async function loadTodoBrief(
  userId: string,
  timezone: string,
): Promise<Brief | null> {
  const today = todayInTimezone(timezone);
  const supabase = await createTodoClient();

  const overdue = await safe(
    supabase
      .from('tasks')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('status', 'open')
      .not('due_on', 'is', null)
      .lt('due_on', today)
      .then((result) => result.count ?? 0),
    0,
  );

  if (overdue > 0) {
    return { text: `${plural(overdue, 'thing')} overdue`, href: '/todo', tone: 'caution' };
  }

  const due = await safe(
    supabase
      .from('tasks')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('status', 'open')
      .eq('due_on', today)
      .then((result) => result.count ?? 0),
    0,
  );

  return due > 0 ? { text: `${plural(due, 'thing')} due today`, href: '/todo' } : null;
}

export async function loadVaultBrief(): Promise<Brief | null> {
  const supabase = await createVaultClient();

  const connection = await safe(
    supabase
      .from('vault_connections')
      .select('status, last_synced_at')
      .limit(1)
      .maybeSingle()
      .then((result) => result.data as { status?: string; last_synced_at?: string } | null),
    null,
  );

  if (!connection) return null;
  if (connection.status === 'needs_reauth') {
    return {
      text: 'The vault token expired — nothing is mirroring',
      href: '/vault/settings',
      tone: 'caution',
    };
  }
  return null;
}

/**
 * The learn brief: what is in front of you, not what you have done.
 *
 * Quiet by construction. There is no failure state to warn about here -- no
 * token to expire, no sync to go stale -- so this either says how much is left
 * or says nothing, and an empty queue says nothing rather than congratulating
 * anybody.
 */
export async function loadLearnBrief(): Promise<Brief | null> {
  const supabase = await createLearnClient();

  const count = await safe(
    supabase
      .from('readings')
      .select('id', { count: 'exact', head: true })
      .in('status', ['queued', 'reading'])
      .then((result) => result.count),
    null,
  );

  if (!count) return null;
  return { text: `${plural(count, 'thing')} to read`, href: '/learn/lists' };
}

export type BriefFor = ModuleId | null;
