'use client';

import { createContext, useContext } from 'react';
import { CostHint } from '@/components/ui/cost-hint';
import { scaleEstimate, sumEstimates } from '@/lib/core/spend/estimate-types';
import type { PaidAction, PaidCosts } from '@/lib/core/spend/paid-actions';

/**
 * The $ hint for a button, named by the server action it calls.
 *
 * A module's layout works out every press's estimate on the server, once
 * (`estimatePaidActions` in lib/core/spend/paid-actions.ts), and puts them in
 * `PaidCostsProvider`. A button then says which action it presses and the hint
 * finds its figure there, so a form deep in a page needs no estimate passed
 * down to it and opening the hint makes no request.
 *
 * Draws nothing when the layout gave no figure, which is what happens in the
 * preview gallery: a missing hint is better than a made-up one.
 */

const PaidCostsContext = createContext<PaidCosts>({});

export function PaidCostsProvider({
  costs,
  children,
}: {
  costs: PaidCosts;
  children: React.ReactNode;
}) {
  return <PaidCostsContext.Provider value={costs}>{children}</PaidCostsContext.Provider>;
}

export function PaidHint({
  action,
  count,
  what,
  align,
  className,
}: {
  /**
   * The press, or several when one button sets off more than one action:
   * reading a pasted list parses it and then looks up every reference.
   */
  action: PaidAction | readonly PaidAction[];
  /** How many items the press works on, for its per-unit operations. */
  count?: number;
  /** What the button does, for a screen reader: "Cost of reading the list". */
  what?: string;
  align?: 'start' | 'end';
  className?: string;
}) {
  const costs = useContext(PaidCostsContext);
  const actions: readonly PaidAction[] = typeof action === 'string' ? [action] : action;
  const parts = actions.map((key) => costs[key]);
  if (parts.some((part) => !part)) return null;

  const estimate =
    count == null
      ? sumEstimates(parts as NonNullable<(typeof parts)[number]>[])
      : sumEstimates(parts.map((part) => scaleEstimate(part!, count)));
  if (!estimate) return null;

  return <CostHint estimate={estimate} what={what} align={align} className={className} />;
}
