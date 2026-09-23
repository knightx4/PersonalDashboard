'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
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
 */
export function CustomTrackForm() {
  const [state, make] = useActionState<CustomTrackState, FormData>(createCustomTrack, {});

  return (
    <form action={make} className={cn(cardVariants({ padding: 'standard' }), 'mt-6')}>
      <h2 className="text-body font-semibold text-ink">Make a track</h2>
      <p className="mt-1 mb-4 text-ui text-ink-muted">
        Name what you want to study. It gets a fixed curriculum of units in teaching order, and you
        open one unit at a time.
      </p>

      <Field label="Track" id="track-name">
        <Input id="track-name" name="name" required maxLength={80} placeholder="Options pricing" />
      </Field>

      <Field
        label="What you want out of it"
        id="track-want"
        hint="Optional. Shapes what the curriculum covers and how far it goes."
        className="mt-4"
      >
        <Input
          id="track-want"
          name="want"
          maxLength={500}
          placeholder="Enough to price and hedge vanilla options at work"
        />
      </Field>

      <SectionFold title="Write the units yourself" defaultOpen={false} className="mt-4">
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

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <MakeButton />
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
