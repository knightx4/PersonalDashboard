import Link from 'next/link';
import type { AppSupabaseClient } from '@/lib/jobs/db/schema-name';
import { loadPipeline } from '@/lib/jobs/applications/load';
import {
  INTERVIEW_HORIZON_DAYS,
  SENT_WINDOW_DAYS,
  summariseSearch,
  type SummaryInterview,
} from '@/lib/jobs/home/summary';
import { Card } from '@/components/ui/card';
import { HomeSection } from './home-section';

/**
 * Where the search stands, in a few numbers (plan #1151). First on Home.
 *
 * Counted from your own rows by lib/jobs/home/summary.ts, so opening the page
 * costs nothing. Each number links to the tab it can be checked against:
 * the stages and the sent count to Pipeline, which has no status filter to
 * narrow to, and the interviews to Interviews.
 *
 * A search with nothing live, nothing sent this week and no interviews coming
 * has nothing to summarise, so the section is left out (law 1).
 */
export async function SummarySection({
  supabase,
  userId,
}: {
  supabase: AppSupabaseClient;
  userId: string;
}) {
  const [rows, interviewResult] = await Promise.all([
    loadPipeline(supabase, userId),
    supabase
      .from('interviews')
      // applications!inner, as the Interviews tab reads them, so a round
      // whose application is gone is not counted here and missing there.
      .select('id, scheduled_at, time_known, group_id, applications!inner ( id )')
      .eq('user_id', userId)
      .not('scheduled_at', 'is', null),
  ]);

  const interviews: SummaryInterview[] | null = interviewResult.error
    ? null
    : (interviewResult.data ?? []).map((row) => ({
        id: row.id as string,
        scheduledAt: row.scheduled_at as string | null,
        timeKnown: row.time_known as boolean | null,
        groupId: row.group_id as string | null,
      }));

  const summary = summariseSearch(rows, interviews, new Date());

  if (summary.live === 0 && summary.sentRecently === 0 && summary.interviewsSoon === 0) {
    return null;
  }

  const stats: Array<{ label: string; value: string; href: string }> = [
    { label: 'Live applications', value: String(summary.live), href: '/jobs/pipeline' },
    ...summary.byStage.map((stage) => ({
      label: stage.label,
      value: String(stage.count),
      href: '/jobs/pipeline',
    })),
    {
      label: `Sent in the last ${SENT_WINDOW_DAYS} days`,
      value: String(summary.sentRecently),
      href: '/jobs/pipeline',
    },
    {
      label: `Interviews in the next ${INTERVIEW_HORIZON_DAYS} days`,
      // Law 2: a failed read says so rather than passing for none.
      value: summary.interviewsSoon === null ? 'Could not load' : String(summary.interviewsSoon),
      href: '/jobs/interviews',
    },
  ];

  return (
    <HomeSection id="summary" title="Where it stands">
      <Card padding="standard">
        <dl className="flex flex-wrap gap-x-8 gap-y-4">
          {stats.map((stat) => (
            <div key={stat.label} className="flex min-w-0 flex-col-reverse">
              <dt className="text-small text-ink-muted">{stat.label}</dt>
              <dd className="tabular text-body font-semibold tracking-tight text-ink">
                <Link href={stat.href} className="transition-colors duration-150 hover:text-accent">
                  {stat.value}
                </Link>
              </dd>
            </div>
          ))}
        </dl>
      </Card>
    </HomeSection>
  );
}
