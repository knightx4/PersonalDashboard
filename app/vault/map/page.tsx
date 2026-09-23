import Link from 'next/link';
import { Waypoints } from 'lucide-react';
import { PageHeader } from '@/components/shell/page-header';
import { EmptyState } from '@/components/ui/empty-state';
import { cardVariants } from '@/components/ui/card';
import { createVaultClient } from '@/lib/vault/auth/server';
import { loadThemeList, THEME_LIST_LIMIT } from '@/lib/vault/map/read';
import { loadMergeLog } from '@/lib/vault/map/merge-log';
import { loadLatestSweep } from '@/lib/vault/map/sweep-read';
import { cn } from '@/lib/cn';
import { MergeLog } from './merge-log';
import { SweepPanel } from './sweep-panel';

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
  const mergeTotal = mergeLog.counts.theme + mergeLog.counts.position;

  if (themes.length === 0) {
    return (
      <>
        <PageHeader title="Map" />
        <SweepPanel sweep={sweep} />
        {/* Themes arrive two ways: the sweep above, and one note's own Map
            section. The empty state names both. */}
        <EmptyState
          icon={Waypoints}
          title="Nothing on the map yet"
          description="The map lists the subjects your notes return to, most written about first, with the positions under each and the sentence each came from. Sweep every note to fill it, or open one note and use its Map section. What the sweep reads and what you accept on a note appear here."
          action={{ label: 'Open your notes', href: '/vault' }}
        />
      </>
    );
  }

  return (
    <>
      <PageHeader title="Map" />
      <SweepPanel sweep={sweep} />

      <p className="mb-3 text-body text-ink-muted">
        {themes.length} {themes.length === 1 ? 'theme' : 'themes'}, most written about first
        {capped && ` (the first ${THEME_LIST_LIMIT} are shown)`}
        {mergeTotal > 0 && (
          <>
            {' · '}
            <a href="#merges" className="text-ink underline-offset-2 hover:underline">
              {mergeTotal.toLocaleString('en-GB')} {mergeTotal === 1 ? 'merge' : 'merges'} below
            </a>
          </>
        )}
      </p>

      <ul className={cn(cardVariants(), 'divide-y divide-border overflow-hidden')}>
        {themes.map((theme) => (
          <li key={theme.id}>
            <Link
              href={`/vault/map/${theme.id}`}
              className="flex items-baseline gap-4 px-4 py-3 transition-colors duration-150 hover:bg-canvas"
            >
              <span className="min-w-0 flex-1">
                <span className="block text-body font-medium text-ink">{theme.name}</span>
                <span className="mt-0.5 block truncate text-ui text-ink-muted">{theme.about}</span>
              </span>
              <span className="shrink-0 text-small tabular-nums text-ink-muted">
                {count(theme.notes, 'note', 'notes')} · {count(theme.positions, 'position', 'positions')}
              </span>
            </Link>
          </li>
        ))}
      </ul>

      <MergeLog log={mergeLog} />
    </>
  );
}

function count(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}
