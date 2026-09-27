import 'server-only';

import { createClient } from '@/lib/auth/server';
import { createClient as createJobsClient } from '@/lib/jobs/auth/server';
import { createVaultClient } from '@/lib/vault/auth/server';
import { createLearnClient } from '@/lib/learn/auth/server';
import { createNewsClient } from '@/lib/news/auth/server';
import { createGoalsClient } from '@/lib/goals/auth/server';
import { TERMINAL_STATUSES } from '@/lib/jobs/pipeline';
import { countOpenTasks } from '@/lib/todo/tasks/load';
import { NOTES_WORK_KINDS, OUTSTANDING_STATUSES } from '@/lib/feedback/load';
import type { ModuleId } from '@/lib/modules';

/**
 * One number per module, for the places that ask "is anything happening in the
 * workspaces I am not looking at".
 *
 * There were two of these queries -- the home page's tiles had them and the
 * switcher had nothing -- which meant the switcher was a way to move between
 * workspaces and not a reason to. Both now read this.
 *
 * A module whose query fails contributes null rather than nothing, so the
 * caller can say "—" instead of silently claiming zero. Claiming zero when the
 * read failed is the exact failure the app spends most of its effort avoiding.
 */
export type ModuleCounts = Partial<
  Record<ModuleId, { value: number | null; noun: string; plural?: string }>
>;

async function safe<T>(query: PromiseLike<T>, fallback: T): Promise<T> {
  try {
    return await query;
  } catch {
    return fallback;
  }
}

export async function loadModuleCounts(userId: string): Promise<ModuleCounts> {
  const [supabase, jobs, vault, learn, news, goals] = await Promise.all([
    createClient(),
    createJobsClient(),
    createVaultClient(),
    createLearnClient(),
    createNewsClient(),
    createGoalsClient(),
  ]);

  const [items, pursuits, notes, tasks, toRead, unread, openNotes, openGoals] = await Promise.all([
    safe(
      supabase
        .from('inventory_items')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId)
        .eq('status', 'owned')
        .then((r) => r.count),
      null,
    ),
    safe(
      jobs
        .from('applications')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId)
        .not('status', 'in', `(${TERMINAL_STATUSES.join(',')})`)
        .then((r) => r.count),
      null,
    ),
    // RLS scopes this to the signed-in user, and an unconnected vault is
    // simply zero rather than an error.
    safe(
      vault
        .from('notes')
        .select('id', { count: 'exact', head: true })
        .then((r) => r.count),
      null,
    ),
    safe(countOpenTasks(userId), null),
    // What is still ahead of you, which is the only number here worth
    // glancing at. Finished and abandoned readings are both done with.
    safe(
      learn
        .from('readings')
        .select('id', { count: 'exact', head: true })
        .in('status', ['queued', 'reading'])
        .then((r) => r.count),
      null,
    ),
    // What has come in and not been opened. Read is a timestamp rather than a
    // flag, so "not read" is the column being null.
    safe(
      news
        .from('issues')
        .select('id', { count: 'exact', head: true })
        .is('read_at', null)
        .then((r) => r.count),
      null,
    ),
    // The dev workspace's own number: what is still waiting to be worked in
    // the notes queue, which is the only thing there anyone is behind on.
    // Likes are not waiting to be worked, so they are not counted.
    safe(
      supabase
        .from('feedback_items')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId)
        .in('status', [...OUTSTANDING_STATUSES])
        .in('kind', [...NOTES_WORK_KINDS])
        .then((r) => r.count),
      null,
    ),
    // Goals still being worked: not proposed, parked, done or dropped.
    safe(
      goals
        .from('items')
        .select('id', { count: 'exact', head: true })
        .eq('level', 'goal')
        .eq('status', 'open')
        .is('archived_at', null)
        .then((r) => r.count),
      null,
    ),
  ]);

  return {
    shopping: { value: items, noun: 'item' },
    jobs: { value: pursuits, noun: 'open pursuit' },
    todo: { value: tasks, noun: 'thing to do', plural: 'things to do' },
    vault: { value: notes, noun: 'note' },
    learn: { value: toRead, noun: 'thing to read', plural: 'things to read' },
    news: { value: unread, noun: 'unread newsletter' },
    goals: { value: openGoals, noun: 'open goal' },
    dev: { value: openNotes, noun: 'open note' },
  };
}

/** "6 open pursuits", "1 note", or "—" when the read failed. */
export function describeCount(entry: ModuleCounts[ModuleId]): string {
  if (!entry || entry.value === null) return '—';
  const plural = entry.value === 1 ? entry.noun : (entry.plural ?? `${entry.noun}s`);
  return `${entry.value} ${plural}`;
}
