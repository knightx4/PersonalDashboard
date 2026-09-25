import { createClient, requireUser } from '@/lib/jobs/auth/server';
import { PageHeader } from '@/components/shell/page-header';
import { formatDate } from '@/lib/jobs/applications/load';
import { ThoughtList } from './thoughts';

export const metadata = { title: 'Career goals' };

/**
 * Career goals: what you want from the next job and where you are now.
 *
 * Dated entries of free writing, newest first (job_search.thoughts, 0026).
 * A new entry is added rather than the old one overwritten, so the page keeps
 * how the thinking moved, and where two entries disagree the newer one wins.
 * Goals reads these through the sources catalogue when it maps a career goal,
 * which is why lib/jobs/sources.ts links a row here.
 */
export default async function ThoughtsPage() {
  const user = await requireUser();
  const supabase = await createClient();

  const [{ data: thoughts }, { data: profile }] = await Promise.all([
    supabase
      .from('thoughts')
      .select('id, body, created_at, updated_at')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false }),
    supabase.from('profiles').select('timezone').eq('id', user.id).single(),
  ]);

  const timezone = profile?.timezone ?? 'UTC';
  const rows = (thoughts ?? []) as Array<{
    id: string;
    body: string;
    created_at: string;
    updated_at: string;
  }>;

  return (
    <>
      <PageHeader
        title="Career goals"
        description="What you want from the next job and where you are now, in your own words. Add a new entry when your thinking changes; the newest one counts."
      />
      <ThoughtList
        thoughts={rows.map((row) => ({
          id: row.id,
          body: row.body,
          written: formatDate(row.created_at, timezone),
          // A minute's grace, because the insert and its trigger stamp both
          // columns a few microseconds apart.
          edited:
            new Date(row.updated_at).getTime() - new Date(row.created_at).getTime() > 60_000
              ? formatDate(row.updated_at, timezone)
              : null,
        }))}
      />
    </>
  );
}
