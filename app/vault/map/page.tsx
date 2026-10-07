import { createVaultClient } from '@/lib/vault/auth/server';
import { loadThemeList } from '@/lib/vault/map/read';
import { loadMergeLog } from '@/lib/vault/map/merge-log';
import { loadLatestSweep } from '@/lib/vault/map/sweep-read';
import { VaultMapView } from './map-view';

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
 */
export default async function VaultMapPage({
  searchParams,
}: {
  searchParams: Promise<{ merges?: string | string[] }>;
}) {
  const { merges } = await searchParams;
  const supabase = await createVaultClient();
  const [{ themes, capped }, sweep, mergeLog] = await Promise.all([
    loadThemeList(supabase),
    loadLatestSweep(supabase),
    loadMergeLog(supabase, merges),
  ]);

  return <VaultMapView themes={themes} capped={capped} sweep={sweep} mergeLog={mergeLog} />;
}
