import 'server-only';

import { createCoreClient } from '@/lib/core/auth/server';
import { createVaultClient } from '@/lib/vault/auth/server';

/**
 * What the system did, without being asked.
 *
 * This app's whole job is ingesting things in the background, which means most
 * of what happens, happens while nobody is looking. Until now that was either
 * invisible or shouted as a full-width banner. This is the cheapest rung of
 * the attention ladder: a line that says what happened and moves nothing.
 *
 * Everything here is best-effort. A status line that can take a page down is a
 * status line that should not exist.
 */

export interface ActivityLine {
  /** Machine voice: lower case, no full stop. */
  text: string;
  /** When it happened, ISO. Null when it is still happening. */
  at: string | null;
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

export async function loadActivity(): Promise<ActivityLine[]> {
  const [core, vault] = await Promise.all([createCoreClient(), createVaultClient()]);

  const [syncs, mirror] = await Promise.all([
    safe(
      core
        .from('sync_jobs')
        .select('type, status, messages_seen, messages_parsed, finished_at')
        .order('created_at', { ascending: false })
        .limit(3)
        .then((result) => (result.data ?? []) as Array<Record<string, unknown>>),
      [] as Array<Record<string, unknown>>,
    ),
    safe(
      vault
        .from('vault_connections')
        .select('last_synced_at, status')
        .limit(1)
        .maybeSingle()
        .then((result) => result.data as Record<string, unknown> | null),
      null,
    ),
  ]);

  const lines: ActivityLine[] = [];

  for (const job of syncs) {
    const status = job.status as string;
    const finished = (job.finished_at as string | null) ?? null;

    if (status === 'running' || status === 'queued') {
      lines.push({
        text: `reading gmail · seen ${job.messages_seen ?? 0}, parsed ${job.messages_parsed ?? 0}`,
        at: null,
      });
      continue;
    }
    if (status === 'failed') {
      // Said plainly rather than swallowed: a sync that stopped is the thing
      // most likely to make the rest of the app quietly wrong.
      lines.push({ text: 'gmail sync failed · see shopping settings', at: finished });
      continue;
    }
    if (status === 'completed' && finished) {
      lines.push({
        text: `gmail synced · ${plural(Number(job.messages_parsed ?? 0), 'message')} parsed`,
        at: finished,
      });
    }
  }

  if (mirror) {
    if (mirror.status === 'needs_reauth') {
      lines.push({ text: 'vault token expired · reconnect in vault settings', at: null });
    } else if (mirror.last_synced_at) {
      lines.push({ text: 'vault mirrored', at: mirror.last_synced_at as string });
    }
  }

  // Undated first: an undated line is something still in flight, and that is
  // the most current thing there is.
  return lines
    .sort((a, b) => {
      if (a.at === b.at) return 0;
      if (a.at === null) return -1;
      if (b.at === null) return 1;
      return b.at.localeCompare(a.at);
    })
    .slice(0, 4);
}
