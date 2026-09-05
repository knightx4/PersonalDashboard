import type { AppSupabaseClient } from '@/lib/jobs/db/schema-name';
import type { CoreSupabaseClient } from '@/lib/core/db/schema-name';
import { APPLICATION_EVENT_KINDS, type ApplicationEventKind } from '@/lib/jobs/pipeline';

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

/**
 * How an entry reads at a glance, before you read it.
 *
 * A feed of forty identically grey lines makes the one line that matters --
 * a rejection, an interview booked -- cost as much to find as the thirty-nine
 * that do not. Four tones is the whole vocabulary: `bad` is a closed door,
 * `good` is a step forward, `info` is the machinery working, and `muted` is a
 * thing that merely happened.
 */
export type ActivityTone = 'good' | 'bad' | 'info' | 'muted';

/**
 * Which tone each kind of event earns.
 *
 * Exhaustive over APPLICATION_EVENT_KINDS on purpose: adding a kind should
 * fail the typecheck here rather than quietly show up grey.
 */
const EVENT_TONE: Record<ApplicationEventKind, ActivityTone> = {
  submitted: 'info',
  confirmation: 'info',
  recruiter_reply: 'good',
  screen_scheduled: 'good',
  assessment_sent: 'info',
  assessment_submitted: 'info',
  interview_scheduled: 'good',
  interview_completed: 'good',
  offer: 'good',
  rejection: 'bad',
  // Not red: withdrawing is a decision, usually the sweep closing something
  // that went quiet, and colouring it like a rejection would double-count the
  // bad news in a week where both happened.
  withdrawal: 'muted',
  follow_up_sent: 'info',
  status_override: 'muted',
  note: 'muted',
};

/** `kind` arrives as a plain string from the database. */
function toneOfKind(kind: string): ActivityTone {
  return EVENT_TONE[kind as ApplicationEventKind] ?? 'muted';
}

/**
 * What "moved forward" counts.
 *
 * Read off the tone table rather than listed again: the feed already decides
 * which kinds are a step forward, and a headline number that disagreed with
 * the green chips underneath it would be worse than no number at all.
 */
export const FORWARD_KINDS: ApplicationEventKind[] = APPLICATION_EVENT_KINDS.filter(
  (kind) => EVENT_TONE[kind] === 'good',
);

/** The window the headline numbers cover. */
export const HIGHLIGHT_DAYS = 7;

/**
 * The four numbers above the feed.
 *
 * Counted in the database over the window rather than tallied from `entries`.
 * The feed is capped at forty rows, so a busy week would have quietly counted
 * only part of itself -- a headline that is wrong exactly when it matters.
 */
export type ActivityHighlights = {
  days: number;
  newRoles: number;
  movedForward: number;
  rejections: number;
  closedOut: number;
};

export type ActivityEntry = {
  id: string;
  /** When the app learned it. */
  at: string;
  source: ActivitySource;
  /** What happened, in the fewest words that still say it. Carries the tone. */
  label: string;
  /** Who it happened to: "Canonical · Engineering Manager". */
  subject: string | null;
  tone: ActivityTone;
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
  highlights: ActivityHighlights;
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
    label: 'New role',
    subject: nameOf(row.roles),
    tone: 'info',
    detail: null,
    roleId: row.roles.id,
  }));

  const fromEvents: ActivityEntry[] = input.events.map((row) => ({
    id: `event-${row.id}`,
    at: row.created_at,
    source: sourceOfEvent(row),
    label: row.kind.replace(/_/g, ' '),
    subject: nameOf(row.applications.roles),
    tone: toneOfKind(row.kind),
    detail: row.summary,
    roleId: row.applications.roles.id,
  }));

  const fromReminders: ActivityEntry[] = (input.reminders ?? []).map((row) => ({
    id: `reminder-${row.id}`,
    at: row.created_at,
    source: 'sweep',
    label: 'Nudge',
    subject: row.applications ? nameOf(row.applications.roles) : null,
    tone: 'muted',
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
  // Head requests: four counts, no rows returned.
  const since = new Date(Date.now() - HIGHLIGHT_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const countEvents = (kinds: readonly ApplicationEventKind[]) =>
    supabase
      .from('application_events')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .gte('created_at', since)
      .in('kind', kinds as string[]);

  const [
    roleRows,
    eventRows,
    reminderRows,
    runRows,
    lastWithdrawal,
    newRoleCount,
    forwardCount,
    rejectionCount,
    closedCount,
  ] = await Promise.all([
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

    supabase
      .from('applications')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .gte('created_at', since),

    countEvents(FORWARD_KINDS),
    countEvents(['rejection']),
    // Withdrawal covers both: the sweep closing a cold lead and you turning
    // something down. Either way the door is shut, which is what the tile says.
    countEvents(['withdrawal']),
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

  const highlights: ActivityHighlights = {
    days: HIGHLIGHT_DAYS,
    newRoles: newRoleCount.count ?? 0,
    movedForward: forwardCount.count ?? 0,
    rejections: rejectionCount.count ?? 0,
    closedOut: closedCount.count ?? 0,
  };

  return { runs, entries, highlights, lastSweepAt };
}
