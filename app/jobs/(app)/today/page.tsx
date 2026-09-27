import { createClient, requireUser } from '@/lib/jobs/auth/server';
import { PageHeader } from '@/components/shell/page-header';
import { EmptyState } from '@/components/ui/empty-state';
import { loadToday, INTERVIEW_HORIZON_DAYS } from '@/lib/jobs/today/load';
import { TodayLists } from './lists';

export const metadata = { title: 'This week' };

/**
 * What has to happen, and nothing else.
 *
 * The rest of the workspace answers "what is going on" -- 341 pursuits, most
 * of them dead, sorted by recency. This answers "what do I do", which is a
 * different and much shorter question, and it is the one you have on a Monday
 * morning. Sections disappear when they are empty rather than showing a zero:
 * a quiet week should look quiet.
 */
export default async function TodayPage() {
  const user = await requireUser();
  const supabase = await createClient();

  const { data: profile } = await supabase
    .from('profiles')
    .select('display_name, timezone')
    .eq('id', user.id)
    .maybeSingle();

  const timezone = (profile?.timezone as string) ?? 'UTC';

  const board = await loadToday(supabase, user.id, {
    senderName: (profile?.display_name as string) ?? null,
  });

  return (
    <>
      <PageHeader
        title="This week"
        description={
          board.clear
            ? 'Nothing needs you today.'
            : 'The things with a clock on them, in the order they run out.'
        }
      />

      {/* Finished, not empty: the week has nothing with a clock on it. That
          earns the day's sigil rather than a placeholder box. */}
      {board.clear && (
        <EmptyState
          tone="finished"
          seed={`${user.id}:${new Date().toISOString().slice(0, 10)}:jobs`}
          title="Nothing needs you today."
          description={`No interviews in the next ${INTERVIEW_HORIZON_DAYS} days, and nothing waiting on a reply.`}
          action={{ label: 'Look at the pipeline anyway', href: '/jobs/pipeline' }}
        />
      )}

      <TodayLists board={board} timezone={timezone} />
    </>
  );
}
