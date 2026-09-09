import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { PageHeader } from '@/components/shell/page-header';
import { ReadingCard } from '@/components/learn/reading-card';
import { createLearnClient } from '@/lib/learn/auth/server';
import { loadTrack } from '@/lib/learn/tracks/load';
import { cardVariants } from '@/components/ui/card';
import { cn } from '@/lib/cn';
import { AddForm } from './add-form';
import { PlanForm } from './plan-form';
import { ConfirmStep } from '@/components/ui/confirm-step';
import { removeTrack } from './actions';

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

  const { progress } = track;
  const remaining = progress.remaining;

  return (
    <>
      <p className="mb-3">
        <Link
          href="/learn"
          className="inline-flex items-center gap-1 text-ui text-ink-muted hover:text-ink"
        >
          <ArrowLeft className="size-3.5" strokeWidth={2} aria-hidden />
          Tracks
        </Link>
      </p>

      <PageHeader
        actions={
          <ConfirmStep
            action={removeTrack}
            fields={{ trackId: track.id }}
            prompt={
              track.readings.length === 0
                ? 'Deletes this track. Nothing else goes with it.'
                : `Deletes this track and its ${track.readings.length} ${
                    track.readings.length === 1 ? 'item' : 'items'
                  }. The sources stay, since other tracks may use them.`
            }
            confirmLabel="Yes, delete it"
            pendingLabel="Deleting…"
          >
            Delete track
          </ConfirmStep>
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
        <ul className={cn(cardVariants(), 'divide-y divide-border overflow-hidden')}>
          {track.readings.map((reading) => (
            <ReadingCard key={reading.id} reading={reading} />
          ))}
        </ul>
      )}

      <AddForm trackId={track.id} />
    </>
  );
}
