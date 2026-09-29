import 'server-only';

import type { GoalsSupabaseClient } from '@/lib/goals/db/schema-name';
import { EVIDENCE_ITEM_LIMIT, EVIDENCE_WINDOW_DAYS, type EvidenceItem } from '@/lib/goals/evidence';

/**
 * What arrived since the last morning run, as items for Jev to read against
 * the person's steps (plan #1176; lib/goals/evidence.ts).
 *
 * Four kinds, the four places the goals skill closes a step from: an email
 * (core.ingested_messages, sender and subject only, since bodies are not
 * stored), a job event (job_search.application_events with its role and
 * company), a task ticked off in Todo, and an event on the person's own
 * calendar whose day has passed. Feed events are left out, as the skill
 * leaves them out: they say an event happened, not that the person went.
 *
 * Reads through the service client, so every query filters by user_id, and
 * an email by the person's own accounts.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

function clip(text: string | null | undefined, length = 300): string {
  const value = (text ?? '').replace(/\s+/g, ' ').trim();
  return value.length > length ? `${value.slice(0, length - 1)}…` : value;
}

function day(iso: string): string {
  return iso.slice(0, 10);
}

/** Where the window starts: the last run, but never more than a week back. */
export function evidenceSince(lastRunAt: string | null, now: number): string {
  const floor = now - EVIDENCE_WINDOW_DAYS * DAY_MS;
  const last = lastRunAt ? Date.parse(lastRunAt) : Number.NaN;
  return new Date(Number.isFinite(last) && last > floor ? last : floor).toISOString();
}

type Row = Record<string, unknown>;
const str = (value: unknown): string | null => (typeof value === 'string' && value.trim() ? value : null);

/**
 * Every item since `since`, newest first, at most EVIDENCE_ITEM_LIMIT. A read
 * that fails throws: a brief that says "nothing new bears on a step" when the
 * mail could not be read would be a lie, and the caller falls back to letting
 * the session search.
 */
export async function loadEvidenceItems(
  client: GoalsSupabaseClient,
  { userId, since, today }: { userId: string; since: string; today: string },
): Promise<EvidenceItem[]> {
  const core = client.schema('core');
  const jobs = client.schema('job_search');
  const todo = client.schema('todo');

  const accounts = await core.from('email_accounts').select('id').eq('user_id', userId);
  if (accounts.error) throw new Error(`Could not read email accounts: ${accounts.error.message}`);
  const accountIds = (accounts.data ?? []).map((row: Row) => row.id as string);

  const [mail, events, tasks, calendar] = await Promise.all([
    accountIds.length === 0
      ? Promise.resolve({ data: [] as Row[], error: null })
      : core
          .from('ingested_messages')
          .select('id, from_address, subject, received_at')
          .in('email_account_id', accountIds)
          .is('scrubbed_at', null)
          .gte('received_at', since)
          .order('received_at', { ascending: false })
          .limit(EVIDENCE_ITEM_LIMIT),
    jobs
      .from('application_events')
      .select('id, kind, summary, occurred_at, applications(roles(title, companies(name)))')
      .eq('user_id', userId)
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(EVIDENCE_ITEM_LIMIT),
    todo
      .from('tasks')
      .select('id, title, completed_at')
      .eq('user_id', userId)
      .eq('status', 'done')
      .gte('completed_at', since)
      .order('completed_at', { ascending: false })
      .limit(EVIDENCE_ITEM_LIMIT),
    // An event counts once its last day is behind today. Read by start day
    // from a day before the window, then filtered, so a two-day event that
    // ended yesterday is not missed.
    todo
      .from('events')
      .select('id, title, location, starts_on, ends_on')
      .eq('user_id', userId)
      .gte('starts_on', day(new Date(Date.parse(since) - DAY_MS).toISOString()))
      .lt('starts_on', today)
      .order('starts_on', { ascending: false })
      .limit(EVIDENCE_ITEM_LIMIT),
  ]);
  for (const [name, read] of [
    ['mail', mail],
    ['job events', events],
    ['tasks', tasks],
    ['calendar events', calendar],
  ] as const) {
    if (read.error) throw new Error(`Could not read ${name}: ${read.error.message}`);
  }

  const items: { at: string; item: EvidenceItem }[] = [];

  for (const row of (mail.data ?? []) as Row[]) {
    const from = clip(str(row.from_address) ?? 'unknown sender', 120);
    const subject = clip(str(row.subject) ?? '(no subject)');
    const at = str(row.received_at) ?? since;
    items.push({
      at,
      item: {
        source: 'gmail',
        id: row.id as string,
        state: { kind: 'email', from, subject, received: day(at) },
        line: `Email from ${from}, "${subject}", received ${day(at)}`,
      },
    });
  }

  for (const row of (events.data ?? []) as Row[]) {
    const application = row.applications as Row | null;
    const role = (application?.roles ?? null) as Row | null;
    const company = str((role?.companies as Row | null)?.name);
    const title = str(role?.title);
    const summary = clip(str(row.summary) ?? '');
    const kind = str(row.kind) ?? 'event';
    const at = str(row.occurred_at) ?? since;
    const state: Record<string, string> = { kind: 'job search event', event: kind.replace(/_/g, ' ') };
    if (summary) state.summary = summary;
    if (title) state.role = title;
    if (company) state.company = company;
    items.push({
      at,
      item: {
        source: 'jobs',
        id: row.id as string,
        state,
        line:
          `Job event (${state.event})` +
          (title || company ? ` on ${[title, company].filter(Boolean).join(' at ')}` : '') +
          (summary ? `: "${summary}"` : '') +
          `, ${day(at)} (job_search.application_events id ${row.id as string})`,
      },
    });
  }

  for (const row of (tasks.data ?? []) as Row[]) {
    const title = clip(str(row.title) ?? '');
    if (!title) continue;
    const at = str(row.completed_at) ?? since;
    items.push({
      at,
      item: {
        source: 'todo',
        id: row.id as string,
        state: { kind: 'task ticked off in their to-do list', title },
        line: `Task ticked off in Todo, "${title}", ${day(at)} (todo.tasks id ${row.id as string})`,
      },
    });
  }

  for (const row of (calendar.data ?? []) as Row[]) {
    const title = clip(str(row.title) ?? '');
    const lastDay = str(row.ends_on) ?? str(row.starts_on);
    if (!title || !lastDay || lastDay >= today || lastDay < day(since)) continue;
    const state: Record<string, string> = { kind: 'event on their own calendar, now past', title, day: lastDay };
    const location = clip(str(row.location) ?? '', 120);
    if (location) state.location = location;
    items.push({
      at: `${lastDay}T23:59:59Z`,
      item: {
        source: 'calendar',
        id: row.id as string,
        state,
        line: `Calendar event "${title}" on ${lastDay} (todo.events id ${row.id as string})`,
      },
    });
  }

  return items
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, EVIDENCE_ITEM_LIMIT)
    .map(({ item }) => item);
}
