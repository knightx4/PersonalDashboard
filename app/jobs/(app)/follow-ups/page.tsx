import { createClient, requireUser } from '@/lib/jobs/auth/server';
import { loadFollowUps } from '@/lib/jobs/followup/load';
import { FollowUpsView } from './view';

export const metadata = { title: 'Follow-ups' };

// Finding someone runs a web search and a draft in this page's server actions.
export const maxDuration = 300;

/**
 * Every role about to be applied for, and every application waiting on a
 * first reply, each with the person to tell about it and the note to them
 * (lib/jobs/followup). The same card is on each role's page. Drawn by
 * FollowUpsView, which the gallery draws from fixtures.
 */
export default async function FollowUpsPage() {
  const user = await requireUser();
  const supabase = await createClient();
  const [followUps, { data: profile }] = await Promise.all([
    loadFollowUps(supabase, user.id),
    supabase.from('profiles').select('timezone').eq('id', user.id).maybeSingle(),
  ]);
  const timezone = (profile?.timezone as string | null) ?? 'UTC';

  return <FollowUpsView followUps={followUps} timezone={timezone} />;
}
