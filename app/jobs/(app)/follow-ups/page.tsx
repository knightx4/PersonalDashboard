import { createClient, requireUser } from '@/lib/jobs/auth/server';
import { loadFollowUps } from '@/lib/jobs/followup/load';
import type { CompanyContact } from './follow-up-card';
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

  // Their contacts at each company, to choose the person by hand.
  const companyIds = [...new Set(followUps.map((f) => f.companyId))];
  const { data: contacts } = companyIds.length
    ? await supabase
        .from('contacts')
        .select('id, full_name, title, company_id')
        .eq('user_id', user.id)
        .in('company_id', companyIds)
        .order('full_name')
    : { data: [] };
  const contactsByCompany: Record<string, CompanyContact[]> = {};
  for (const row of (contacts ?? []) as { id: string; full_name: string; title: string | null; company_id: string }[]) {
    (contactsByCompany[row.company_id] ??= []).push({ id: row.id, name: row.full_name, title: row.title });
  }

  return <FollowUpsView followUps={followUps} contactsByCompany={contactsByCompany} timezone={timezone} />;
}
