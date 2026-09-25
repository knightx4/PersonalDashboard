import { createClient, requireUser } from '@/lib/jobs/auth/server';
import { PageHeader } from '@/components/shell/page-header';
import { ThoughtsView, type Thought } from './view';

export const metadata = { title: 'Thoughts' };

/**
 * Free writing about the search: what you are looking for and how that has
 * changed. Dated entries, newest first, with no fields to fill in.
 *
 * The Goals routine reads these when it plans or reviews a career goal (see
 * .claude/skills/goals/SKILL.md), so what is written here steers the goals and
 * job leads it proposes as well as this module.
 */
export default async function ThoughtsPage() {
  const user = await requireUser();
  const supabase = await createClient();

  const [{ data: rows }, { data: profile }] = await Promise.all([
    supabase
      .from('thoughts')
      .select('id, body, created_at, updated_at')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false }),
    supabase.from('profiles').select('timezone').eq('id', user.id).single(),
  ]);

  const thoughts: Thought[] = (rows ?? []).map((row) => ({
    id: row.id as string,
    body: row.body as string,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  }));

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Thoughts"
        description="What you are looking for in a job and how that has shifted, in your own words. Goals reads these when it plans your career goals."
      />
      <ThoughtsView thoughts={thoughts} timezone={(profile?.timezone as string) ?? 'UTC'} />
    </div>
  );
}
