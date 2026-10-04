import { createClient, requireUser } from '@/lib/auth/server';
import { loadChangelog } from '@/lib/changelog/load';
import {
  CHANGELOG_DEFAULT_GROUPING,
  isChangelogGrouping,
  isChangelogModuleFilter,
  type ChangelogGrouping,
  type ChangelogModuleFilter,
} from '@/lib/changelog/entries';
import { ChangelogView } from './changelog-view';

export const metadata = { title: 'Changelog' };

/**
 * What has already shipped.
 *
 * The other three lists in this workspace all say what is going to happen — a
 * bug is a thing that is wrong now, the plan is what was decided on, an idea is
 * what nobody has committed to. Nothing said what already did, so the only way
 * to answer "when did that land, and in which commit" was to read the git log
 * beside the plan page and join the two by eye.
 *
 * Every line is one of the app's own closed rows: a plan step marked done or a
 * note marked fixed, both of which already carry the commit that shipped them
 * and the day they closed. That is the answer recorded on plan step #122, and
 * its cost is worth knowing before wondering where something is: work done off
 * the plan and outside the notes queue — a refactor, a UI sweep — never appears
 * here, because nothing in the app ever knew about it.
 *
 * It filters by workspace, which v1 deliberately did without: the list was
 * short enough to read straight through, so a control that narrowed it was one
 * nobody would press. It stopped being short. The filter is a search parameter
 * like the grouping and the search, and it only offers workspaces something
 * actually shipped under — the original worry, a control that leads nowhere,
 * answered rather than dropped.
 *
 * It is grouped three ways. By issue is what it opens on: a feature's steps
 * gathered under the feature, one line each, because six lines spread over
 * three days were one piece of work and the page had no way of saying so. By
 * day is the flat record, and by commit puts back together what one commit
 * closed, which a batch scatters. The grouping is a search parameter and not
 * state, so "the changelog by commit" is a link somebody can keep -- law 5, and
 * it means this page still works with no JavaScript at all.
 */
export default async function DevChangelogPage({
  searchParams,
}: {
  searchParams: Promise<{
    group?: string | string[];
    q?: string | string[];
    module?: string | string[];
  }>;
}) {
  const user = await requireUser();
  const supabase = await createClient();
  const params = await searchParams;

  const asked = Array.isArray(params.group) ? params.group[0] : params.group;
  const grouping: ChangelogGrouping =
    asked && isChangelogGrouping(asked) ? asked : CHANGELOG_DEFAULT_GROUPING;

  const query = (Array.isArray(params.q) ? params.q[0] : params.q)?.trim() ?? '';

  const askedModule = Array.isArray(params.module) ? params.module[0] : params.module;
  // `workspace` rather than `module`: Next reserves the name at module scope.
  const workspace: ChangelogModuleFilter | null =
    askedModule && isChangelogModuleFilter(askedModule) ? askedModule : null;

  const entries = await loadChangelog(supabase, user.id);
  return <ChangelogView entries={entries} grouping={grouping} query={query} workspace={workspace} />;
}
