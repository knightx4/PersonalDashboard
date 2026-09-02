import { createServiceSupabase } from '@/inngest/jobs/supabase-admin';
import { DEBRIEF_NUDGE_WINDOW_DAYS } from '@/lib/jobs/pipeline';

/**
 * The nightly sweep: ghosting and rule-generated reminders.
 *
 * Three rules, all of them things a clock can see and a person cannot: an
 * application that has gone unanswered, an interview that has happened and not
 * been written up, and one about to happen with no preparation. They surface
 * on /jobs/today.
 *
 * Ghosting is a view over silence, so it has to be re-derived on a clock
 * rather than only when something happens -- an application goes quiet
 * precisely by nothing happening. job_search.sweep_ghosted_applications()
 * re-runs the same derivation the event triggers use, so there is still
 * exactly one definition of the rule.
 *
 * It runs after the inbox sync, deliberately: a message that arrived this
 * morning should count as activity before anything is judged quiet.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

export type SweepSummary = {
  ghosted: number;
  closedLeads: number;
  reminders: number;
  /**
   * Queries that failed. Empty on a healthy run, and the thing to read first
   * when a rule stops producing anything -- see readRows below for why.
   */
  problems: string[];
};

export async function runJobSweep(): Promise<SweepSummary> {
  const supabase = createServiceSupabase();
  return sweepWith(supabase);
}

/**
 * The sweep against a given client, so a test can drive it without a project.
 */
export async function sweepWith(
  supabase: ReturnType<typeof createServiceSupabase>,
): Promise<SweepSummary> {
  const problems: string[] = [];

  const { data: ghosted, error } = await supabase.rpc('sweep_ghosted_applications', {
    p_user_id: null,
  });
  if (error) throw new Error(error.message);

  const closedLeads = await closeColdLeads(supabase, problems);
  const reminders = await generateReminders(supabase, problems);
  return { ghosted: ghosted ?? 0, closedLeads, reminders, problems };
}

/**
 * A read whose error is not thrown away.
 *
 * `const { data } = await supabase...` reads as though a failed query simply
 * returns nothing, and in effect it does: `data` is null, `data ?? []` is
 * empty, and the loop below it runs zero times -- indistinguishable from "there
 * was nothing to do". That is how the debrief rule came to stop firing
 * altogether. It filtered on `interviews.debrief` and `interviews.went_well`
 * for months after 0011_merge_interview_debrief replaced both with `notes`;
 * PostgREST rejected every call for naming columns that no longer existed, and
 * the sweep went on reporting a cheerful zero.
 *
 * So every read goes through here. A broken rule still does not take the other
 * rules down with it -- one bad filter should not cost the whole sweep, the
 * same reason the cron route isolates its stages -- but it is logged and
 * carried out in the summary that route already returns, so the next failure of
 * this kind is visible on the first run rather than on the day someone
 * wonders why they have stopped being nagged.
 */
async function readRows<T>(
  what: string,
  problems: string[],
  query: PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const { data, error } = await query;
  if (error) {
    problems.push(`${what}: ${error.message}`);
    console.error(`[job sweep] ${what} failed: ${error.message}`);
    return [];
  }
  return data ?? [];
}

/** Postgres' unique violation, which reaches here as "that row already exists". */
const UNIQUE_VIOLATION = '23505';

/**
 * A write whose error is not thrown away either -- except the one error that
 * means the rule is working.
 *
 * Reminder idempotency is a unique index on (user_id, rule_key), so the second
 * sweep of the day gets a 23505 for every reminder the first one wrote. That is
 * the expected outcome, not a problem to report. Anything else is.
 *
 * Returns whether a row was actually written, which is what the counts mean.
 */
async function writeRow(
  what: string,
  problems: string[],
  query: PromiseLike<{ error: { message: string; code?: string } | null }>,
): Promise<boolean> {
  const { error } = await query;
  if (!error) return true;
  if (error.code === UNIQUE_VIOLATION) return false;
  problems.push(`${what}: ${error.message}`);
  console.error(`[job sweep] ${what} failed: ${error.message}`);
  return false;
}

/**
 * How long an untouched lead sits on the board before it is let go.
 *
 * Twice the ghost threshold, because a lead is a weaker thing than an
 * application: nothing was sent, so there is nothing to be waiting on, and a
 * recruiter who resurfaces after six weeks is not unusual. At the default that
 * is sixty days.
 */
export function coldLeadCutoffDays(ghostThresholdDays: number): number {
  return ghostThresholdDays * 2;
}

/**
 * Leads nobody ever took up.
 *
 * Ghosting deliberately skips `lead` and `drafting` -- those describe your own
 * inaction rather than theirs, and the derivation has a test saying so. But
 * left alone they never close either, so inbound outreach from four months ago
 * sat in the first column of the board forever.
 *
 * Closed by writing the `withdrawal` event a person would write, rather than
 * by teaching the derivation a new rule. The status then follows from the
 * event log exactly as it does for a withdrawal you made yourself -- there is
 * still one definition of what `withdrawn` means, and the timeline says who
 * closed it and why.
 */
async function closeColdLeads(
  supabase: ReturnType<typeof createServiceSupabase>,
  problems: string[],
): Promise<number> {
  type Row = {
    id: string;
    user_id: string;
    created_at: string;
    profiles: { ghost_threshold_days: number | null };
  };

  const rows = (await readRows(
    'cold leads: candidates',
    problems,
    supabase
      .from('applications')
      .select('id, user_id, created_at, profiles!inner ( ghost_threshold_days )')
      .in('status', ['lead', 'drafting'])
      .limit(500),
  )) as unknown as Row[];

  if (rows.length === 0) return 0;

  const activity = await readRows(
    'cold leads: activity',
    problems,
    supabase
      .from('application_events')
      .select('application_id, kind, occurred_at')
      .in(
        'application_id',
        rows.map((row) => row.id),
      )
      .order('occurred_at', { ascending: false }),
  );

  const lastAt = new Map<string, string>();
  const alreadyClosed = new Set<string>();
  for (const event of activity) {
    const id = event.application_id as string;
    if (!lastAt.has(id)) lastAt.set(id, event.occurred_at as string);
    // Idempotent: a second withdrawal on the same row would be noise in the
    // timeline and would not change the status it already produced.
    if (event.kind === 'withdrawal') alreadyClosed.add(id);
  }

  let closed = 0;
  const now = Date.now();

  for (const row of rows) {
    if (alreadyClosed.has(row.id)) continue;
    const cutoff = coldLeadCutoffDays(row.profiles.ghost_threshold_days ?? 30);
    const last = new Date(lastAt.get(row.id) ?? row.created_at).getTime();
    if (now - last <= cutoff * DAY_MS) continue;

    const written = await writeRow(
      `cold leads: closing ${row.id}`,
      problems,
      supabase.from('application_events').insert({
        user_id: row.user_id,
        application_id: row.id,
        kind: 'withdrawal',
        occurred_at: new Date().toISOString(),
        source: 'system',
        summary: `Closed after ${cutoff} days with nothing sent and no further contact. Move it back if it is still live.`,
      }),
    );
    if (written) closed += 1;
  }

  return closed;
}

/**
 * Rule-generated reminders. Idempotent on rule_key, so running the sweep twice
 * in a day does not produce two of anything.
 */
async function generateReminders(
  supabase: ReturnType<typeof createServiceSupabase>,
  problems: string[],
): Promise<number> {
  let created = 0;
  const now = Date.now();

  // 1. A submitted application with no response after ten days is worth a nudge.
  type Row = {
    id: string;
    user_id: string;
    submitted_at: string;
    roles: { title: string; companies: { name: string } };
  };

  const silent = (await readRows(
    'reminders: silent applications',
    problems,
    supabase
      .from('applications')
      .select('id, user_id, submitted_at, roles!inner ( title, companies!inner ( name ) )')
      .in('status', ['submitted', 'acknowledged'])
      .is('first_human_response_at', null)
      .not('submitted_at', 'is', null)
      .lt('submitted_at', new Date(now - 10 * DAY_MS).toISOString())
      .limit(500),
  )) as unknown as Row[];

  for (const application of silent) {
    const written = await writeRow(
      `reminders: follow_up:${application.id}`,
      problems,
      supabase.from('reminders').insert({
        user_id: application.user_id,
        application_id: application.id,
        kind: 'follow_up',
        due_at: new Date().toISOString(),
        body: `No reply from ${application.roles.companies.name} on ${application.roles.title} after ten days. Follow up or let it go.`,
        rule_key: `follow_up:${application.id}`,
      }),
    );
    if (written) created += 1;
  }

  // 2. A completed interview with no debrief. Asked for the same evening,
  //    because a debrief written three days later is worth very little.
  //
  //    The debrief is `interviews.notes`: 0011_merge_interview_debrief replaced
  //    `debrief`, `went_well` and `went_poorly` with that one column, and the
  //    interviews page decides "still needs writing up" the same way.
  const interviews = await readRows(
    'reminders: interviews awaiting a debrief',
    problems,
    supabase
      .from('interviews')
      .select('id, user_id, application_id, scheduled_at')
      .lt('scheduled_at', new Date(now).toISOString())
      .gt('scheduled_at', new Date(now - DEBRIEF_NUDGE_WINDOW_DAYS * DAY_MS).toISOString())
      .is('notes', null)
      .limit(500),
  );

  for (const interview of interviews) {
    const written = await writeRow(
      `reminders: debrief:${interview.id}`,
      problems,
      supabase.from('reminders').insert({
        user_id: interview.user_id as string,
        application_id: interview.application_id as string,
        kind: 'thank_you',
        due_at: new Date().toISOString(),
        body: 'Write the debrief while it is fresh, and send the thank-you note.',
        rule_key: `debrief:${interview.id}`,
      }),
    );
    if (written) created += 1;
  }

  // 3. An interview tomorrow, with nothing written down for it.
  //
  //    Asked the day before rather than the morning of: prep you think of an
  //    hour beforehand is not prep. Only interviews with no prep notes are
  //    raised, so someone who has already done the work is not nagged about it.
  type Upcoming = {
    id: string;
    user_id: string;
    application_id: string;
    applications: { roles: { title: string; companies: { name: string } } };
  };

  const soon = (await readRows(
    'reminders: interviews needing prep',
    problems,
    supabase
      .from('interviews')
      .select(
        'id, user_id, application_id, scheduled_at, kind, applications!inner ( roles!inner ( title, companies!inner ( name ) ) )',
      )
      .gt('scheduled_at', new Date(now).toISOString())
      .lt('scheduled_at', new Date(now + 2 * DAY_MS).toISOString())
      .is('prep_notes', null)
      .limit(500),
  )) as unknown as Upcoming[];

  for (const interview of soon) {
    const written = await writeRow(
      `reminders: prep:${interview.id}`,
      problems,
      supabase.from('reminders').insert({
        user_id: interview.user_id,
        application_id: interview.application_id,
        kind: 'prep',
        due_at: new Date().toISOString(),
        body: `Interview at ${interview.applications.roles.companies.name} for ${interview.applications.roles.title} within two days, and nothing written down for it.`,
        rule_key: `prep:${interview.id}`,
      }),
    );
    if (written) created += 1;
  }

  return created;
}
