'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { Plus } from 'lucide-react';
import { Button, buttonVariants } from '@/components/ui/button';
import { PaidHint } from '@/components/ui/paid-hint';
import { cardVariants } from '@/components/ui/card';
import { SectionFold } from '@/components/ui/disclosure';
import { Field, Input, Textarea } from '@/components/ui/field';
import { cn } from '@/lib/cn';
import { createCustomTrack, type CustomTrackState } from './actions';

function MakeButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="primary" pending={pending}>
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
 * (note c6e981e0): an always-open form under the tracks was the form-feel law
 * 14 rules out. Two short strings, so placeholders rather than labels (law 9),
 * and no heading restating the button that opened it (law 15).
 */
export function CustomTrackForm() {
  const [state, make] = useActionState<CustomTrackState, FormData>(createCustomTrack, {});

  return (
    <form action={make} className={cn(cardVariants({ padding: 'standard' }), 'mb-6 space-y-3')}>
      <Input
        id="track-name"
        name="name"
        aria-label="Track"
        required
        autoFocus
        maxLength={80}
        placeholder="The track, like Options pricing"
      />
      <Input
        id="track-want"
        name="want"
        aria-label="What you want out of it"
        maxLength={500}
        placeholder="What you want out of it, if you know (optional)"
      />

      <SectionFold title="Write the units yourself" defaultOpen={false}>
        <Field
          label="Units, one per line"
          id="track-units"
          hint="Kept exactly as written and in this order, up to twelve. Each unit gets a line on what it covers and what you can do after it."
          className="mt-2"
        >
          <Textarea
            id="track-units"
            name="units"
            rows={6}
            maxLength={4000}
            placeholder={
              'Put-call parity\nBinomial trees\nBlack–Scholes\nThe Greeks\nVolatility smiles'
            }
          />
        </Field>
      </SectionFold>

      <div className="flex flex-wrap items-center gap-3">
        <MakeButton />
        <PaidHint
          action="app/learn/know/actions.ts#createCustomTrack"
          what="Cost of making the track"
        />
        <Link href="/learn/know" className={buttonVariants({ variant: 'ghost' })}>
          Cancel
        </Link>
        {state.error && (
          <span className="text-ui text-danger">
            {state.error}{' '}
            {state.existing && (
              <Link href={`/learn/s/${state.existing.id}`} className="underline underline-offset-2">
                Open {state.existing.name}
              </Link>
            )}
          </span>
        )}
      </div>
    </form>
  );
}
