import Link, { linkVariants } from '@/components/ui/link';
import { z } from 'zod';
import { DashAction } from '@/components/ui/dash-action';
import { Card } from '@/components/ui/card';
import { requireUser } from '@/lib/auth/server';
import { createLearnClient } from '@/lib/learn/auth/server';
import { countReadyCards, loadFeedPage } from '@/lib/learn/feed/load';
import { relatedNotesForCards } from '@/lib/learn/feed/related-notes';
import { loadReadNow, type ReadingDetail } from '@/lib/learn/tracks/load';
import { REVIEWS_IN_LEARN_NOW, type DueReview } from '@/lib/learn/lessons/review';
import { loadDueReviews } from '@/lib/learn/lessons/review-store';
import { readWaiting, WAITING_ANCHORS, waitingEmpty, waitingLines } from '@/lib/learn/feed/waiting';
import { firstParam, wantsPractice } from '@/lib/learn/flow/href';
import { loadSubject } from '@/lib/learn/graph/load';
import { loadPreparingSubjects, preparedActiveSubjectIds, type PreparingSubject } from '@/lib/learn/prepare/store';
import { preparationLine, preparationView } from '@/lib/learn/prepare/view';
import { loadWorkspaceInbox } from '@/lib/inbox/workspace-inbox';
import { PracticeFlow } from '../flow/practice';
import { ReviewList } from '../review/review-list';
import { openReading } from '../r/[id]/actions';
import { LearnNowFeed } from './feed';
import { FinishButton } from './finish-button';
import { NowHeader } from './header';
import { NowView } from './now-view';
import { WaitingStrip } from './waiting-strip';
import { BriefsList } from './briefs-list';
import { PieceFirst } from './todays-piece';
import { loadTodaysPiece, type TodaysPiece } from '@/lib/learn/lessons/todays-piece-store';
import { loadOpenBriefs } from '@/lib/learn/briefs/load';
import type { BriefSummary } from '@/lib/learn/briefs/view';
import { cn } from '@/lib/cn';
import { createCoreClient } from '@/lib/core/auth/server';
import { openedFromPush } from '@/lib/day-brief/opens';
import { PageColumn } from '@/components/shell/page-width';
import { NowDashToday } from '@/components/shell/dash-today-fold';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Now' };

/**
 * The most due ideas read, for the waiting count. The query behind the
 * reviews stops at two hundred as well, so a larger limit would count no
 * more. The list under the practice press shows the first few of the same read.
 */
const REVIEWS_COUNTED = 200;

/**
 * Long enough for the page's actions. Test me on this writes a track while
 * you wait, and the piece's thread marks an answer with a model call.
 */
export const maxDuration = 300;

/** Logs a read that failed and gives the page its fallback, so one failed read never fails Now. */
function orElse<T>(what: string, fallback: T) {
  return (error: unknown): T => {
    console.error(`[learn] now: ${what}`, error instanceof Error ? error.message : error);
    return fallback;
  };
}

/** A count already read, for `readWaiting`: null (a read that failed) leaves the count unread. */
function counted(rows: readonly unknown[] | null): () => Promise<number> {
  return async () => {
    if (rows === null) throw new Error('not read');
    return rows.length;
  };
}

/**
 * Now, Learn's first tab and the one place to start (plan #1486). Since plan
 * #2313.1 it opens on today's piece from a prepared subject and the press to
 * practise across your prepared subjects (`./now-view.tsx`), with nothing to
 * swipe. Beside them, as the page's rail: what is waiting for you (the inbox,
 * ideas due for review, readings you said you would read, and the cards
 * written before), and the subjects still being prepared with the step each
 * run is on. Under the practice press, the topics Dash researched for you,
 * the readings you queued and the ideas due for review.
 *
 * Three other views share the address:
 *
 * - `?practice=1` shows Practice Flow's questions (`../flow/practice.tsx`),
 *   and an old flow link's `goal` or `only` turns it on too
 *   (`lib/learn/flow/href.ts`).
 * - `?cards=1` is Cards: the cards written before, one at a time
 *   (`./feed.tsx`), until none are left. No more are written. A morning
 *   notification that names a card (`?card=`, plan #2164.7) opens here on it.
 * - `?track=<subject>` without the switch is one subject's cards (plan
 *   #1698), opened from the subject's page, with a link back to it.
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
    cards?: string | string[];
    track?: string | string[];
    goal?: string | string[];
    only?: string | string[];
    card?: string | string[];
    brief?: string | string[];
    from?: string | string[];
    piece?: string | string[];
    cell?: string | string[];
    run?: string | string[];
    end?: string | string[];
    after?: string | string[];
    placement?: string | string[];
    skip?: string | string[];
  }>;
}) {
  const params = await searchParams;
  const practice = wantsPractice(params);
  const user = await requireUser();
  const supabase = await createLearnClient();
  // The subject both sides of the switch keep. An id that is not a subject of
  // yours, or cannot be read, opens Now as it is without one.
  const track = z.string().uuid().safeParse(firstParam(params.track));
  const subject = track.success ? await loadSubject(supabase, track.data).catch(() => null) : null;
  const header = (description?: string) => (
    <NowHeader description={description} practice={practice} subject={subject} />
  );

  // The morning notification opens on its first card (plan #2164.7); the
  // press also counts as the brief opened, as it does on Home (plan #1242).
  const pinned = z.string().uuid().safeParse(firstParam(params.card));
  const pushDay = openedFromPush(params, '');
  if (pushDay) await createCoreClient().then((core) => core.rpc('open_day_brief', { p_day: pushDay })).catch(() => null);

  if (!practice && (subject || pinned.success || firstParam(params.cards) === '1')) {
    const cards = await loadFeedPage(supabase, [], {
      subjectId: subject?.id ?? null,
      cardId: pinned.success ? pinned.data : null,
    });
    const related = relatedNotesForCards(supabase, user.id, cards);
    return (
      <PageColumn>
        {subject ? (
          header()
        ) : (
          <NowHeader
            cards
            practice={false}
            description="Written before Now led with today’s piece. No new ones are written, so these end when you are through them."
          />
        )}
        <LearnNowFeed
          first={cards}
          firstRelated={Object.fromEntries(
            cards.map((card) => [card.id, related.then((found) => found.get(card.id) ?? [])]),
          )}
          subjectId={subject?.id ?? null}
        />
      </PageColumn>
    );
  }

  // Each read that feeds the waiting list fails on its own: a count that
  // cannot be read is null and drops its line, and the lists below fall back
  // to empty.
  const [readings, reviews] = await Promise.all([
    loadReadNow(supabase).catch(orElse<ReadingDetail[] | null>('readings', null)),
    loadDueReviews(supabase, user.id, { limit: REVIEWS_COUNTED }).catch(orElse<DueReview[] | null>('reviews', null)),
  ]);
  const counts = await readWaiting({
    inbox: () => loadWorkspaceInbox(user.id, 'learn').then((inbox) => inbox.rows.length),
    reviews: counted(reviews),
    readings: counted(readings),
    cards: () => countReadyCards(supabase),
  });
  const lines = waitingLines(counts);
  const empty = waitingEmpty(counts);

  if (practice) {
    return (
      <PageColumn>
        {header('Questions about what you are ready for next, for as long as you want to keep going.')}
        <WaitingStrip lines={lines} empty={empty} />
        <PracticeFlow
          track={params.track}
          goal={params.goal}
          only={params.only}
          cell={params.cell}
          run={params.run}
          end={params.end}
          after={params.after}
          placement={params.placement}
          skip={params.skip}
        />
      </PageColumn>
    );
  }

  // Today's piece leads (plan #2164.4), or the piece `?piece=` names. A piece
  // that cannot be read leaves the practice press first.
  const pinnedPiece = z.string().uuid().safeParse(firstParam(params.piece));
  const [briefs, piece, prepared, preparing] = await Promise.all([
    // The topics Dash researched for you (plan #2023.4).
    loadOpenBriefs(supabase).catch(orElse<BriefSummary[]>('briefs', [])),
    createCoreClient()
      .then((core) => loadTodaysPiece(supabase, user.id, pinnedPiece.success ? pinnedPiece.data : null, core))
      .catch(orElse<TodaysPiece | null>('today’s piece', null)),
    preparedActiveSubjectIds(supabase, user.id).catch(orElse('prepared subjects', new Set<string>())),
    loadPreparingSubjects(supabase, user.id).catch(orElse<PreparingSubject[]>('preparing subjects', [])),
  ]);
  const queued = readings ?? [];

  return (
    <NowView
      header={header()}
      today={<PieceFirst piece={piece} />}
      hasPiece={piece !== null}
      prepared={prepared.size}
      preparing={preparing.map((row) => ({
        subjectId: row.subjectId,
        name: row.name,
        line: preparationLine(preparationView(row)),
      }))}
      waiting={lines}
      waitingEmpty={empty}
      dashToday={<NowDashToday workspace="learn" className="" />}
    >
      <BriefsList briefs={briefs} />

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
                      className={cn('text-small', linkVariants({ tone: 'quiet' }))}
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
                        <DashAction
                          type="submit"
                          variant="primary"
                          size="sm"
                          paid="app/learn/r/[id]/actions.ts#openReading"
                          what="Cost of finding the passage"
                        >
                          Open at the passage
                        </DashAction>
                      </form>
                    ) : (
                      <Link
                        href={`/learn/r/${reading.id}`}
                        className={cn('text-ui', linkVariants({ tone: 'quiet' }))}
                      >
                        No source yet — find one
                      </Link>
                    )}

                    {/* Finishing is the one write this shelf needs, and it is
                        also what takes the row off it. */}
                    <FinishButton
                      readingId={reading.id}
                      subject={reading.subject}
                      list={reading.trackTitle}
                    />

                    <Link
                      href={`/learn/r/${reading.id}`}
                      className={cn('ml-auto text-small', linkVariants({ tone: 'quiet' }))}
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
          remember="learn.fold.reviews"
          description="Ideas you answered questions on or said you know. A right answer brings the next question later; a miss brings it back tomorrow."
          showPlan
        />
      </div>
    </NowView>
  );
}
