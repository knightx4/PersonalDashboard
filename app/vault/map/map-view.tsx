import Link, { linkVariants } from '@/components/ui/link';
import { Waypoints } from 'lucide-react';
import { PageHeader } from '@/components/shell/page-header';
import { EmptyState } from '@/components/ui/empty-state';
import { cardVariants } from '@/components/ui/card';
import { THEME_LIST_LIMIT, type ThemeListRow } from '@/lib/vault/map/read';
import type { MergeLogPage } from '@/lib/vault/map/merge-log';
import { SWEEP_PAUSED, type SweepView } from '@/lib/vault/map/sweep-read';
import { cn } from '@/lib/cn';
import { MergeLog } from './merge-log';
import { SweepAction, SweepPanel } from './sweep-panel';
import { PageColumn } from '@/components/shell/page-width';
import { sectionSubject } from '@/lib/core/section-path';
import { formatNumber } from '@/lib/money';
import type { MapView } from '@/lib/vault/map/ideas';
import { MapViewSwitch } from './ideas-view';

/**
 * The map's list of themes, drawn from what the page read (page.tsx), so the
 * gallery can draw it from fixtures (plan #1605). With `view="ideas"` the
 * themes give way to `ideas`, the ranked list of scored ideas (plan #2947.5),
 * which the page reads inside a Suspense boundary of its own.
 */
export function VaultMapView({
  themes,
  capped,
  sweep,
  mergeLog,
  view = 'themes',
  ideas,
}: {
  themes: ThemeListRow[];
  capped: boolean;
  sweep: SweepView | null;
  mergeLog: MergeLogPage;
  view?: MapView;
  ideas?: React.ReactNode;
}) {
  const mergeTotal = mergeLog.counts.theme + mergeLog.counts.position;

  if (view === 'ideas') {
    return (
      <PageColumn>
        <PageHeader
          subject={sectionSubject('/vault/map', 'Map')}
          title="Map"
          actions={<SweepAction sweep={sweep} />}
        />
        <SweepPanel sweep={sweep} />
        {ideas}
      </PageColumn>
    );
  }

  if (themes.length === 0) {
    return (
      <PageColumn>
        <PageHeader
          subject={sectionSubject('/vault/map', 'Map')}
          title="Map"
          actions={<SweepAction sweep={sweep} />}
        />
        <SweepPanel sweep={sweep} />
        {/* Themes arrive two ways: the sweep above, and one note's own Map
            section. The empty state names both. */}
        <EmptyState
          icon={Waypoints}
          title="Nothing on the map yet"
          description={
            SWEEP_PAUSED
              ? 'The map lists the subjects your notes return to, most written about first, with the positions under each and the sentence each came from. Open a note and use its Map section: what you accept there appears here.'
              : 'The map lists the subjects your notes return to, most written about first, with the positions under each and the sentence each came from. Sweep every note to fill it, or open one note and use its Map section. What the sweep reads and what you accept on a note appear here.'
          }
          action={{ label: 'Open your notes', href: '/vault' }}
        />
      </PageColumn>
    );
  }

  return (
    <PageColumn>
      <PageHeader
        subject={sectionSubject('/vault/map', 'Map')}
        title="Map"
        actions={<SweepAction sweep={sweep} />}
      />
      <SweepPanel sweep={sweep} />

      <div className="mb-3">
        <MapViewSwitch view="themes" />
      </div>
      <p className="mb-3 text-body text-ink-muted">
        {themes.length} {themes.length === 1 ? 'theme' : 'themes'}, most written about first
        {capped && ` (the first ${THEME_LIST_LIMIT} are shown)`}
        {mergeTotal > 0 && (
          <>
            {' · '}
            <a href="#merges" className={linkVariants()}>
              {formatNumber(mergeTotal)} {mergeTotal === 1 ? 'merge' : 'merges'} below
            </a>
          </>
        )}
      </p>

      <ul className={cn(cardVariants(), 'divide-y divide-border overflow-hidden')}>
        {themes.map((theme) => (
          <li key={theme.id}>
            <Link
              href={`/vault/map/${theme.id}`}
              className="flex items-baseline gap-4 px-4 py-3 transition-colors duration-quick hover:bg-canvas"
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

      {/* The note links and the rename field in the merge log are 44px tall on
          a phone, set here so MergeLog stays as it is (plan #1605). */}
      <div className="[&_a]:press-area max-sm:[&_input:not([type=checkbox]):not([type=radio])]:min-h-11">
        <MergeLog log={mergeLog} />
      </div>
    </PageColumn>
  );
}

function count(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}
