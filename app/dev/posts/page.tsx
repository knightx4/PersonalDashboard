import { createClient, requireUser } from '@/lib/auth/server';
import { loadPostsPage, xPostsShown } from '@/lib/dev/posts-page';
import { loadXAccount, xConnectionView, xConnectNotice } from '@/lib/x/account';
import { isXOAuthConfigured, X_SETUP_STEP } from '@/lib/x/env';
import { PostsScreen } from './posts-view';

export const metadata = { title: 'Posts' };

// Check X now runs from this page, and a first read pages through every post
// X returns (plan #1819).
export const maxDuration = 300;

/**
 * X posts Dash drafted about building this app (plan #1419, feature #1414).
 *
 * Suggest posts starts a run that drafts a few from what shipped since the
 * last posted one. Each draft is edited here, copied, posted on X by the
 * person, and marked posted with its link; or dropped. Dash never posts.
 *
 * Above the drafts sits the X connection (plan #1818): Connect X signs in to
 * the person's own account so what they posted can be read back. `?x=` is
 * what the last round trip did, from /api/x/callback.
 *
 * Beneath the drafts, Posted on X lists the posts read from X that match no
 * draft (plan #1820); `?onx=` is how many of them to list.
 *
 * The Dev layout has already refused anybody but the owner, and every action
 * on the page refuses them again in its own right (#417).
 */
export default async function DevPostsPage({
  searchParams,
}: {
  searchParams: Promise<{ x?: string | string[]; onx?: string | string[] }>;
}) {
  const user = await requireUser();
  const supabase = await createClient();
  const { x, onx } = await searchParams;
  const shown = xPostsShown(typeof onx === 'string' ? onx : null);
  // The request's clock (the loader's default) decides whether the last run is
  // still going. While it is, Suggest posts refreshes the page every fifteen
  // seconds.
  const [page, account] = await Promise.all([loadPostsPage(supabase, user.id, undefined, shown), loadXAccount(supabase, user.id)]);
  return (
    <PostsScreen
      page={page}
      x={xConnectionView(account, isXOAuthConfigured(), X_SETUP_STEP)}
      xNotice={xConnectNotice(typeof x === 'string' ? x : null)}
    />
  );
}
