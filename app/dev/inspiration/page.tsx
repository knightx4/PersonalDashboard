import { createClient, requireUser } from '@/lib/auth/server';
import { loadInspiration } from '@/lib/dev/inspiration/load';
import { parseInspirationView } from '@/lib/dev/inspiration/view';
import { InspirationScreen } from './inspiration-view';

export const metadata = { title: 'Inspiration' };

/**
 * What Dash took from the videos saved for this app (plan #1412).
 *
 * Dash reads each video in the playlist and keeps the points that could apply
 * here. This page shows them by video, or as one list where a point two videos
 * made is shown once. Already in the plan, a takeaway says which step; put
 * aside, it is in the fold at the bottom.
 */
export default async function DevInspirationPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string | string[] }>;
}) {
  const user = await requireUser();
  const supabase = await createClient();
  const view = parseInspirationView((await searchParams).view);

  const page = await loadInspiration(supabase, user.id);

  return <InspirationScreen page={page} view={view} />;
}
