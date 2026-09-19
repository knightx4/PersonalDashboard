import 'server-only';

import { createClient } from '@/lib/auth/server';
import { createCoreClient } from '@/lib/core/auth/server';
import { createVaultClient } from '@/lib/vault/auth/server';
import {
  OVERNIGHT_COLUMNS,
  dashActivityLine,
  overnightRunFromRow,
  type OvernightRun,
} from '@/lib/plan/overnight';
import type { RunJob } from '@/lib/plan/run-end';

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
  const [core, vault, app] = await Promise.all([
    createCoreClient(),
    createVaultClient(),
    createClient(),
  ]);

  const [syncs, mirror, night, session] = await Promise.all([
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
    /*
      What Dash is doing. Both reads are one row on the owner's own account --
      there is one overnight row per account and only the newest unfinished run
      is worth naming -- and RLS is what scopes them, the same as everything
      else on this line. Nobody but the owner has either row, so for everyone
      else these are two cheap empty reads and no line.
    */
    safe(
      app
        .from('plan_overnight_runs')
        .select(OVERNIGHT_COLUMNS)
        .limit(1)
        .maybeSingle()
        .then((result) =>
          result.data
            ? overnightRunFromRow(result.data as unknown as Record<string, unknown>)
            : null,
        ),
      null as OvernightRun | null,
    ),
    safe(
      app
        .from('plan_runs')
        .select('job, created_at')
        .eq('status', 'started')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
        .then((result) => {
          const row = result.data as unknown as { job: string; created_at: string } | null;
          return row ? { job: row.job as RunJob, startedAt: row.created_at } : null;
        }),
      null as { job: RunJob; startedAt: string } | null,
    ),
  ]);

  const lines: ActivityLine[] = [];

  // First, and undated, because it is the only line here about right now
  // rather than about something that already finished.
  const dash = dashActivityLine({ run: night, session }, Date.now());
  if (dash) lines.push({ text: dash, at: null });

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
  const ordered = lines.sort((a, b) => {
    if (a.at === b.at) return 0;
    if (a.at === null) return -1;
    if (b.at === null) return 1;
    return b.at.localeCompare(a.at);
  });

  /*
    One line per thing said, keeping the most recent.

    The last three sync jobs are read, and on a quiet mailbox all three finish
    with nothing parsed, so the bar read "gmail synced · 0 messages parsed"
    three times over -- three quarters of the line spent saying one fact, and
    the fact was that nothing had happened. Deduplicating on the text rather
    than on the sync is deliberate: it is the repetition that is useless to
    read, whatever produced it.
  */
  const said = new Set<string>();
  return ordered
    .filter((line) => {
      if (said.has(line.text)) return false;
      said.add(line.text);
      return true;
    })
    .slice(0, 4);
}
