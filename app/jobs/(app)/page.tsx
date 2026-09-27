import { createClient, requireUser } from '@/lib/jobs/auth/server';
import { createCoreClient } from '@/lib/core/auth/server';
import { loadToday } from '@/lib/jobs/today/load';
import { PageHeader } from '@/components/shell/page-header';
import { SinceSection } from './_home/since-section';
import { SummarySection } from './_home/summary-section';
import { ThisWeekSection } from './_home/this-week-section';

export const metadata = { title: 'Home' };

/**
 * The Jobs home, and where `/jobs` lands (plan #1150).
 *
 * A column of sections, each its own server component under `_home/` that
 * loads what it shows and renders through HomeSection. The page reads what
 * more than one section needs (the user, the client, the timezone) once and
 * hands it down. It also loads This week's board, because "Since you last
 * looked" leaves out the mail This week lists as waiting on you. New sections
 * go above This week, which stays last: it is the longest, and the to-do lists
 * read best after the overview.
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
  const [core, board] = await Promise.all([
    createCoreClient(),
    loadToday(supabase, user.id, { senderName }),
  ]);

  return (
    <>
      <PageHeader title="Home" description="Where the search stands and what needs you this week." />
      <div className="space-y-8">
        <SummarySection supabase={supabase} userId={user.id} />
        <SinceSection
          supabase={supabase}
          core={core}
          userId={user.id}
          timezone={timezone}
          waitingEventIds={board.waiting.map((item) => item.eventId)}
        />
        <ThisWeekSection board={board} timezone={timezone} />
      </div>
    </>
  );
}
