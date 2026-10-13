import Link from 'next/link';
import { BadgeCheck, AlertTriangle, ExternalLink, GitBranch } from 'lucide-react';
import { ClipPlayer } from '@/components/learn/clip-player';
import { TabbedDetail } from '@/components/patterns/tabbed-detail';
import { Property, PropertyList } from '@/components/shell/detail-layout';
import { Button } from '@/components/ui/button';
import { PaidHint } from '@/components/ui/paid-hint';
import { youtubeVideoId } from '@/lib/learn/youtube/format';
import { formatMoney } from '@/lib/money';
import { READING_TABS, type ReadingTab } from '@/lib/learn/tracks/reading-tabs';
import { goDeeper, openReading } from './actions';
import { FindSources } from './find-sources';
import { ReadingMenu } from './reading-menu';
import { NoteForm } from './note-form';
import { ReadingSummary, type SummaryFailure } from './reading-summary';
import { NoteToGraph } from './note-to-graph';
import { StatusButtons } from './status-buttons';
import { ReadNowButton } from './read-now-button';
import { cardVariants } from '@/components/ui/card';
import { cn } from '@/lib/cn';

import type { ReadingDetail } from '@/lib/learn/tracks/load';
import type { Subject } from '@/lib/learn/graph/load';
import type { StoryOrigin } from '@/lib/news/saved/stories';

const ACCESS_TEXT: Record<string, string> = {
  open: 'Free to read',
  paywalled: 'Behind a paywall',
  purchase: 'You would have to buy this',
  library: 'Free with a library or institutional login',
  unknown: 'Access not established',
};

/** The same, short enough for the properties. */
const ACCESS_SHORT: Record<string, string> = {
  open: 'Free',
  paywalled: 'Paywalled',
  purchase: 'To buy',
  library: 'Library login',
  unknown: 'Not known',
};

const STATUS_TEXT: Record<string, string> = {
  queued: 'Not started',
  reading: 'Reading',
  read: 'Read',
  abandoned: 'Gave up',
};

export type ReadingViewProps = {
  reading: ReadingDetail;
  /** The subjects a note can be taken to, for the note-to-graph offer. */
  subjects: Subject[];
  /** The same source, read in another reading list, when it was. */
  alreadyRead: { trackTitle: string } | null;
  /** The newsletter a story sent from News came from. */
  origin: StoryOrigin | null;
  /** The open tab, from the address. */
  tab?: ReadingTab;
  /** A failed Summarize press, drawn by the gallery; the page passes none. */
  summaryFailure?: SummaryFailure | null;
};

/**
 * One reading (plan #1602), in the tabbed detail pattern (plan #1876.4): the
 * reading list it is on, its title, the Reading and Summary tabs, and its
 * facts in a column on the right from laptop width.
 */
export function ReadingView({
  reading,
  subjects,
  alreadyRead,
  origin,
  tab = 'reading',
  summaryFailure = null,
}: ReadingViewProps) {
  const byline =
    [reading.source?.author, reading.source?.year ? String(reading.source.year) : null]
      .filter(Boolean)
      .join(' · ') || undefined;

  return (
    <TabbedDetail
      crumbs={[
        { label: 'Learn', href: '/learn' },
        { label: 'Lists', href: '/learn/lists' },
        { label: reading.trackTitle, href: `/learn/t/${reading.trackId}` },
        { label: reading.subject, href: `/learn/r/${reading.id}` },
      ]}
      title={reading.subject}
      description={byline}
      actions={
        <ReadingMenu readingId={reading.id} trackId={reading.trackId} sourceUrl={reading.source?.canonicalUrl ?? null} />
      }
      glance={<ReadingGlance reading={reading} />}
      detailCount={detailCount(reading, origin)}
      properties={<ReadingProperties reading={reading} origin={origin} />}
      tabs={READING_TABS}
      label="Reading"
    >
      {tab === 'summary' ? (
        <ReadingSummary
          readingId={reading.id}
          summary={reading.summary}
          given={reading.givenText}
          failure={summaryFailure}
        />
      ) : (
        <ReadingTabBody reading={reading} subjects={subjects} alreadyRead={alreadyRead} />
      )}
    </TabbedDetail>
  );
}

/** The two facts a phone shows first: where you are with it and whether you can read it. */
function ReadingGlance({ reading }: { reading: ReadingDetail }) {
  return (
    <>
      <Property label="Status" value={STATUS_TEXT[reading.status] ?? reading.status} />
      <Property
        label="Access"
        value={reading.source ? (ACCESS_SHORT[reading.source.access] ?? ACCESS_SHORT.unknown) : 'No source yet'}
      />
    </>
  );
}

function detailCount(reading: ReadingDetail, origin: StoryOrigin | null): number {
  return 2 + (lengthOf(reading) ? 1 : 0) + (origin ? 1 : 0);
}

function lengthOf(reading: ReadingDetail): string | null {
  if (reading.pageFrom && reading.pageTo) return `pp. ${reading.pageFrom}–${reading.pageTo}`;
  if (reading.pageFrom) return `p. ${reading.pageFrom}`;
  if (reading.source?.pageCount) return `${reading.source.pageCount} pages`;
  return null;
}

/** The rest of the facts, under All details on a phone. */
function ReadingProperties({ reading, origin }: { reading: ReadingDetail; origin: StoryOrigin | null }) {
  const length = lengthOf(reading);
  return (
    <PropertyList>
      <Property
        label="Reading list"
        wide
        value={
          <Link href={`/learn/t/${reading.trackId}`} className="hover:underline">
            {reading.trackTitle}
          </Link>
        }
      />
      {length && <Property label="Length" value={length} />}
      <Property label="On Now" value={reading.readNowAt ? 'Yes' : 'No'} />
      {origin && (
        <Property
          label="From"
          wide
          value={
            origin.href ? (
              <Link href={origin.href} className="hover:underline">
                {origin.senderName}
              </Link>
            ) : (
              origin.senderName
            )
          }
        />
      )}
    </PropertyList>
  );
}

/** The Reading tab: why it is here, where to read it, where you are and what you took from it. */
function ReadingTabBody({
  reading,
  subjects,
  alreadyRead,
}: {
  reading: ReadingDetail;
  subjects: Subject[];
  alreadyRead: { trackTitle: string } | null;
}) {
  const verified = reading.locatorConfidence === 'verified';
  const pages =
    reading.pageFrom && reading.pageTo
      ? `pp. ${reading.pageFrom}–${reading.pageTo}`
      : reading.pageFrom
        ? `p. ${reading.pageFrom}`
        : null;
  const where = [reading.locatorLabel, pages].filter(Boolean).join(', ');
  const url = reading.openUrl ?? reading.source?.canonicalUrl ?? null;
  const hasSource = reading.source !== null;
  // A YouTube reading plays here, cut to its clip when it was queued from one.
  // The Open button below stays, for the video on YouTube itself.
  const videoId = youtubeVideoId(url) ?? youtubeVideoId(reading.source?.canonicalUrl);

  return (
    <>
      {reading.why && (
        <section className={cn(cardVariants({ padding: 'dense' }), 'mb-5')}>
          <h2 className="mb-1 text-ui font-semibold text-ink-muted">Why it is here</h2>
          <p className="text-body text-ink">{reading.why}</p>
        </section>
      )}

      {videoId && (
        <ClipPlayer
          videoId={videoId}
          title={reading.subject}
          start={reading.tStartSeconds}
          end={reading.tEndSeconds}
          className="mb-5"
        />
      )}

      {!hasSource ? (
        // Something you wrote down. There is nothing to open, and saying so is
        // the honest thing -- an empty "Where to read" box would read as a
        // failure rather than as a step you have not taken.
        <section className={cn(cardVariants({ padding: 'dense' }), 'mb-5 border-dashed')}>
          <h2 className="mb-2 text-ui font-semibold text-ink-muted">No source yet</h2>
          {/* The row's own basis rather than a fixed sentence: a subject can
              get here by being typed or by being proposed for a topic. */}
          <p className="mb-4 text-body text-ink-muted">{reading.locatorBasis}</p>
          <FindSources readingId={reading.id} />
        </section>
      ) : (
        <section className={cn(cardVariants({ padding: 'dense' }), 'mb-5')}>
          <h2 className="mb-2 text-ui font-semibold text-ink-muted">Where to read</h2>

          <p className="flex items-start gap-2 text-body text-ink">
            {verified ? (
              <BadgeCheck className="mt-0.5 size-4 shrink-0 text-ink-muted" strokeWidth={2} aria-hidden />
            ) : (
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-caution" strokeWidth={2} aria-hidden />
            )}
            <span>{where || 'The whole thing'}</span>
          </p>

          {/* The basis, in full and in words: "found verbatim in the fetched
              page" and "widely cited as this chapter, unconfirmed" are
              different claims, and a reader who can see which one they have
              loses a minute rather than twenty. */}
          <p className="mt-1.5 pl-6 text-ui text-ink-muted">{reading.locatorBasis}</p>

          <p className="mt-3 pl-6 text-ui text-ink-muted">
            {ACCESS_TEXT[reading.source!.access] ?? ACCESS_TEXT.unknown}
            {reading.source!.priceCents !== null && ` — ${formatMoney(reading.source!.priceCents)}`}
            {reading.source!.pageCount ? ` · ${reading.source!.pageCount} pages` : ''}
          </p>

          {alreadyRead && (
            <p className="mt-3 pl-6 text-ui text-ink-muted">
              You read this one in <span className="text-ink">{alreadyRead.trackTitle}</span>.
            </p>
          )}

          <div className="mt-4 pl-6">
            {url ? (
              <form action={openReading} className="flex flex-wrap items-center gap-1">
                <input type="hidden" name="readingId" value={reading.id} />
                <Button type="submit" variant="primary" size="md">
                  <ExternalLink className="size-4" strokeWidth={2} aria-hidden />
                  Open
                </Button>
                <PaidHint action="app/learn/r/[id]/actions.ts#openReading" what="Cost of finding the passage" />
                {!verified && (
                  <span className="ml-2 text-small text-ink-muted">Finds the passage on the way, the first time.</span>
                )}
              </form>
            ) : (
              // No link is a real outcome, not a bug: a book with no free
              // edition still belongs in a queue.
              <p className="text-ui text-ink-muted">
                No link — nothing free or legitimate was found. The location above is still where to look once you
                have a copy.
              </p>
            )}
          </div>
        </section>
      )}

      {/* Where you are, then the two next steps side by side. "On Now" puts
          it on Now, where it comes first until it is finished; "Go deeper on
          this" opens it as a reading list of its own. */}
      <section className="mb-5">
        <h2 className="mb-2 text-ui font-semibold text-ink-muted">Where you are</h2>
        <StatusButtons readingId={reading.id} status={reading.status} />
        <div className="mt-2 flex flex-wrap items-start gap-2">
          <ReadNowButton readingId={reading.id} on={reading.readNowAt !== null} />
          <form action={goDeeper}>
            <input type="hidden" name="readingId" value={reading.id} />
            <Button type="submit" variant="secondary" size="md">
              <GitBranch className="size-4" strokeWidth={2} aria-hidden />
              Go deeper on this
            </Button>
          </form>
        </div>
      </section>

      <section>
        <h2 className="mb-2 text-ui font-semibold text-ink-muted">What you took from it</h2>
        <div className={cn(cardVariants({ padding: 'dense' }), 'border-l-2 border-l-accent')}>
          <NoteForm readingId={reading.id} note={reading.note} />
        </div>

        {/* The note is written anyway, so this asks nothing new of you: it is
            where a reading gets to change what the graph thinks you know. */}
        {reading.note?.trim() && <NoteToGraph readingId={reading.id} subjects={subjects} />}
      </section>
    </>
  );
}
