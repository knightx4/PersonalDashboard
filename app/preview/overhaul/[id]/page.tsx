/* ui-ok-file: card-per-row -- two cards side by side, each holding a list; not a card per row. */

import Link from '@/components/ui/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { isOwner } from '@/lib/dev/owner';
import { MAIN_BOX } from '@/components/shell/main-box';
import { PageHeader } from '@/components/shell/page-header';
import { Card } from '@/components/ui/card';
import { ENTRIES } from '../entries';
import { Pair } from '../pair';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const entry = ENTRIES.find((candidate) => candidate.id === id);
  return { title: entry ? `${entry.name} · Overhaul` : 'Overhaul' };
}

/** One component in the overhaul: what is wrong, the proposal, and both drawings. */
export default async function OverhaulEntryPage({ params }: { params: Promise<{ id: string }> }) {
  if (process.env.UI_PREVIEW !== '1' && !(await isOwner())) notFound();
  const { id } = await params;
  const index = ENTRIES.findIndex((entry) => entry.id === id);
  if (index < 0) notFound();
  const entry = ENTRIES[index]!;
  const previous = ENTRIES[index - 1];
  const next = ENTRIES[index + 1];

  return (
    <div className="bg-page min-h-screen">
      <div className={`${MAIN_BOX} max-w-5xl`}>
        <PageHeader
          title={entry.name}
          description={entry.drift}
          crumbs={[{ label: 'Component overhaul', href: `/preview/overhaul#${entry.id}` }, { label: entry.name, href: `/preview/overhaul/${entry.id}` }]}
        />

        <div className="space-y-6">
          <Pair entry={entry} show="both" />

          <div className="grid gap-3 md:grid-cols-2">
            <Card padding="standard">
              <h2 className="mb-2 text-ui font-semibold text-ink">What is wrong</h2>
              <ul className="list-disc space-y-2 pl-4 text-ui text-ink marker:text-ink-ghost">
                {entry.problems.map((problem) => (
                  <li key={problem}>{problem}</li>
                ))}
              </ul>
            </Card>
            <Card padding="standard">
              <h2 className="mb-2 text-ui font-semibold text-ink">The proposal</h2>
              <ul className="list-disc space-y-2 pl-4 text-ui text-ink marker:text-ink-ghost">
                {entry.change.map((change) => (
                  <li key={change}>{change}</li>
                ))}
              </ul>
              <h3 className="mt-4 mb-1 text-small font-semibold text-ink">What moves</h3>
              <p className="text-small text-ink-muted">{entry.moves}</p>
            </Card>
          </div>

          <nav aria-label="Other components" className="flex items-center justify-between gap-3">
            {previous ? (
              <Link href={`/preview/overhaul/${previous.id}`} className="press press-area inline-flex items-center gap-1.5 text-ui text-ink-muted hover:text-ink">
                <ArrowLeft className="size-4" strokeWidth={1.75} aria-hidden />
                {previous.name}
              </Link>
            ) : (
              <span />
            )}
            {next && (
              <Link href={`/preview/overhaul/${next.id}`} className="press press-area inline-flex items-center gap-1.5 text-ui text-ink-muted hover:text-ink">
                {next.name}
                <ArrowRight className="size-4" strokeWidth={1.75} aria-hidden />
              </Link>
            )}
          </nav>
        </div>
      </div>
    </div>
  );
}
