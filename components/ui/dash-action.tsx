'use client';

import { Button, type ButtonProps } from '@/components/ui/button';
import { CostHint } from '@/components/ui/cost-hint';
import { DashMark } from '@/components/ui/dash-mark';
import { PaidHint } from '@/components/ui/paid-hint';
import { cn } from '@/lib/cn';
import type { CostEstimate } from '@/lib/core/spend/estimate-types';
import type { PaidAction } from '@/lib/core/spend/paid-actions';

/**
 * A button that hands work to Dash (docs/ONE-INTERFACE-SPEC.md, Part 7).
 *
 * It reads as a verb with Dash's mark before it, "Prepare for this
 * interview" or "Summarize this reading", and carries the cost hint law 16
 * asks for beside it. The word AI and a model's name never go in the label:
 * the mark says who does the work, and the hint names the models.
 *
 * The cost comes one of three ways. `paid` names the server action, and the
 * hint finds its figure in the layout's PaidCostsProvider, as PaidHint does.
 * `estimate` passes a figure worked out already, and `costText` a fixed
 * price. With none of them, or with no figure for the action, nothing is
 * drawn beside the button: a run that is not metered per press, such as a
 * routine, has no price to show, and a missing hint is better than a made-up
 * one.
 *
 * While `pending`, the mark turns to working, so the press shows Dash on it
 * as well as the label saying so.
 *
 * Everything else is the Button's own: variant, size, type, form props.
 * `hintFirst` puts the $ before the button, for a button at a row's right
 * edge whose hint would otherwise hang off it.
 */
export type DashActionProps = ButtonProps & {
  /** The server action the press calls, for its cost hint. */
  paid?: PaidAction | readonly PaidAction[];
  /** How many items the press works on, for a per-unit estimate. */
  count?: number;
  /** A part of the press the ledger does not price on its own. */
  plus?: CostEstimate | null;
  /** A figure worked out already, in place of `paid`. */
  estimate?: CostEstimate | null;
  /** A fixed price said as it is, in place of an estimate. */
  costText?: string;
  /** What the press does, for a screen reader: "Cost of the summary". */
  what?: string;
  /** Which edge of the $ its popup hangs from. */
  align?: 'start' | 'end';
  /** The $ before the button rather than after it. */
  hintFirst?: boolean;
  /** Classes for the span holding the button and its hint. */
  wrapperClassName?: string;
};

const SMALL = new Set(['xs', 'sm']);

export function DashAction({
  paid,
  count,
  plus,
  estimate,
  costText,
  what,
  align,
  hintFirst = false,
  wrapperClassName,
  pending,
  variant,
  size,
  children,
  ...props
}: DashActionProps) {
  const small = variant === 'link' || SMALL.has(size ?? 'md');

  let hint: React.ReactNode = null;
  if (paid) {
    hint = <PaidHint action={paid} count={count} plus={plus} what={what} align={align} />;
  } else if (estimate || costText) {
    hint = (
      <CostHint
        estimate={estimate ?? undefined}
        text={costText}
        count={count}
        what={what}
        align={align}
      />
    );
  }

  return (
    <span className={cn('inline-flex items-center gap-1', wrapperClassName)} data-dash-action="">
      {hintFirst && hint}
      <Button variant={variant} size={size} pending={pending} {...props}>
        <DashMark
          size={small ? '2xs' : 'icon'}
          tone="brand"
          state={pending ? 'working' : 'idle'}
          decorative
        />
        {children}
      </Button>
      {!hintFirst && hint}
    </span>
  );
}
