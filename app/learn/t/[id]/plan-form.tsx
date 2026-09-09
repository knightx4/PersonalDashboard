'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cardVariants } from '@/components/ui/card';
import { cn } from '@/lib/cn';
import { formatMoney } from '@/lib/money';
import type { PlanStep } from '@/lib/learn/import/plan-payload';
import { confirmPlan, planTrack, type PlanState, type TrackActionState } from './actions';

/**
 * A topic with nothing in it, and a way out of that.
 *
 * Until this existed, typing a topic on /learn/new got you a track and a dead
 * end: the module could find something to read for a subject you had already
 * written down, and had nothing to say about the topic itself. This asks for
 * the route through it -- the few things to understand, in order, each with
 * somewhere to read it.
 *
 * The gaps are the part worth looking at, and they are shown as their own
 * rows rather than folded away. A generated plan is quietly incomplete far
 * more often than it is wrong: six plausible steps with the two it could not
 * source deleted reads as the whole topic, and there is no way to tell from
 * the outside. So a step with nothing behind it stays, says why, and goes into
 * the queue as a subject you can search for later.
 */

const ACCESS_NOTE: Record<string, string | null> = {
  open: null,
  paywalled: 'Paywalled',
  purchase: 'Buy',
  library: 'Library',
  unknown: 'Access unknown',
};

function PlanButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="secondary" disabled={pending}>
      <Sparkles className="size-4" strokeWidth={2} aria-hidden />
      {pending ? 'Working it out…' : 'Plan this topic'}
    </Button>
  );
}

function SaveButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? 'Saving…' : 'Add these to the track'}
    </Button>
  );
}

function StepRow({ step, index }: { step: PlanStep; index: number }) {
  const id = `step-${index}`;
  const source = step.source;
  const access = source ? (ACCESS_NOTE[source.access] ?? null) : null;
  const price =
    source && source.price_cents !== null && source.price_cents !== undefined
      ? formatMoney(source.price_cents)
      : null;

  // Back in the shape the payload schema validates, since it is re-checked on
  // the way in rather than trusted.
  const value = JSON.stringify({
    subject: step.subject,
    why: step.why,
    source: step.source,
    no_source_reason: step.noSourceReason,
  });

  return (
    <li className="flex gap-3 px-4 py-3">
      <input
        type="checkbox"
        id={id}
        name="step"
        value={value}
        defaultChecked
        className="mt-1 size-4 shrink-0 accent-accent"
      />
      <label htmlFor={id} className="min-w-0 flex-1 cursor-pointer">
        <span className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <span className="text-body font-medium text-ink">{step.subject}</span>
          {!source && (
            <span className="rounded-pill bg-sunken px-1.5 py-0.5 text-small text-ink-muted">
              No source found
            </span>
          )}
        </span>

        {step.why && <span className="mt-0.5 block text-ui text-ink">{step.why}</span>}

        {source ? (
          <>
            <span className="mt-1 flex flex-wrap items-baseline gap-x-2 gap-y-1">
              <span className="text-ui text-ink">{source.title}</span>
              {source.author && <span className="text-ui text-ink-muted">{source.author}</span>}
              {access && (
                <span className="rounded-pill bg-sunken px-1.5 py-0.5 text-small text-ink-muted">
                  {price ? `${access} · ${price}` : access}
                </span>
              )}
            </span>

            {source.locator_label && (
              <span className="mt-0.5 block text-ui text-ink">{source.locator_label}</span>
            )}

            {/* The basis before anything is saved. This is the moment to untick
                a chapter number nobody checked. */}
            <span className="mt-0.5 block text-ui text-ink-muted">{source.locator_basis}</span>

            {source.canonical_url && (
              <span className="mt-0.5 block truncate text-small text-ink-muted">
                {source.canonical_url}
              </span>
            )}
          </>
        ) : (
          <span className="mt-1 block text-ui text-ink-muted">
            {step.noSourceReason} It goes in as a subject, and you can search for it from its own
            page.
          </span>
        )}
      </label>
    </li>
  );
}

export function PlanForm({ trackId }: { trackId: string }) {
  const [planState, plan] = useActionState<PlanState, FormData>(planTrack, {});
  const [saveState, save] = useActionState<TrackActionState, FormData>(confirmPlan, {});

  const steps = planState.steps ?? [];

  if (steps.length > 0) {
    const sourced = steps.filter((step) => step.source !== null).length;
    const missing = steps.length - sourced;

    return (
      <form action={save} className="mt-6">
        <input type="hidden" name="trackId" value={trackId} />

        <p className="mb-2 text-body text-ink-muted">
          {missing === 0
            ? `${steps.length} steps, each with something to read. Untick anything you do not want; nothing is saved until you do.`
            : `${steps.length} steps, ${sourced} with something to read. ${
                missing === 1 ? 'One it could not' : `${missing} it could not`
              } find a source for — kept, and marked, so the gap is visible rather than missing.`}
        </p>

        <ul className={cn(cardVariants(), 'divide-y divide-border overflow-hidden')}>
          {steps.map((step, index) => (
            <StepRow key={`${step.subject}-${index}`} step={step} index={index} />
          ))}
        </ul>

        <div className="mt-4 flex items-center gap-3">
          <SaveButton />
          {saveState.error && <span className="text-ui text-danger">{saveState.error}</span>}
        </div>
      </form>
    );
  }

  return (
    <form action={plan} className={cn(cardVariants(), 'mt-6 border-dashed px-4 py-6 text-center')}>
      <input type="hidden" name="trackId" value={trackId} />

      <p className="text-body text-ink-muted">
        Nothing in this track yet. Write down what you want to learn, or have the route worked out
        for you.
      </p>

      <div className="mt-4 flex flex-wrap items-center justify-center gap-3">
        <PlanButton />
        {planState.error && <span className="text-ui text-danger">{planState.error}</span>}
      </div>

      <p className="mt-2 text-small text-ink-muted">
        Searches for the few things this topic is made of and where to read each. Takes a moment,
        and saves nothing until you confirm.
      </p>
    </form>
  );
}
