'use client';

import { useState, useTransition } from 'react';
import { Minus, Package, Plus } from 'lucide-react';
import { cn } from '@/lib/cn';
import { buttonVariants } from '@/components/ui/button';
import { cardVariants } from '@/components/ui/card';
import type { ShareGroup } from '@/lib/share/read/load-disposition';
import { respondToShare } from './actions';

/**
 * One product on the shared form.
 *
 * There is no submit button. Each control writes on click and the card renders
 * what the server said, so coming back tomorrow shows the choices made today
 * and changing one's mind is just clicking again.
 *
 * Two shapes, because one control does not fit both cases. A single copy is a
 * choice between three things, so it gets three buttons. Several copies is a
 * split -- "keep one, sell two" -- so it gets steppers and a running count of
 * what is still undecided. Making the single case use steppers would mean
 * clicking + to answer a yes/no question.
 */

type Choice = 'keep' | 'sell' | 'giveaway';

/**
 * Three answers, and each keeps its own hue because the hue is the answer --
 * this is not one accent applied three times.
 *
 * Two paints per choice, because the two shapes below need different things.
 * `button` goes on a real control and keeps the frame the control owns;
 * `lane` goes on the stepper's ground, where the fill is doing the grouping
 * and a second hairline inside the card would only argue with it (law 11).
 */
const CHOICES: Array<{ id: Choice; label: string; tint: string; button: string; lane: string }> = [
  {
    id: 'keep',
    label: 'Keep',
    tint: 'hover:border-accent hover:text-accent',
    button: 'border-accent bg-accent-tint text-accent hover:border-accent hover:bg-accent-tint',
    lane: 'bg-accent-tint text-accent',
  },
  {
    id: 'sell',
    label: 'Sell',
    tint: 'hover:border-caution hover:text-caution',
    button: 'border-caution bg-caution-tint text-caution hover:border-caution hover:bg-caution-tint',
    lane: 'bg-caution-tint text-caution',
  },
  {
    id: 'giveaway',
    label: 'Give away',
    tint: 'hover:border-w-shopping hover:text-w-shopping',
    button:
      'border-w-shopping bg-w-shopping-tint text-w-shopping hover:border-w-shopping hover:bg-w-shopping-tint',
    lane: 'bg-w-shopping-tint text-w-shopping',
  },
];

type Counts = { keep: number; sell: number; giveaway: number };

export function DispositionGroup({
  token,
  group,
  canRespond,
  priceLabel,
}: {
  token: string;
  group: ShareGroup;
  canRespond: boolean;
  /** Already formatted, and empty when the price is unknown. See lib/money.ts. */
  priceLabel: string;
}) {
  const [counts, setCounts] = useState<Counts>({
    keep: group.keepQty,
    sell: group.sellQty,
    giveaway: group.giveawayQty,
  });
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const quantity = group.quantity;
  const decided = counts.keep + counts.sell + counts.giveaway;
  const undecided = Math.max(0, quantity - decided);

  function save(next: Counts) {
    // Optimistic, then corrected: the server counts the quantity itself, so
    // its answer is the one that stands. Reverting on failure matters because
    // a card showing "sell 3" that the database refused is a lie she would act
    // on later.
    const previous = counts;
    setCounts(next);
    setError(null);

    startTransition(async () => {
      const result = await respondToShare({
        token,
        groupKey: group.groupKey,
        keep: next.keep,
        sell: next.sell,
        giveaway: next.giveaway,
        note: group.note,
      });

      if (result === null) {
        setCounts(previous);
        setError('This link is no longer active. Ask for a new one.');
        return;
      }

      if (!result.ok) {
        setCounts(previous);
        setError(
          result.error === 'over_quantity'
            ? `There ${result.quantity === 1 ? 'is' : 'are'} only ${result.quantity ?? quantity} of these.`
            : result.error === 'read_only'
              ? 'This link can be read but not changed.'
              : result.error === 'rate_limited'
                ? 'Too many changes at once — try again in a moment.'
                : 'That did not save. Try again.',
        );
        return;
      }

      setCounts({
        keep: result.group.keepQty,
        sell: result.group.sellQty,
        giveaway: result.group.giveawayQty,
      });
    });
  }

  function toggle(choice: Choice) {
    const already = counts[choice] === 1;
    save({
      keep: 0,
      sell: 0,
      giveaway: 0,
      ...(already ? {} : { [choice]: 1 }),
    } as Counts);
  }

  function step(choice: Choice, delta: number) {
    const next = { ...counts, [choice]: Math.max(0, counts[choice] + delta) };
    if (next.keep + next.sell + next.giveaway > quantity) return;
    save(next);
  }

  return (
    <li
      className={cn(
        cardVariants({ padding: 'dense' }),
        'transition-opacity',
        pending && 'opacity-70',
      )}
    >
      <div className="flex gap-4">
        {/* A filled tile, not an outlined one. The edge was there to stop a
            white product shot bleeding into a white card, and a recessed
            ground does that without drawing a frame inside a frame. */}
        <div className="size-16 shrink-0 overflow-hidden rounded-card bg-sunken">
          {group.imageUrl ? (
            // A plain <img>, as everywhere else in this app. It also keeps the
            // promise the rest of this feature makes: next/image would have the
            // server fetch and re-encode the remote file on render, which is an
            // outbound call made by an anonymous page view.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={group.imageUrl} alt="" className="size-full object-cover" />
          ) : (
            <div className="flex size-full items-center justify-center text-ink-muted">
              <Package className="size-5" aria-hidden />
            </div>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <p className="text-body font-medium text-ink">
            {group.name}
            {quantity > 1 && <span className="ml-1.5 text-ink-muted">× {quantity}</span>}
          </p>
          {/* Empty when the price is unknown: nothing at all, never $0.00. */}
          {priceLabel && (
            <p className="mt-0.5 text-ui text-ink-muted">
              {priceLabel}
              {quantity > 1 && <span className="text-ink-muted"> each</span>}
            </p>
          )}
          {quantity > 1 && (
            <p className="mt-0.5 text-small text-ink-muted">
              {undecided === 0 ? 'All decided' : `${undecided} still to decide`}
            </p>
          )}
        </div>
      </div>

      {canRespond && (
        <div className="mt-3">
          {quantity === 1 ? (
            <div className="flex flex-wrap gap-2">
              {CHOICES.map((choice) => (
                <button
                  key={choice.id}
                  type="button"
                  onClick={() => toggle(choice.id)}
                  aria-pressed={counts[choice.id] === 1}
                  className={cn(
                    buttonVariants({ variant: 'secondary' }),
                    counts[choice.id] === 1
                      ? choice.button
                      : cn('text-ink-muted', choice.tint),
                  )}
                >
                  {choice.label}
                </button>
              ))}
            </div>
          ) : (
            <div className="grid gap-2 sm:grid-cols-3">
              {CHOICES.map((choice) => (
                <div
                  key={choice.id}
                  className={cn(
                    'flex items-center justify-between rounded-control px-2 py-1.5',
                    counts[choice.id] > 0 ? choice.lane : 'bg-sunken text-ink-muted',
                  )}
                >
                  <span className="pl-1 text-ui font-medium">{choice.label}</span>
                  <span className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => step(choice.id, -1)}
                      disabled={counts[choice.id] === 0}
                      aria-label={`One fewer to ${choice.label.toLowerCase()}`}
                      className="press grid size-7 place-items-center rounded-control hover:bg-surface disabled:opacity-30"
                    >
                      <Minus className="size-3.5" aria-hidden />
                    </button>
                    <span className="w-4 text-center text-body tabular-nums">
                      {counts[choice.id]}
                    </span>
                    <button
                      type="button"
                      onClick={() => step(choice.id, 1)}
                      disabled={undecided === 0}
                      aria-label={`One more to ${choice.label.toLowerCase()}`}
                      className="press grid size-7 place-items-center rounded-control hover:bg-surface disabled:opacity-30"
                    >
                      <Plus className="size-3.5" aria-hidden />
                    </button>
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {error && <p className="mt-2 text-ui text-danger">{error}</p>}
    </li>
  );
}
