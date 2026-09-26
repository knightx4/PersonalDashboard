import { createClient, requireUser } from '@/lib/jobs/auth/server';
import { PageHeader } from '@/components/shell/page-header';
import { formatDate } from '@/lib/jobs/applications/load';
import { loadLearningTracks } from '@/lib/jobs/learning/load';
import { createLearnClient } from '@/lib/learn/auth/server';
import { ThoughtList } from './thoughts';
import { LearningTracks } from './tracks';

export const metadata = { title: 'Career goals' };

/**
 * Career goals: what you want from the next job and where you are now.
 *
 * Dated entries of free writing, newest first (job_search.thoughts, 0026).
 * A new entry is added rather than the old one overwritten, so the page keeps
 * how the thinking moved, and where two entries disagree the newer one wins.
 * Goals reads these through the sources catalogue when it maps a career goal,
 * which is why lib/jobs/sources.ts links a row here.
 *
 * Above the entries, the learning tracks suggested from them
 * (job_search.learning_tracks, 0027): starting one makes it a Learn goal with
 * its own track, and the tracks started here are listed with a link to each.
 */
export default async function ThoughtsPage() {
  const user = await requireUser();
  const supabase = await createClient();
  const learn = await createLearnClient();

  const [{ data: thoughts }, { data: profile }, tracks] = await Promise.all([
    supabase
      .from('thoughts')
      .select('id, body, created_at, updated_at')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false }),
    supabase.from('profiles').select('timezone').eq('id', user.id).single(),
    // A failed read hides the section rather than failing the page.
    loadLearningTracks(supabase, learn, user.id).catch((error) => {
      console.error('[jobs thoughts] learning tracks', error);
      return null;
    }),
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
      {tracks && (
        <div className="mb-3 max-w-3xl">
          <LearningTracks
            suggested={tracks.suggested}
            started={tracks.started}
            hasEntries={rows.length > 0}
          />
        </div>
      )}
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
