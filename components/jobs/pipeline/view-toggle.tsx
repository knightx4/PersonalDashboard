import Link from 'next/link';
import { Columns3, Table2 } from 'lucide-react';
import { cn } from '@/lib/cn';
import { segmentedFrame } from '@/components/ui/segmented';
import { pipelineHref, type PipelineParams, type PipelineViewName } from '@/lib/jobs/pipeline-view';

const VIEWS = [
  { value: 'board' as const, label: 'Board', Icon: Columns3 },
  { value: 'table' as const, label: 'Table', Icon: Table2 },
];

/**
 * Board or table, in the address (plan #1590).
 *
 * Links rather than buttons: the view is part of the URL, so the back button
 * undoes it and a link to the table opens the table. It was a preference on
 * the profile, written by a server action, when the second view was a list.
 * The board keeps only what is live, so going to it drops a closed filter;
 * the table's sort and grouping stay in the address for the way back.
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
            value === 'board'
              ? { view: undefined, status: undefined }
              : { view: 'table' },
          )}
          scroll={false}
          aria-current={view === value ? 'true' : undefined}
          className={cn(
            'press inline-flex h-7 items-center gap-1.5 px-2.5 text-ui font-medium',
            'transition-colors duration-quick focus-visible:outline-2 focus-visible:-outline-offset-2',
            view === value
              ? 'bg-accent-tint text-accent'
              : 'bg-surface text-ink-muted hover:bg-sunken hover:text-ink',
          )}
        >
          <Icon className="size-3.5" strokeWidth={1.75} aria-hidden />
          {label}
        </Link>
      ))}
    </span>
  );
}
