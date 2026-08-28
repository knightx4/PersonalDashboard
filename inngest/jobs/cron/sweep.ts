import { createServiceSupabase } from '@/inngest/jobs/supabase-admin';

/**
 * The nightly sweep: ghosting and rule-generated reminders.
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

export type SweepSummary = { ghosted: number; reminders: number };

export async function runJobSweep(): Promise<SweepSummary> {
  const supabase = createServiceSupabase();

  const { data: ghosted, error } = await supabase.rpc('sweep_ghosted_applications', {
    p_user_id: null,
  });
  if (error) throw new Error(error.message);

  const reminders = await generateReminders(supabase);
  return { ghosted: ghosted ?? 0, reminders };
}

/**
 * Rule-generated reminders. Idempotent on rule_key, so running the sweep twice
 * in a day does not produce two of anything.
 */
async function generateReminders(
  supabase: ReturnType<typeof createServiceSupabase>,
): Promise<number> {
  let created = 0;
  const now = Date.now();

  // 1. A submitted application with no response after ten days is worth a nudge.
  const { data: silent } = await supabase
    .from('applications')
    .select('id, user_id, submitted_at, roles!inner ( title, companies!inner ( name ) )')
    .in('status', ['submitted', 'acknowledged'])
    .is('first_human_response_at', null)
    .not('submitted_at', 'is', null)
    .lt('submitted_at', new Date(now - 10 * DAY_MS).toISOString())
    .limit(500);

  type Row = {
    id: string;
    user_id: string;
    submitted_at: string;
    roles: { title: string; companies: { name: string } };
  };

  for (const application of (silent ?? []) as unknown as Row[]) {
    const { error } = await supabase.from('reminders').insert({
      user_id: application.user_id,
      application_id: application.id,
      kind: 'follow_up',
      due_at: new Date().toISOString(),
      body: `No reply from ${application.roles.companies.name} on ${application.roles.title} after ten days. Follow up or let it go.`,
      rule_key: `follow_up:${application.id}`,
    });
    if (!error) created += 1;
  }

  // 2. A completed interview with no debrief. Asked for the same evening,
  //    because a debrief written three days later is worth very little.
  const { data: interviews } = await supabase
    .from('interviews')
    .select('id, user_id, application_id, scheduled_at')
    .lt('scheduled_at', new Date(now).toISOString())
    .gt('scheduled_at', new Date(now - 3 * DAY_MS).toISOString())
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

  return created;
}
