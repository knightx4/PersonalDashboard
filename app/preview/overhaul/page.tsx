import Link from 'next/link';
import { notFound } from 'next/navigation';
import { isOwner } from '@/lib/dev/owner';
import { MAIN_BOX } from '@/components/shell/main-box';
import { PageHeader } from '@/components/shell/page-header';
import { Card } from '@/components/ui/card';
import { segmentedFrame } from '@/components/ui/segmented';
import { cn } from '@/lib/cn';
import { ENTRIES, FAMILIES, KEPT } from './entries';
import { Pair, parseShow, type Show } from './pair';

export const metadata = { title: 'Component overhaul' };

export const dynamic = 'force-dynamic';

const SHOWS: readonly { value: Show; label: string }[] = [
  { value: 'both', label: 'Both' },
  { value: 'now', label: 'Now' },
  { value: 'next', label: 'Proposed' },
];

/**
 * Every component in the overhaul, today beside the proposal, on one page.
 * Gated the way the surface gallery is (app/preview/page.tsx): the owner, or
 * a build with UI_PREVIEW=1 for the screenshot harness.
 */
export default async function OverhaulPage({
  searchParams,
}: {
  searchParams: Promise<{ show?: string }>;
}) {
  if (process.env.UI_PREVIEW !== '1' && !(await isOwner())) notFound();
  const show = parseShow((await searchParams).show);

  return (
    <div className="bg-page min-h-screen">
      <div className={MAIN_BOX}>
        <PageHeader
          title="Component overhaul"
          description={`${ENTRIES.length} shared components, each drawn as the app has it today and as proposed. Open one for what is wrong with it and what would move.`}
          actions={
            <nav aria-label="Show" className={cn(segmentedFrame, 'overflow-hidden')}>
              {SHOWS.map((option) => (
                <Link
                  key={option.value}
                  href={option.value === 'both' ? '/preview/overhaul' : `/preview/overhaul?show=${option.value}`}
                  aria-current={option.value === show ? 'true' : undefined}
                  className={cn(
                    'press inline-flex h-(--control-h) items-center px-2.5 text-ui font-medium transition-colors duration-quick',
                    option.value === show
                      ? 'bg-accent-tint text-accent'
                      : 'bg-surface text-ink-muted hover:bg-sunken hover:text-ink',
                  )}
                >
                  {option.label}
                </Link>
              ))}
            </nav>
          }
        />

        <Card padding="dense" className="mb-8">
          <h2 className="mb-2 text-ui font-semibold text-ink">Where the app is not unified</h2>
          <ul className="divide-y divide-border">
            {ENTRIES.map((entry) => (
              <li key={entry.id}>
                <Link
                  href={`/preview/overhaul/${entry.id}`}
                  className="press flex flex-col gap-0.5 py-2 sm:flex-row sm:items-baseline sm:gap-4"
                >
                  <span className="shrink-0 text-ui font-medium text-ink hover:text-accent sm:w-52">{entry.name}</span>
                  <span className="text-small text-ink-muted">{entry.drift}</span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>

        <div className="space-y-12">
          {FAMILIES.map((family) => (
            <section key={family} className="space-y-8">
              <h2 className="text-micro font-semibold uppercase tracking-wider text-ink-muted">{family}</h2>
              {ENTRIES.filter((entry) => entry.family === family).map((entry) => (
                <article key={entry.id} id={entry.id} className="scroll-mt-6 space-y-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                    <h3 className="font-display text-title tracking-tight text-ink">{entry.name}</h3>
                    <Link
                      href={`/preview/overhaul/${entry.id}`}
                      className="text-small text-accent underline decoration-accent/40 underline-offset-2 hover:decoration-accent"
                    >
                      What changes and why
                    </Link>
                  </div>
                  <Pair entry={entry} show={show} />
                </article>
              ))}
            </section>
          ))}

          <Card padding="dense">
            <h2 className="mb-2 text-ui font-semibold text-ink">Kept as they are</h2>
            <ul className="divide-y divide-border">
              {KEPT.map((kept) => (
                <li key={kept.name} className="py-2">
                  <p className="text-ui font-medium text-ink">{kept.name}</p>
                  <p className="text-small text-ink-muted">{kept.why}</p>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>
    </div>
  );
}
