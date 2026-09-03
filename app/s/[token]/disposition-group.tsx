'use client';

import { useState, useTransition } from 'react';
import { Minus, Package, Plus } from 'lucide-react';
import { cn } from '@/lib/cn';
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

const CHOICES: Array<{ id: Choice; label: string; tint: string; active: string }> = [
  {
    id: 'keep',
    label: 'Keep',
    tint: 'hover:border-brand hover:text-brand',
    active: 'border-brand bg-brand-tint text-brand',
  },
  {
    id: 'sell',
    label: 'Sell',
    tint: 'hover:border-accent-orange hover:text-accent-orange',
    active: 'border-accent-orange bg-accent-orange-tint text-accent-orange',
  },
  {
    id: 'giveaway',
    label: 'Give away',
    tint: 'hover:border-accent-pink hover:text-accent-pink',
    active: 'border-accent-pink bg-accent-pink-tint text-accent-pink',
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
        'rounded-card border border-border bg-surface p-4 transition-opacity',
        pending && 'opacity-70',
      )}
    >
      <div className="flex gap-4">
        <div className="size-16 shrink-0 overflow-hidden rounded-lg border border-border bg-canvas">
          {group.imageUrl ? (
            // A plain <img>, as everywhere else in this app. It also keeps the
            // promise the rest of this feature makes: next/image would have the
            // server fetch and re-encode the remote file on render, which is an
            // outbound call made by an anonymous page view.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={group.imageUrl} alt="" className="size-full object-cover" />
          ) : (
            <div className="flex size-full items-center justify-center text-ink-faint">
              <Package className="size-5" aria-hidden />
            </div>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-ink">
            {group.name}
            {quantity > 1 && <span className="ml-1.5 text-ink-faint">× {quantity}</span>}
          </p>
          {/* Empty when the price is unknown: nothing at all, never $0.00. */}
          {priceLabel && (
            <p className="mt-0.5 text-[13px] text-ink-muted">
              {priceLabel}
              {quantity > 1 && <span className="text-ink-faint"> each</span>}
            </p>
          )}
          {quantity > 1 && (
            <p className="mt-0.5 text-[12px] text-ink-faint">
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
                    'press h-9 rounded-lg border px-3 text-[13px] font-medium transition-colors duration-150',
                    counts[choice.id] === 1
                      ? choice.active
                      : cn('border-border bg-surface text-ink-muted', choice.tint),
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
                    'flex items-center justify-between rounded-lg border px-2 py-1.5',
                    counts[choice.id] > 0 ? choice.active : 'border-border text-ink-muted',
                  )}
                >
                  <span className="pl-1 text-[13px] font-medium">{choice.label}</span>
                  <span className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => step(choice.id, -1)}
                      disabled={counts[choice.id] === 0}
                      aria-label={`One fewer to ${choice.label.toLowerCase()}`}
                      className="press grid size-7 place-items-center rounded-md hover:bg-canvas disabled:opacity-30"
                    >
                      <Minus className="size-3.5" aria-hidden />
                    </button>
                    <span className="w-4 text-center text-sm tabular-nums">
                      {counts[choice.id]}
                    </span>
                    <button
                      type="button"
                      onClick={() => step(choice.id, 1)}
                      disabled={undecided === 0}
                      aria-label={`One more to ${choice.label.toLowerCase()}`}
                      className="press grid size-7 place-items-center rounded-md hover:bg-canvas disabled:opacity-30"
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

      {error && <p className="mt-2 text-[13px] text-red-600">{error}</p>}
    </li>
  );
}
