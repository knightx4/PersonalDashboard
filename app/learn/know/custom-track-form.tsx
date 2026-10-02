'use client';

import Link from 'next/link';
import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { Plus } from 'lucide-react';
import { AddTrigger } from '@/components/ui/add-trigger';
import { Button, buttonVariants } from '@/components/ui/button';
import { PaidHint } from '@/components/ui/paid-hint';
import { ComposeBody, ComposeBox, ComposeTitle } from '@/components/ui/field';
import { createCustomTrack, type CustomTrackState } from './actions';

function MakeButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" variant="primary" pending={pending}>
      <Plus className="size-4" strokeWidth={2} aria-hidden />
      {pending ? 'Writing the curriculum…' : 'Make the track'}
    </Button>
  );
}

/**
 * Make a track by name (LEARN-GRAPH-SPEC, "The curriculum"). The curriculum
 * is written as it is made, from your own units when you give them, and you
 * land on the track to open its first unit.
 *
 * Opened by the Make a track button at the top of the page and nowhere else
 * (note c6e981e0), and drawn as a thing being written rather than fields to
 * fill (plan #1435): the name is the title line, what you want out of it is
 * the line under it, and your own units open beneath only when asked for.
 */
export function CustomTrackForm() {
  const [state, make] = useActionState<CustomTrackState, FormData>(createCustomTrack, {});
  const [writingUnits, setWritingUnits] = useState(false);

  return (
    <form action={make} className="mb-6">
      <ComposeBox className="space-y-1.5 py-2.5">
        <ComposeTitle
          name="name"
          aria-label="Track"
          required
          autoFocus
          maxLength={80}
          placeholder="The track, like Options pricing"
        />
        {/* ui-ok: composer-always-open -- the create. This box only renders
         * once Make a track is pressed, and naming the track is its job. */}
        <ComposeBody
          name="want"
          aria-label="What you want out of it"
          rows={1}
          maxLength={500}
          placeholder="What you want out of it, if you know"
        />
        {writingUnits ? (
          <ComposeBody
            name="units"
            aria-label="Your units, one per line, kept exactly as written and in this order, up to twelve"
            rows={4}
            maxLength={4000}
            autoFocus
            className="border-t border-border pt-1.5"
            placeholder={
              'Your units, one per line, up to twelve\nPut-call parity\nBinomial trees\nBlack–Scholes'
            }
          />
        ) : (
          <AddTrigger label="Write the units yourself" onClick={() => setWritingUnits(true)} />
        )}
        <div className="flex flex-wrap items-center gap-2 border-t border-border pt-2">
          <MakeButton />
          <PaidHint
            action="app/learn/know/actions.ts#createCustomTrack"
            what="Cost of making the track"
          />
          <Link href="/learn/know" className={buttonVariants({ variant: 'ghost', size: 'sm' })}>
            Cancel
          </Link>
        </div>
      </ComposeBox>
      {state.error && (
        <p role="alert" className="mt-1 text-small text-danger">
          {state.error}{' '}
          {state.existing && (
            <Link href={`/learn/s/${state.existing.id}`} className="underline underline-offset-2">
              Open {state.existing.name}
            </Link>
          )}
        </p>
      )}
    </form>
  );
}
