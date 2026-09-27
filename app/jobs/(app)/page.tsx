import { createClient, requireUser } from '@/lib/jobs/auth/server';
import { PageHeader } from '@/components/shell/page-header';
import { SummarySection } from './_home/summary-section';
import { ThisWeekSection } from './_home/this-week-section';

export const metadata = { title: 'Home' };

/**
 * The Jobs home, and where `/jobs` lands (plan #1150).
 *
 * A column of sections, each its own server component under `_home/` that
 * loads what it shows and renders through HomeSection. The page reads what
 * more than one section needs (the user, the client, the timezone) once and
 * hands it down. New sections go above This week, which stays last: it is the
 * longest, and the to-do lists read best after the overview.
 *
 * /jobs/today, the page this replaced, redirects here.
 */
export default async function JobsHome() {
  const user = await requireUser();
  const supabase = await createClient();

  const { data: profile } = await supabase
    .from('profiles')
    .select('display_name, timezone')
    .eq('id', user.id)
    .maybeSingle();

  const timezone = (profile?.timezone as string) ?? 'UTC';
  const senderName = (profile?.display_name as string) ?? null;

  return (
    <>
      <PageHeader title="Home" description="Where the search stands and what needs you this week." />
      <div className="space-y-8">
        <SummarySection supabase={supabase} userId={user.id} />
        <ThisWeekSection
          supabase={supabase}
          userId={user.id}
          timezone={timezone}
          senderName={senderName}
        />
      </div>
    </>
  );
}
