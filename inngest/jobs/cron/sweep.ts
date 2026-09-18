import { createServiceSupabase } from '@/inngest/jobs/supabase-admin';
import { DEBRIEF_NUDGE_WINDOW_DAYS } from '@/lib/jobs/pipeline';

/**
 * The nightly sweep: ghosting and rule-generated reminders.
 *
 * Two rules, both of them things a clock can see and a person cannot: an
 * interview that has happened and not been written up, and one about to happen
 * with no preparation. They surface on /jobs/today and on /todo.
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

export type SweepSummary = { ghosted: number; closedLeads: number; reminders: number };

export async function runJobSweep(): Promise<SweepSummary> {
  const supabase = createServiceSupabase();

  const { data: ghosted, error } = await supabase.rpc('sweep_ghosted_applications', {
    p_user_id: null,
  });
  if (error) throw new Error(error.message);

  const closedLeads = await closeColdLeads(supabase);
  const reminders = await generateReminders(supabase);
  return { ghosted: ghosted ?? 0, closedLeads, reminders };
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
): Promise<number> {
  const { data: candidates } = await supabase
    .from('applications')
    .select('id, user_id, created_at, profiles!inner ( ghost_threshold_days )')
    .in('status', ['lead', 'drafting'])
    .limit(500);

  type Row = {
    id: string;
    user_id: string;
    created_at: string;
    profiles: { ghost_threshold_days: number | null };
  };

  const rows = (candidates ?? []) as unknown as Row[];
  if (rows.length === 0) return 0;

  const { data: activity } = await supabase
    .from('application_events')
    .select('application_id, kind, occurred_at')
    .in(
      'application_id',
      rows.map((row) => row.id),
    )
    .order('occurred_at', { ascending: false });

  const lastAt = new Map<string, string>();
  const alreadyClosed = new Set<string>();
  for (const event of activity ?? []) {
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

    const { error } = await supabase.from('application_events').insert({
      user_id: row.user_id,
      application_id: row.id,
      kind: 'withdrawal',
      occurred_at: new Date().toISOString(),
      source: 'system',
      summary: `Closed after ${cutoff} days with nothing sent and no further contact. Move it back if it is still live.`,
    });
    if (!error) closed += 1;
  }

  return closed;
}

/**
 * Rule-generated reminders. Idempotent on rule_key, so running the sweep twice
 * in a day does not produce two of anything.
 *
 * There used to be a third, first in the list: a submitted application with no
 * reply after ten days raised a "follow up or let it go" nudge. It is gone.
 * It fired on every quiet application and nothing ever made it stop, so it
 * became the whole of the to-do list -- 27 of them at once, all saying the
 * same thing about companies that were simply not going to write back. Being
 * told that repeatedly is not information, and the pipeline already shows
 * which applications have gone quiet without asking anything of you.
 *
 * The two left are both about an interview, which is a thing with a date and
 * a piece of work attached: they can be finished, and they stop.
 *
 * `follow_up` stays a reminder kind. The rows this rule wrote still exist and
 * are still read, and the follow-up composer on /todo and This week is what
 * makes one actionable.
 */
async function generateReminders(
  supabase: ReturnType<typeof createServiceSupabase>,
): Promise<number> {
  let created = 0;
  const now = Date.now();

  // 1. A completed interview with no debrief. Asked for the same evening,
  //    because a debrief written three days later is worth very little.
  const { data: interviews } = await supabase
    .from('interviews')
    .select('id, user_id, application_id, scheduled_at')
    .lt('scheduled_at', new Date(now).toISOString())
    .gt('scheduled_at', new Date(now - DEBRIEF_NUDGE_WINDOW_DAYS * DAY_MS).toISOString())
    .is('debrief', null)
    .is('went_well', null)
    .limit(500);

  for (const interview of interviews ?? []) {
    const { error } = await supabase.from('reminders').insert({
      user_id: interview.user_id as string,
      application_id: interview.application_id as string,
      kind: 'thank_you',
      due_at: new Date().toISOString(),
      body: 'Write the debrief while it is fresh, and send the thank-you note.',
      rule_key: `debrief:${interview.id}`,
    });
    if (!error) created += 1;
  }

  // 2. An interview tomorrow, with nothing written down for it.
  //
  //    Asked the day before rather than the morning of: prep you think of an
  //    hour beforehand is not prep. Only interviews with no prep notes are
  //    raised, so someone who has already done the work is not nagged about it.
  const { data: soon } = await supabase
    .from('interviews')
    .select(
      'id, user_id, application_id, scheduled_at, kind, applications!inner ( roles!inner ( title, companies!inner ( name ) ) )',
    )
    .gt('scheduled_at', new Date(now).toISOString())
    .lt('scheduled_at', new Date(now + 2 * DAY_MS).toISOString())
    .is('prep_notes', null)
    .limit(500);

  type Upcoming = {
    id: string;
    user_id: string;
    application_id: string;
    applications: { roles: { title: string; companies: { name: string } } };
  };

  for (const interview of (soon ?? []) as unknown as Upcoming[]) {
    const { error } = await supabase.from('reminders').insert({
      user_id: interview.user_id,
      application_id: interview.application_id,
      kind: 'prep',
      due_at: new Date().toISOString(),
      body: `Interview at ${interview.applications.roles.companies.name} for ${interview.applications.roles.title} within two days, and nothing written down for it.`,
      rule_key: `prep:${interview.id}`,
    });
    if (!error) created += 1;
  }

  return created;
}
