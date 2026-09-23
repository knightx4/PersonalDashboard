import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, BadgeCheck, AlertTriangle, ExternalLink, GitBranch } from 'lucide-react';
import { PageHeader } from '@/components/shell/page-header';
import { Button, buttonVariants } from '@/components/ui/button';
import { createLearnClient } from '@/lib/learn/auth/server';
import { loadOtherReadingsOfSource, loadReading } from '@/lib/learn/tracks/load';
import { formatMoney } from '@/lib/money';
import { goDeeper, openReading } from './actions';
import { FindSources } from './find-sources';
import { ConfirmStep } from '@/components/ui/confirm-step';
import { removeFromTrack } from '../../t/[id]/actions';
import { NoteForm } from './note-form';
import { NoteToGraph } from './note-to-graph';
import { loadSubjects } from '@/lib/learn/graph/load';
import { StatusButtons } from './status-buttons';
import { ReadNowButton } from './read-now-button';
import { cardVariants } from '@/components/ui/card';
import { cn } from '@/lib/cn';

export const dynamic = 'force-dynamic';

const ACCESS_TEXT: Record<string, string> = {
  open: 'Free to read',
  paywalled: 'Behind a paywall',
  purchase: 'You would have to buy this',
  library: 'Free with a library or institutional login',
  unknown: 'Access not established',
};

export default async function ReadingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const supabase = await createLearnClient();
  const reading = await loadReading(supabase, id);
  // For the note-to-graph offer below. A subject is the container that
  // accumulates and nothing creates one silently, so this is a list to pick
  // from rather than a name to invent.
  const subjects = await loadSubjects(supabase);
  if (!reading) notFound();

  // Only meaningful when there is a source to have read somewhere else.
  const elsewhere = reading.source
    ? await loadOtherReadingsOfSource(supabase, reading.source.id, reading.id)
    : [];
  const alreadyRead = elsewhere.find((row) => row.status === 'read');

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

  return (
    <>
      <p className="mb-3">
        <Link
          href={`/learn/t/${reading.trackId}`}
          className="inline-flex items-center gap-1 text-ui text-ink-muted hover:text-ink"
        >
          <ArrowLeft className="size-3.5" strokeWidth={2} aria-hidden />
          {reading.trackTitle}
        </Link>
      </p>

      <PageHeader
        title={reading.subject}
        description={
          [reading.source?.author, reading.source?.year ? String(reading.source.year) : null]
            .filter(Boolean)
            .join(' · ') || undefined
        }
      />

      {reading.why && <p className="mb-5 text-body text-ink">{reading.why}</p>}

      {!hasSource ? (
        // Something you wrote down. There is nothing to open, and saying so is
        // the honest thing -- an empty "Where to read" box would read as a
        // failure rather than as a step you have not taken.
        <section className={cn(cardVariants({ padding: 'dense' }), 'mb-5 border-dashed')}>
          <h2 className="mb-2 text-ui font-semibold text-ink-muted">No source yet</h2>
          {/* The row's own basis rather than a fixed sentence: a subject can
              get here by being typed or by being proposed for a topic, and
              telling you the wrong one of those is the small dishonesty this
              module is built to avoid. */}
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
            <AlertTriangle
              className="mt-0.5 size-4 shrink-0 text-caution"
              strokeWidth={2}
              aria-hidden
            />
          )}
          <span>{where || 'The whole thing'}</span>
        </p>

        {/*
          The basis, in full and in words. This is the module's promise made
          visible: "found verbatim in the fetched page" and "widely cited as
          this chapter, unconfirmed" are different claims, and a reader who can
          see which one they have loses a minute rather than twenty.
        */}
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
            <form action={openReading}>
              <input type="hidden" name="readingId" value={reading.id} />
              <Button type="submit" variant="primary" size="md">
                <ExternalLink className="size-4" strokeWidth={2} aria-hidden />
                Open
              </Button>
              {!verified && (
                <span className="ml-3 text-small text-ink-muted">
                  Finds the passage on the way, the first time.
                </span>
              )}
            </form>
          ) : (
            // No link is a real outcome, not a bug: a book with no free
            // edition still belongs in a queue, and saying so beats sending
            // somebody to a summary site.
            <p className="text-ui text-ink-muted">
              No link — nothing free or legitimate was found. The location above is still where to
              look once you have a copy.
            </p>
          )}
        </div>
      </section>
      )}

      <section className="mb-5">
        <h2 className="mb-2 text-ui font-semibold text-ink-muted">Where you are</h2>
        <StatusButtons readingId={reading.id} status={reading.status} />
      </section>

      {/* Separate from the status row above: where you are with a reading and
          whether you mean to read it next are different facts, and the pair
          that happens most is "reading" and "next". */}
      <section className="mb-5">
        <h2 className="mb-2 text-ui font-semibold text-ink-muted">Read next</h2>
        <ReadNowButton readingId={reading.id} on={reading.readNowAt !== null} />
        <p className="mt-1.5 text-small text-ink-muted">
          Puts it on <Link href="/learn/now" className="underline underline-offset-2 hover:text-ink">Learn now</Link>
          , where it comes first. Finishing it takes it off again.
        </p>
      </section>

      {/* The other direction from Find sources, which finds more to read about
          this subject as it stands. This breaks the subject into parts. */}
      <section className="mb-5">
        <h2 className="mb-2 text-ui font-semibold text-ink-muted">Go deeper</h2>
        <form action={goDeeper}>
          <input type="hidden" name="readingId" value={reading.id} />
          <Button type="submit" variant="secondary" size="md">
            <GitBranch className="size-4" strokeWidth={2} aria-hidden />
            Go deeper on this
          </Button>
        </form>
        <p className="mt-1.5 text-small text-ink-muted">
          Opens this up as a reading list of its own, planned when you get there. This step stays
          where it is.
        </p>
      </section>

      <section>
        <h2 className="mb-2 text-ui font-semibold text-ink-muted">What you took from it</h2>
        <NoteForm readingId={reading.id} note={reading.note} />

        {/* The note is written anyway, so this asks nothing new of you: it is
            where a reading gets to change what the graph thinks you know. */}
        {reading.note?.trim() && <NoteToGraph readingId={reading.id} subjects={subjects} />}
      </section>

      {/*
        Removal, not "abandoned". Giving up on something is a fact worth
        keeping -- it says you looked and decided against it. This is for the
        rows that should never have been here: a search that attached the wrong
        book, a line the parser invented out of a sentence.
      */}
      <section className="mt-8 border-t border-border pt-4">
        <ConfirmStep
          action={removeFromTrack}
          fields={{ readingId: reading.id, trackId: reading.trackId }}
          prompt="Removes this from the reading list for good. To keep it but stop working on it, mark it as gave up instead."
          confirmLabel="Yes, remove it"
          pendingLabel="Removing…"
          align="start"
        >
          Remove from this reading list
        </ConfirmStep>
      </section>

      {reading.source?.canonicalUrl && (
        <p className="mt-6 text-small text-ink-muted">
          <a
            href={reading.source.canonicalUrl}
            target="_blank"
            rel="noopener noreferrer"
            className={buttonVariants({ variant: 'ghost', size: 'sm' })}
          >
            Open the source itself, unnarrowed
          </a>
        </p>
      )}
    </>
  );
}
