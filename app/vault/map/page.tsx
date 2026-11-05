import { Suspense } from 'react';
import { createVaultClient } from '@/lib/vault/auth/server';
import { createCoreClient } from '@/lib/core/auth/server';
import { requireUser } from '@/lib/auth/server';
import { jevEnabledFor } from '@/lib/jev/enabled';
import { loadThemeList } from '@/lib/vault/map/read';
import { loadMergeLog, type MergeLogPage } from '@/lib/vault/map/merge-log';
import { loadLatestSweep } from '@/lib/vault/map/sweep-read';
import { loadIdeaList, mapAddress, type IdeaSort } from '@/lib/vault/map/ideas';
import { VaultMapView } from './map-view';
import { IdeasList, IdeasLoading, type IdeasState } from './ideas-view';

export const dynamic = 'force-dynamic';

/**
 * What you write about, most written about first (#758).
 *
 * The order is the theme's strength, which counts the notes under it, how much
 * text, how recently and whose words they are. The number itself is not shown:
 * it only means something relative to the others, and the list already says
 * that. The counts beside each name are what a reader can check.
 *
 * Opening a theme is the first of the two taps to a sentence; the note link
 * under each quote on the theme's page is the second.
 *
 * Below the themes, every merge the map has made, a page at a time, with an
 * undo on each (#821). `?merges=` is the page.
 *
 * `?view=ideas` lists your scored ideas instead (plan #2947.5), sorted by
 * `?sort=combined|usefulness|novelty`, fifty to a `?page=`.
 */
export default async function VaultMapPage({
  searchParams,
}: {
  searchParams: Promise<{
    merges?: string | string[];
    view?: string | string[];
    sort?: string | string[];
    page?: string | string[];
  }>;
}) {
  const params = await searchParams;
  const { view, sort, page } = mapAddress(params);
  const supabase = await createVaultClient();

  if (view === 'ideas') {
    const sweep = await loadLatestSweep(supabase);
    return (
      <VaultMapView
        themes={[]}
        capped={false}
        sweep={sweep}
        mergeLog={NO_MERGES}
        view="ideas"
        ideas={
          <Suspense key={`${sort}-${page}`} fallback={<IdeasLoading sort={sort} />}>
            <Ideas sort={sort} page={page} />
          </Suspense>
        }
      />
    );
  }

  const [{ themes, capped }, sweep, mergeLog] = await Promise.all([
    loadThemeList(supabase),
    loadLatestSweep(supabase),
    loadMergeLog(supabase, params.merges),
  ]);

  return <VaultMapView themes={themes} capped={capped} sweep={sweep} mergeLog={mergeLog} />;
}

const NO_MERGES: MergeLogPage = {
  rows: [],
  counts: { theme: 0, position: 0, undone: 0 },
  page: 1,
  pages: 1,
};

/** The ranked list, read where it is drawn so the header shows while it loads. */
async function Ideas({ sort, page }: { sort: IdeaSort; page: number }) {
  let state: IdeasState;
  try {
    const supabase = await createVaultClient();
    const user = await requireUser();
    const [list, jevOn] = await Promise.all([
      loadIdeaList(supabase, sort, page),
      jevEnabledFor(await createCoreClient(), user.id),
    ]);
    state = { status: 'ready', list, jevOn };
  } catch (error) {
    console.error('[vault map] ideas', error);
    state = {
      status: 'error',
      sort,
      message: error instanceof Error ? error.message : 'The read failed.',
    };
  }
  return <IdeasList state={state} />;
}
