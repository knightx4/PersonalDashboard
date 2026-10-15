'use client';

import { Button } from '@/components/ui/button';
import { DashAction, type DashActionProps } from '@/components/ui/dash-action';

/**
 * A pricing button that is Dash's press only when the lookup is a web
 * estimate. A catalog lookup runs no model and costs nothing, so it stays a
 * plain button with no mark and no hint.
 */
export function BilledPress({
  billed,
  paid,
  count,
  plus,
  estimate,
  costText,
  what,
  align,
  hintFirst,
  wrapperClassName,
  ...props
}: DashActionProps & { billed: boolean }) {
  if (!billed) return <Button {...props} />;
  return (
    <DashAction
      paid={paid}
      count={count}
      plus={plus}
      estimate={estimate}
      costText={costText}
      what={what}
      align={align}
      hintFirst={hintFirst}
      wrapperClassName={wrapperClassName}
      {...props}
    />
  );
}
