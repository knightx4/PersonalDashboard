import 'server-only';

import { createCoreClient } from '@/lib/core/auth/server';
import { createGoalsClient } from '@/lib/goals/auth/server';
import { UPDATE_WINDOW_DAYS, type Update } from '@/lib/shell/home-model';
import { endedUpdate, type WatchingRow } from '@/lib/shell/watching-model';

/**
 * What Dash is watching, for the home page (plan #1295).
 *
 * `running` is every watch still running, soonest to end first, each with its
 * latest reading, the first value it read (for which way the price has gone),
 * the last report sent and the goal step it serves. `ended` is each watch that
 * stopped running within the Updates window, as a line for that feed: the
 * section only ever shows what is still going, and the outcome of one that
 * finished is news, said once.
 *
 * Reads go through the person's own session, so row level security decides
 * whose watches these are. The page wraps this in safe(); a watch whose
 * readings cannot be read still shows, without its numbers.
 */

const DAY_MS = 86_400_000;

type WatchDbRow = {
  id: string;
  title: string;
  url: string;
  condition: { below?: number | string; currency?: string } | null;
  report_times: string[] | null;
  ends_at: string;
  goal_item_id: string | null;
  status: 'running' | 'ended' | 'stopped';
  fired_value: number | string | null;
  fired_at: string | null;
  updated_at: string;
};

type ReadingDbRow = {
  taken_at: string;
  value: number | string | null;
  detail: Record<string, unknown> | null;
  error: string | null;
};

type CoreClient = Awaited<ReturnType<typeof createCoreClient>>;

function num(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

async function one(query: PromiseLike<{ data: unknown; error: { message: string } | null }>) {
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return ((data ?? []) as ReadingDbRow[])[0] ?? null;
}

/** The four readings a row needs: newest, newest with a value, first with a value, newest report. */
async function readingsFor(core: CoreClient, watchId: string) {
  const base = () =>
    core.from('watch_readings').select('taken_at, value, detail, error').eq('watch_id', watchId);
  const [newest, latest, first, report, count] = await Promise.all([
    one(base().order('taken_at', { ascending: false }).limit(1)),
    one(base().not('value', 'is', null).order('taken_at', { ascending: false }).limit(1)),
    one(base().not('value', 'is', null).order('taken_at', { ascending: true }).limit(1)),
    one(base().not('detail->report', 'is', null).order('taken_at', { ascending: false }).limit(1)),
    core
      .from('watch_readings')
      .select('id', { count: 'exact', head: true })
      .eq('watch_id', watchId)
      .not('value', 'is', null)
      .then(({ count: n }) => n ?? 0),
  ]);
  return { newest, latest, first, report, count };
}

/**
 * The goal a step belongs to, walking up to the item whose level is 'goal',
 * and where on the goal's page the step is. goal_item_id has no foreign key,
 * so an id that no longer resolves is simply no link.
 */
async function goalLink(itemId: string): Promise<{ title: string; href: string } | null> {
  const goals = await createGoalsClient();
  let id: string | null = itemId;
  for (let hops = 0; id && hops < 8; hops += 1) {
    const { data, error } = await goals
      .from('items')
      .select('id, parent_id, level, title')
      .eq('id', id)
      .maybeSingle();
    if (error || !data) return null;
    const row = data as { id: string; parent_id: string | null; level: string; title: string };
    if (row.level === 'goal') {
      return {
        title: row.title,
        href: row.id === itemId ? `/goals/${row.id}` : `/goals/${row.id}#step-${itemId}`,
      };
    }
    id = row.parent_id;
  }
  return null;
}

function currencyOf(watch: WatchDbRow, latest: ReadingDbRow | null): string {
  const read = latest?.detail?.currency;
  if (typeof read === 'string' && read) return read;
  return watch.condition?.currency || 'USD';
}

function reportOf(reading: ReadingDbRow | null): WatchingRow['report'] {
  const report = reading?.detail?.report as { title?: unknown; body?: unknown } | undefined;
  if (!reading || !report || typeof report.title !== 'string' || typeof report.body !== 'string') return null;
  return { title: report.title, body: report.body, at: reading.taken_at };
}

export async function loadWatching(
  now: Date = new Date(),
): Promise<{ running: WatchingRow[]; ended: Update[] }> {
  const core = await createCoreClient();
  const since = new Date(now.getTime() - UPDATE_WINDOW_DAYS * DAY_MS).toISOString();
  const { data, error } = await core
    .from('watches')
    .select('id, title, url, condition, report_times, ends_at, goal_item_id, status, fired_value, fired_at, updated_at')
    .or(`status.eq.running,updated_at.gte."${since}"`)
    .order('ends_at', { ascending: true })
    .limit(30);
  if (error) throw new Error(error.message);
  const watches = (data ?? []) as WatchDbRow[];

  const described = await Promise.all(
    watches.map(async (watch) => {
      const [readings, goal] = await Promise.all([
        readingsFor(core, watch.id).catch(() => null),
        watch.goal_item_id ? goalLink(watch.goal_item_id).catch(() => null) : null,
      ]);
      const firedValue = num(watch.fired_value);
      return {
        watch,
        readings,
        goal,
        below: num(watch.condition?.below),
        fired: firedValue !== null && watch.fired_at ? { value: firedValue, at: watch.fired_at } : null,
        currency: currencyOf(watch, readings?.latest ?? null),
      };
    }),
  );

  const running: WatchingRow[] = described
    .filter(({ watch }) => watch.status === 'running')
    .map(({ watch, readings, goal, below, fired, currency }) => ({
      id: watch.id,
      title: watch.title,
      url: watch.url,
      latest: num(readings?.latest?.value),
      first: num(readings?.first?.value),
      readings: readings?.count ?? 0,
      currency,
      checkedAt: readings?.newest?.taken_at ?? null,
      failing: readings?.newest?.error ?? null,
      below,
      fired,
      reportTimes: watch.report_times ?? [],
      endsAt: watch.ends_at,
      goal,
      report: reportOf(readings?.report ?? null),
    }));

  const ended = described
    .filter(({ watch }) => watch.status !== 'running' && watch.updated_at >= since)
    .map(({ watch, readings, goal, below, fired, currency }) =>
      endedUpdate({
        id: watch.id,
        title: watch.title,
        status: watch.status === 'stopped' ? 'stopped' : 'ended',
        at: watch.updated_at,
        below,
        fired,
        latest: num(readings?.latest?.value),
        first: num(readings?.first?.value),
        currency,
        goalHref: goal?.href ?? null,
      }),
    );

  return { running, ended };
}
