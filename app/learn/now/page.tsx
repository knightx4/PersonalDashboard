import Link from 'next/link';
import { BookOpenCheck, ExternalLink } from 'lucide-react';
import { PageHeader } from '@/components/shell/page-header';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { createLearnClient } from '@/lib/learn/auth/server';
import { loadReadNow } from '@/lib/learn/tracks/load';
import { openReading } from '../r/[id]/actions';
import { FinishButton } from './finish-button';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Read now' };

/**
 * The shelf you actually read from.
 *
 * A track is a curriculum: ordered, reasoned, read over weeks. That is the
 * right shape for deciding what to read and the wrong one for the twenty
 * minutes in which you read it, where the question is not "what is the fourth
 * step of my Marx track" but "what did I say I would read next".
 *
 * So this page is deliberately thin. One line saying what it is, one line
 * saying why you put it there, Open, and Read. No status row, no locator
 * basis, no access notes, no note field -- all of that is on the reading's own
 * page, one click away, and none of it is the reason you opened this tab. The
 * whole point is that nothing here asks you a question before you can read.
 */
export default async function ReadNowPage() {
  const supabase = await createLearnClient();
  const readings = await loadReadNow(supabase);

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Read now"
        description={
          readings.length === 0
            ? 'What you said you would read next.'
            : 'What you said you would read next, in the order you said it.'
        }
      />

      {readings.length === 0 ? (
        <EmptyState
          icon={BookOpenCheck}
          title="Nothing on the shelf"
          description="Open anything in a track and press Read now, and it will be waiting here."
          action={{ label: 'Your reading lists', href: '/learn/lists' }}
          className="mt-6"
        />
      ) : (
        /* One surface with hairlines, not a card per reading. Law 13: the
         * shelf is scrolled, so it is a list, and a card each cost every row
         * its own border and eight pixels of margin for nothing. */
        <Card padding="none" className="mt-6">
          <ul className="divide-y divide-border">
            {readings.map((reading) => {
              const url = reading.openUrl ?? reading.source?.canonicalUrl ?? null;

              return (
                <li key={reading.id} className="card-pad-x row-pad">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                    <h2 className="text-body font-medium text-ink">{reading.subject}</h2>
                    <Link
                      href={`/learn/t/${reading.trackId}`}
                      className="text-small text-ink-muted underline underline-offset-2 hover:text-ink"
                    >
                      {reading.trackTitle}
                    </Link>
                  </div>

                  {/* The one line that makes an ordered list a curriculum, and
                      the only thing worth reading before the thing itself. */}
                  {reading.why && <p className="mt-1 text-ui text-ink-muted">{reading.why}</p>}

                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    {url ? (
                      <form action={openReading}>
                        <input type="hidden" name="readingId" value={reading.id} />
                        <Button type="submit" variant="primary" size="sm">
                          <ExternalLink className="size-3.5" strokeWidth={2} aria-hidden />
                          Open
                        </Button>
                      </form>
                    ) : (
                      <Link
                        href={`/learn/r/${reading.id}`}
                        className="text-ui text-ink-muted underline underline-offset-2 hover:text-ink"
                      >
                        No source yet — find one
                      </Link>
                    )}

                    {/* Finishing is the one write this page needs, and it is
                        also what takes the row off the shelf. */}
                    <FinishButton readingId={reading.id} />

                    <Link
                      href={`/learn/r/${reading.id}`}
                      className="ml-auto text-small text-ink-muted underline underline-offset-2 hover:text-ink"
                    >
                      Everything about it
                    </Link>
                  </div>
                </li>
              );
            })}
          </ul>
        </Card>
      )}
    </div>
  );
}
