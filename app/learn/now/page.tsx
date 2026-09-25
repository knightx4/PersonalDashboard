import Link from 'next/link';
import { after } from 'next/server';
import { ExternalLink } from 'lucide-react';
import { PageHeader } from '@/components/shell/page-header';
import { Button } from '@/components/ui/button';
import { PaidHint } from '@/components/ui/paid-hint';
import { Card } from '@/components/ui/card';
import { topUpFeedAfterResponse } from '@/inngest/learn/feed-top-up';
import { requireUser } from '@/lib/auth/server';
import { createLearnClient } from '@/lib/learn/auth/server';
import { countReadyCards, loadFeedPage } from '@/lib/learn/feed/load';
import { chooseTrackOffer } from '@/lib/learn/flow/offer';
import { READY_LOW } from '@/lib/learn/feed/top-up';
import { loadReadNow } from '@/lib/learn/tracks/load';
import { createVaultClient } from '@/lib/vault/auth/server';
import { openReading } from '../r/[id]/actions';
import { LearnNowFeed } from './feed';
import { FinishButton } from './finish-button';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Learn now' };

/**
 * Long enough for the page's actions and what they start afterwards. Test me
 * on this writes a track while you wait, and every action may top the feed up
 * inside `after()`, which runs within this same limit (plan #808).
 */
export const maxDuration = 300;

/**
 * Learn now, the first tab and what opening Learn lands on (plan #805), as the
 * endless feed of docs/LEARN-NOW-SPEC.md (plan #808).
 *
 * The readings you queued come first, in the order you queued them, as the
 * thin shelf they always were: what it is, why you put it there, Open, and
 * Read it. Nothing on it asks you a question before you can read, and all the
 * rest is on the reading's own page, one click away.
 *
 * Then the cards the app wrote, one at a time (`./feed.tsx`), with the next
 * few already loaded behind the one on screen.
 *
 * One card a visit may be a track offer: the strongest theme in your notes
 * with no track, chosen as Practice Flow chooses it (plan #968). It is read
 * afresh on each visit and nothing records that it was shown, so the one in
 * the deck is always the one a press in either place left next.
 */
export default async function LearnNowPage() {
  const user = await requireUser();
  const supabase = await createLearnClient();
  const [readings, cards, ready, offer] = await Promise.all([
    loadReadNow(supabase),
    loadFeedPage(supabase, []),
    countReadyCards(supabase),
    // An offer that could not be worked out is an offer not made.
    createVaultClient()
      .then((vault) => chooseTrackOffer(supabase, vault))
      .catch((error: unknown) => {
        console.error('[learn now] track offer', error instanceof Error ? error.message : error);
        return null;
      }),
  ]);
  // Opening the page counts as a response: when seven or fewer are ready,
  // more are written while you read the first.
  after(() => topUpFeedAfterResponse(user.id));

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Learn now"
        description={
          readings.length === 0
            ? 'One card at a time. Swipe down if you know it, right to work on it, left for later.'
            : 'What you said you would read next, then one card at a time.'
        }
      />

      {readings.length > 0 && (
        /* One surface with hairlines, not a card per reading. Law 13: the
         * shelf is scanned, so it is a list, and a card each cost every row
         * its own border and eight pixels of margin for nothing. */
        <Card padding="none" className="mb-4">
          <h2 className="card-pad-x pt-(--card-p) text-ui font-semibold text-ink">
            You said you would read these
          </h2>
          <ul className="divide-y divide-border">
            {readings.map((reading) => {
              const url = reading.openUrl ?? reading.source?.canonicalUrl ?? null;

              return (
                <li key={reading.id} className="card-pad-x row-pad">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                    <h3 className="text-body font-medium text-ink">{reading.subject}</h3>
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
                      <form action={openReading} className="flex flex-wrap items-center gap-1">
                        <input type="hidden" name="readingId" value={reading.id} />
                        <Button type="submit" variant="primary" size="sm">
                          <ExternalLink className="size-3.5" strokeWidth={2} aria-hidden />
                          Open
                        </Button>
                        <PaidHint
                          action="app/learn/r/[id]/actions.ts#openReading"
                          what="Cost of finding the passage"
                        />
                      </form>
                    ) : (
                      <Link
                        href={`/learn/r/${reading.id}`}
                        className="text-ui text-ink-muted underline underline-offset-2 hover:text-ink"
                      >
                        No source yet — find one
                      </Link>
                    )}

                    {/* Finishing is the one write this shelf needs, and it is
                        also what takes the row off it. */}
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

      <LearnNowFeed first={cards} ready={ready} low={READY_LOW} offer={offer} />
    </div>
  );
}
