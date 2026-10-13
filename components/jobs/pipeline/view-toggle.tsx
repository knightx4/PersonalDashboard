import Link from '@/components/ui/link';
import { Columns3, ListChecks, Table2 } from 'lucide-react';
import { segmentClass, segmentedFrame } from '@/components/ui/segmented';
import { pipelineHref, type PipelineParams, type PipelineViewName } from '@/lib/jobs/pipeline-view';

const VIEWS = [
  { value: 'focus' as const, label: 'Focus', Icon: ListChecks },
  { value: 'board' as const, label: 'Board', Icon: Columns3 },
  { value: 'table' as const, label: 'Table', Icon: Table2 },
];

/**
 * Focus, board or table, in the address (plan #1590).
 *
 * Links rather than buttons: the view is part of the URL, so the back button
 * undoes it and a link to the table opens the table. It was a preference on
 * the profile, written by a server action, when the second view was a list.
 * Focus and the board keep only what is live, so going to either drops a
 * closed filter; the table's sort and grouping stay in the address for the
 * way back.
 */
export function PipelineViewToggle({
  view,
  params,
}: {
  view: PipelineViewName;
  params: PipelineParams;
}) {
  return (
    <span role="group" aria-label="Pipeline view" className={segmentedFrame}>
      {VIEWS.map(({ value, label, Icon }) => (
        <Link
          key={value}
          href={pipelineHref(
            params,
            value === 'table'
              ? { view: 'table' }
              : { view: value === 'focus' ? undefined : value, status: undefined },
          )}
          scroll={false}
          aria-current={view === value ? 'true' : undefined}
          className={segmentClass(view === value)}
        >
          <Icon className="size-3.5" strokeWidth={1.75} aria-hidden />
          {label}
        </Link>
      ))}
    </span>
  );
}
