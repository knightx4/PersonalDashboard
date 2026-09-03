import 'server-only';

import { createClient } from '@/lib/auth/server';
import { createClient as createJobsClient } from '@/lib/jobs/auth/server';
import { createVaultClient } from '@/lib/vault/auth/server';
import { TERMINAL_STATUSES } from '@/lib/jobs/pipeline';
import { countOpenTasks } from '@/lib/todo/tasks/load';
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
export type ModuleCounts = Partial<Record<ModuleId, { value: number | null; noun: string }>>;

async function safe<T>(query: PromiseLike<T>, fallback: T): Promise<T> {
  try {
    return await query;
  } catch {
    return fallback;
  }
}

export async function loadModuleCounts(userId: string): Promise<ModuleCounts> {
  const [supabase, jobs, vault] = await Promise.all([
    createClient(),
    createJobsClient(),
    createVaultClient(),
  ]);

  const [items, pursuits, notes, tasks] = await Promise.all([
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
  ]);

  return {
    shopping: { value: items, noun: 'item' },
    jobs: { value: pursuits, noun: 'open pursuit' },
    todo: { value: tasks, noun: 'thing to do' },
    vault: { value: notes, noun: 'note' },
  };
}

/** "6 open pursuits", "1 note", or "—" when the read failed. */
export function describeCount(entry: ModuleCounts[ModuleId]): string {
  if (!entry || entry.value === null) return '—';
  const plural = entry.value === 1 ? entry.noun : `${entry.noun}s`;
  return `${entry.value} ${plural}`;
}
