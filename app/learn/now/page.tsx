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
import { relatedNotesForCards } from '@/lib/learn/feed/related-notes';
import { READY_LOW } from '@/lib/learn/feed/top-up';
import { loadReadNow, type ReadingDetail } from '@/lib/learn/tracks/load';
import { REVIEWS_IN_LEARN_NOW, type DueReview } from '@/lib/learn/lessons/review';
import { loadDueReviews } from '@/lib/learn/lessons/review-store';
import { loadActiveAims } from '@/lib/learn/aims-store';
import { loadPlannedGoals } from '@/lib/learn/lessons/plan-store';
import { countGoalsWithoutPlan, WAITING_ANCHORS, waitingEmpty, waitingLines } from '@/lib/learn/feed/waiting';
import { wantsPractice } from '@/lib/learn/flow/href';
import { PracticeFlow } from '../flow/practice';
import { loadLearnAreaHref } from '@/lib/goals/learn-area';
import { ReviewList } from '../review/review-list';
import { openReading } from '../r/[id]/actions';
import { LearnNowFeed } from './feed';
import { FinishButton } from './finish-button';
import { PracticeSwitch } from './switch';
import { WaitingStrip } from './waiting-strip';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Now' };

/**
 * The most due ideas read, for the strip's count. The query behind the
 * reviews stops at two hundred as well, so a larger limit would count no
 * more. The list below the strip shows the first few of the same read.
 */
const REVIEWS_COUNTED = 200;

/**
 * Long enough for the page's actions and what they start afterwards. Test me
 * on this writes a track while you wait, and every action may top the feed up
 * inside `after()`, which runs within this same limit (plan #808).
 */
export const maxDuration = 300;

/**
 * Now, Learn's first tab and the one place to start (plan #1486), as the
 * endless feed of docs/LEARN-NOW-SPEC.md (plan #808). It was Learn now, the
 * tab after Home, until Home and Practice Flow were folded into it.
 *
 * At the top, what is waiting for you, as one short strip (Home's list until
 * plan #1486): ideas due for review, readings you said you would read, and
 * goals with no plan yet. Beside the title, the Practice only switch:
 * `?practice=1` shows Practice Flow's questions (`../flow/practice.tsx`) in
 * place of the feed, and an old flow link's `track`, `goal` or `only` turns it
 * on too (`lib/learn/flow/href.ts`). Each learning goal's plan, which Home
 * listed, is on its subject's page.
 *
 * The readings you queued come first, in the order you queued them, as the
 * thin shelf they always were: what it is, why you put it there, Open, and
 * Read it. Nothing on it asks you a question before you can read, and all the
 * rest is on the reading's own page, one click away.
 *
 * Then the cards the app wrote, one at a time (`./feed.tsx`), with the next
 * few already loaded behind the one on screen.
 *
 * Track offers, a new theme or a resting track, are on Tracks rather than
 * here (note 8a1789df): the deck is for reading.
 *
 * Above the deck, the ideas of passed pieces that are due for review (plan
 * #1145), up to five, most overdue first.
 *
 * A card shows up to two of your own notes on its idea (plan #1113). For the
 * first cards the lookup is started here and passed down unawaited, one
 * promise a card, so the deck paints first and the notes stream in under the
 * card's material. Cards loaded later carry theirs.
 */
export default async function NowPage({
  searchParams,
}: {
  searchParams: Promise<{
    practice?: string | string[];
    track?: string | string[];
    goal?: string | string[];
    only?: string | string[];
  }>;
}) {
  const params = await searchParams;
  const practice = wantsPractice(params);
  const user = await requireUser();
  const supabase = await createLearnClient();

  // Each read that feeds the strip fails on its own: a count that cannot be
  // read is null and drops its line, and the lists below fall back to empty.
  const [readings, reviews, goals] = await Promise.all([
    loadReadNow(supabase).then(
      (rows) => rows,
      (): ReadingDetail[] | null => null,
    ),
    loadDueReviews(supabase, user.id, { limit: REVIEWS_COUNTED }).then(
      (rows) => rows,
      (): DueReview[] | null => null,
    ),
    Promise.all([loadActiveAims(supabase), loadPlannedGoals(supabase, user.id)]).then(
      ([aims, planned]) => countGoalsWithoutPlan(aims, planned),
      (): number | null => null,
    ),
  ]);
  const counts = { reviews: reviews?.length ?? null, readings: readings?.length ?? null, goals };
  // Goals without a plan open the Learn area on /goals (plan #1491); read
  // only when that line shows.
  const goalsHref = goals ? await loadLearnAreaHref() : undefined;
  const strip = (
    <WaitingStrip lines={waitingLines(counts, { goalsHref })} empty={waitingEmpty(counts)} />
  );
  const header = (description: string) => (
    <PageHeader title="Now" description={description} actions={<PracticeSwitch practice={practice} />} />
  );

  if (practice) {
    return (
      <div className="mx-auto max-w-3xl">
        {header('Questions about what you are ready for next, for as long as you want to keep going.')}
        {strip}
        <PracticeFlow track={params.track} goal={params.goal} only={params.only} />
      </div>
    );
  }

  const [cards, ready] = await Promise.all([loadFeedPage(supabase, []), countReadyCards(supabase)]);
  // Opening the page counts as a response: when seven or fewer are ready,
  // more are written while you read the first.
  after(() => topUpFeedAfterResponse(user.id));
  const related = relatedNotesForCards(supabase, user.id, cards);
  const firstRelated = Object.fromEntries(
    cards.map((card) => [card.id, related.then((found) => found.get(card.id) ?? [])]),
  );
  const queued = readings ?? [];

  return (
    <div className="mx-auto max-w-3xl">
      {header(
        queued.length === 0
          ? 'One card at a time. Swipe down if you know it, right to work on it, left for later.'
          : 'What you said you would read next, then one card at a time.',
      )}

      {strip}

      {queued.length > 0 && (
        /* One surface with hairlines, not a card per reading. Law 13: the
         * shelf is scanned, so it is a list, and a card each cost every row
         * its own border and eight pixels of margin for nothing. */
        <Card padding="none" id={WAITING_ANCHORS.readings} className="mb-4 scroll-mt-4">
          <h2 className="card-pad-x pt-(--card-p) text-ui font-semibold text-ink">
            You said you would read these
          </h2>
          <ul className="divide-y divide-border">
            {queued.map((reading) => {
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

      <div id={WAITING_ANCHORS.reviews} className="scroll-mt-4">
        <ReviewList
          reviews={(reviews ?? []).slice(0, REVIEWS_IN_LEARN_NOW)}
          title="Due for review"
          description="Ideas from pieces you passed. A right answer brings the next question later; a miss brings it back tomorrow."
          showPlan
        />
      </div>

      <LearnNowFeed first={cards} firstRelated={firstRelated} ready={ready} low={READY_LOW} />
    </div>
  );
}
