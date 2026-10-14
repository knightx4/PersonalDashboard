import Link, { linkVariants } from '@/components/ui/link';
import { notFound } from 'next/navigation';
import { PageHeader } from '@/components/shell/page-header';
import { ReadingCard } from '@/components/learn/reading-card';
import { createLearnClient } from '@/lib/learn/auth/server';
import { loadTrack, loadTracks } from '@/lib/learn/tracks/load';
import { loadReadingOrigins } from '@/lib/learn/tracks/news-origin';
import { loadBriefForTrack } from '@/lib/learn/briefs/load';
import { rollUpAll } from '@/lib/learn/tracks/tree';
import { cardVariants } from '@/components/ui/card';
import { cn } from '@/lib/cn';
import { AimButton } from '@/components/shell/aim-button';
import { PlanForm } from './plan-form';
import { ConfirmStep } from '@/components/ui/confirm-step';
import { removeTrack } from './actions';
import { PageColumn } from '@/components/shell/page-width';
import { rowSubject } from '@/lib/core/subject';
import { toRef } from '@/lib/core/refs';

export const dynamic = 'force-dynamic';

/**
 * One track: the question at the top, then the readings in order.
 *
 * The question leads rather than the title because it is the thing that makes
 * the list make sense. "Value and price" is a label; "price is supposed to
 * quantify value but it only reports an equilibrium, and the equilibrium is
 * relative to how much money you started with" is why these five things are
 * here and in this order.
 */
export default async function TrackPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const supabase = await createLearnClient();
  const track = await loadTrack(supabase, id);
  if (!track) notFound();

  // The header counts the branches too, so it says the same thing the Learn
  // list says about this row. A track with nothing under it rolls up to its
  // own readings and reads exactly as it did.
  const progress = rollUpAll(await loadTracks(supabase)).get(track.id) ?? track.progress;
  const remaining = progress.remaining;

  // Which newsletter each story sent from News was in (plan #1368),
  // and the research brief that made this list, when one did (plan #2023.4).
  const [origins, brief] = await Promise.all([
    loadReadingOrigins(
      track.readings.flatMap((reading) => (reading.newsStoryId ? [reading.newsStoryId] : [])),
    ),
    loadBriefForTrack(supabase, track.id),
  ]);

  return (
    <PageColumn>
      <PageHeader
        subject={await rowSubject(toRef('learn.tracks', id))}
        // A track that came out of another one goes back to it rather than
        // to the list: you got here from economics, and that is where you
        // are going next.
        back={
          track.branchedFrom
            ? {
                label: track.branchedFromTitle ?? 'The topic this came from',
                href: `/learn/t/${track.branchedFrom}`,
              }
            : undefined
        }
        actions={
          <>
            <AimButton
              aim={{ kind: 'track-reading', under: { id: track.id, title: track.title } }}
              label="Add something to read"
              variant="secondary"
            />
            <ConfirmStep
            action={removeTrack}
            fields={{ trackId: track.id }}
            prompt={
              track.readings.length === 0
                ? 'Deletes this reading list. Nothing else goes with it.'
                : `Deletes this reading list and its ${track.readings.length} ${
                    track.readings.length === 1 ? 'item' : 'items'
                  }. The sources stay, since other reading lists may use them.`
            }
            confirmLabel="Yes, delete it"
            pendingLabel="Deleting…"
          >
            Delete reading list
            </ConfirmStep>
          </>
        }
        title={track.title}
        description={
          remaining === 0
            ? `Nothing left. ${progress.read} read.`
            : `${remaining} to go · ${progress.read} read${
                progress.abandoned > 0 ? ` · ${progress.abandoned} given up` : ''
              }`
        }
      />

      {brief && (
        <p className="mb-3 text-ui text-ink-muted">
          Sources Dash found researching{' '}
          <Link href={`/learn/b/${brief.id}`} className={linkVariants()}>
            {brief.question}
          </Link>
        </p>
      )}

      {track.question && (
        <p className="mb-5 border-l-2 border-accent pl-3 text-body text-ink-muted">
          {track.question}
        </p>
      )}

      {track.readings.length === 0 ? (
        /* An empty track used to be a dead end: you named a topic and the
           module had nothing to say about it. PlanForm is the way out. */
        <PlanForm trackId={track.id} />
      ) : (
        <>
          {/* Only when the subject graph set the order (plan #1394). A list
              of things you wrote down yourself keeps the order you added
              them and says nothing about it. */}
          {track.taughtInOrder && (
            <p className="mb-2 text-ui text-ink-muted">
              In teaching order: anything a reading builds on is above it.
            </p>
          )}
          <ul className={cn(cardVariants(), 'divide-y divide-border overflow-hidden')}>
            {track.readings.map((reading) => (
              <ReadingCard
                key={reading.id}
                reading={reading}
                from={reading.newsStoryId ? origins.get(reading.newsStoryId)?.senderName : null}
              />
            ))}
          </ul>
        </>
      )}

    </PageColumn>
  );
}
