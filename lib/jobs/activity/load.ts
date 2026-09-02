import type { AppSupabaseClient } from '@/lib/jobs/db/schema-name';
import type { CoreSupabaseClient } from '@/lib/core/db/schema-name';

/**
 * What has changed lately, and what changed it.
 *
 * The pipeline says where things stand and the review queue says what needs a
 * decision; neither answers "what happened since I last looked". That question
 * has one honest answer in this app -- the rows the syncs wrote -- and until
 * now nothing showed them, so an overnight run that opened four roles and
 * closed six looked identical to one that did nothing.
 *
 * Ordered by created_at rather than occurred_at, deliberately. A rejection
 * sent three weeks ago and read this morning is news this morning; sorting by
 * when the email was written would file it under a day you already looked at.
 */

/**
 * Who did it.
 *
 * `auto` and `sweep` are both the app acting on its own and are worth telling
 * apart: `auto` is the ingestion filling in what a message implied -- the
 * "submitted" event a rejection proves must have happened -- and `sweep` is
 * the nightly clock closing something or raising a nudge. A row saying
 * "system" would collapse a thing that happened because mail arrived into a
 * thing that happened because time passed.
 */
export type ActivitySource = 'email' | 'auto' | 'sweep' | 'you';

export type ActivityEntry = {
  id: string;
  /** When the app learned it. */
  at: string;
  source: ActivitySource;
  headline: string;
  detail: string | null;
  roleId: string | null;
};

/** One inbox sync run, as the "what ran" line above the feed. */
export type ActivityRun = {
  id: string;
  type: string;
  status: string;
  messagesSeen: number;
  startedAt: string | null;
  finishedAt: string | null;
  error: string | null;
};

export type Activity = {
  runs: ActivityRun[];
  entries: ActivityEntry[];
  /** When the nightly sweep last actually changed something. */
  lastSweepAt: string | null;
};

/** How many entries are worth showing before this becomes a different screen. */
const ENTRY_LIMIT = 40;

type RoleJoin = { id: string; title: string; companies: { name: string } };

type NewRoleRow = {
  id: string;
  created_at: string;
  roles: RoleJoin;
};

type EventRow = {
  id: string;
  kind: string;
  source: string;
  summary: string | null;
  created_at: string;
  applications: { roles: RoleJoin };
};

type ReminderRow = {
  id: string;
  body: string;
  created_at: string;
  applications: { roles: RoleJoin } | null;
};

function nameOf(role: RoleJoin): string {
  return `${role.companies.name} · ${role.title}`;
}

/**
 * Which of the app's two automatic writers made this event.
 *
 * The database has one `system` source for both. A withdrawal is only ever
 * written by the nightly sweep closing a cold lead -- the ingestion has no
 * reason to withdraw anything -- so the kind separates them without needing a
 * migration to record something the writers already know.
 */
function sourceOfEvent(row: EventRow): ActivitySource {
  if (row.source === 'manual') return 'you';
  if (row.source !== 'system') return 'email';
  return row.kind === 'withdrawal' ? 'sweep' : 'auto';
}

/**
 * The two row shapes, merged into one feed.
 *
 * Pure so the merge order and the labels can be tested without a database --
 * this is the part that is easy to get subtly wrong and impossible to notice.
 */
export function activityEntries(input: {
  newRoles: readonly NewRoleRow[];
  events: readonly EventRow[];
  /** Rule-generated only: a to-do you typed yourself is not news. */
  reminders?: readonly ReminderRow[];
  limit?: number;
}): ActivityEntry[] {
  const fromRoles: ActivityEntry[] = input.newRoles.map((row) => ({
    id: `role-${row.id}`,
    at: row.created_at,
    source: 'email',
    headline: `New role — ${nameOf(row.roles)}`,
    detail: null,
    roleId: row.roles.id,
  }));

  const fromEvents: ActivityEntry[] = input.events.map((row) => ({
    id: `event-${row.id}`,
    at: row.created_at,
    source: sourceOfEvent(row),
    headline: `${row.kind.replace(/_/g, ' ')} — ${nameOf(row.applications.roles)}`,
    detail: row.summary,
    roleId: row.applications.roles.id,
  }));

  const fromReminders: ActivityEntry[] = (input.reminders ?? []).map((row) => ({
    id: `reminder-${row.id}`,
    at: row.created_at,
    source: 'sweep',
    headline: row.applications
      ? `Nudge — ${nameOf(row.applications.roles)}`
      : 'Nudge raised',
    detail: row.body,
    roleId: row.applications?.roles.id ?? null,
  }));

  return [...fromRoles, ...fromEvents, ...fromReminders]
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, input.limit ?? ENTRY_LIMIT);
}

/** Entries under the day they landed, newest day first, for a readable list. */
export function groupByDay(
  entries: readonly ActivityEntry[],
): Array<{ day: string; entries: ActivityEntry[] }> {
  const days: Array<{ day: string; entries: ActivityEntry[] }> = [];

  for (const entry of entries) {
    const day = entry.at.slice(0, 10);
    const last = days[days.length - 1];
    if (last && last.day === day) last.entries.push(entry);
    else days.push({ day, entries: [entry] });
  }

  return days;
}

export async function loadActivity(
  supabase: AppSupabaseClient,
  core: CoreSupabaseClient,
  userId: string,
): Promise<Activity> {
  const [roleRows, eventRows, reminderRows, runRows, lastWithdrawal] = await Promise.all([
    supabase
      .from('applications')
      .select('id, created_at, roles!inner ( id, title, companies!inner ( name ) )')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(ENTRY_LIMIT),

    supabase
      .from('application_events')
      .select(
        'id, kind, source, summary, created_at, applications!inner ( roles!inner ( id, title, companies!inner ( name ) ) )',
      )
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(ENTRY_LIMIT),

    // Rule-generated only. rule_key is set by the sweep and by nothing else,
    // so this is exactly the nudges it raised -- a to-do you typed on a role
    // yourself has no rule_key and is not news.
    supabase
      .from('reminders')
      .select(
        'id, body, created_at, applications ( roles!inner ( id, title, companies!inner ( name ) ) )',
      )
      .eq('user_id', userId)
      .not('rule_key', 'is', null)
      .order('created_at', { ascending: false })
      .limit(ENTRY_LIMIT),

    // No user filter: sync_jobs hangs off the mailbox, and its RLS policy
    // joins back to the account's owner. Filtering here would be duplicating
    // the policy, badly -- there is no user_id column to filter on.
    core
      .from('sync_jobs')
      .select('id, type, status, messages_seen, started_at, finished_at, error')
      .order('created_at', { ascending: false })
      .limit(5),

    // The sweep's other output. Asked for separately rather than read off the
    // feed: the sweep can be running perfectly and still be older than the
    // last forty changes.
    supabase
      .from('application_events')
      .select('created_at')
      .eq('user_id', userId)
      .eq('source', 'system')
      .eq('kind', 'withdrawal')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const reminders = (reminderRows.data ?? []) as unknown as ReminderRow[];

  const entries = activityEntries({
    newRoles: (roleRows.data ?? []) as unknown as NewRoleRow[],
    events: (eventRows.data ?? []) as unknown as EventRow[],
    reminders,
  });

  const runs: ActivityRun[] = (
    (runRows.data ?? []) as unknown as Array<{
      id: string;
      type: string;
      status: string;
      messages_seen: number;
      started_at: string | null;
      finished_at: string | null;
      error: string | null;
    }>
  ).map((row) => ({
    id: row.id,
    type: row.type,
    status: row.status,
    messagesSeen: row.messages_seen,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    error: row.error,
  }));

  // There is no run log for the sweep -- it writes rows and returns a count to
  // the cron's response, which nobody keeps. The newest of the two things it
  // writes is the honest answer to "when did it last do anything", and the
  // page says it that way rather than calling it a run time. A sweep that ran
  // and found nothing to do leaves no trace at all, which is correct: it
  // changed nothing.
  const lastWithdrawalAt = (lastWithdrawal.data as { created_at: string } | null)?.created_at;
  const lastReminderAt = reminders[0]?.created_at;
  const lastSweepAt =
    [lastWithdrawalAt, lastReminderAt].filter((at): at is string => Boolean(at)).sort().pop() ??
    null;

  return { runs, entries, lastSweepAt };
}
