import { createClient, requireUser } from '@/lib/auth/server';
import { loadPostsPage } from '@/lib/dev/posts-page';
import { PostsScreen } from './posts-view';

export const metadata = { title: 'Posts' };

/**
 * X posts Dash drafted about building this app (plan #1419, feature #1414).
 *
 * Suggest posts starts a run that drafts a few from what shipped since the
 * last posted one. Each draft is edited here, copied, posted on X by the
 * person, and marked posted with its link; or dropped. Dash never posts.
 *
 * The Dev layout has already refused anybody but the owner, and every action
 * on the page refuses them again in its own right (#417).
 */
export default async function DevPostsPage() {
  const user = await requireUser();
  const supabase = await createClient();
  // The request's clock (the loader's default) decides whether the last run is
  // still going. While it is, Suggest posts refreshes the page every fifteen
  // seconds.
  const page = await loadPostsPage(supabase, user.id);
  return <PostsScreen page={page} />;
}
