'use client';

import { Button } from '@/components/ui/button';
import { DashMark } from '@/components/ui/dash-mark';
import { cn } from '@/lib/cn';
import { askListLabel, type AskListFilter } from '@/lib/ask/list-filter';
import { useAskDash } from './ask-dash';

/**
 * Sends a filtered list's rows to Ask Dash (plan #1658). It sits in the list
 * page's header actions, only while the list is narrowed: the page passes the
 * filter it is under, or no filter at all and nothing is drawn, since the
 * whole list is what Dash already sees. The sheet opens with "12 items from
 * Inventory" above its box, and Dash reads the rows from the filter.
 *
 * `count` is the rows the page is showing. `compact` is the mark alone, for
 * a phone, where the header's row has no room for the words and the button
 * sits beside the filters instead. Outside the shell, as in the gallery's
 * plain pages, there is no sheet to open and nothing is drawn.
 */
export function AskDashRowsButton({
  filter,
  count,
  compact = false,
  className,
}: {
  filter: AskListFilter | null;
  count: number;
  compact?: boolean;
  className?: string;
}) {
  const handle = useAskDash();
  if (!handle || !filter || count === 0) return null;
  const label = askListLabel(filter.list, count);
  return (
    <Button
      type="button"
      variant="secondary"
      size="sm"
      className={cn(compact && 'w-7 shrink-0 px-0', className)}
      onClick={() => handle.open(undefined, { ...filter, label })}
      title={`Ask Dash about ${label}`}
    >
      <DashMark size="2xs" tone="brand" decorative />
      <span className={compact ? 'sr-only' : undefined}>Ask Dash about these</span>
    </Button>
  );
}
