import { Columns3, ListChecks, Table2 } from 'lucide-react';
import { ViewSwitch } from '@/components/shell/view-switch';
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
    <ViewSwitch
      label="Pipeline view"
      current={view}
      views={VIEWS.map((option) => ({
        ...option,
        href: pipelineHref(
          params,
          option.value === 'table'
            ? { view: 'table' }
            : { view: option.value === 'focus' ? undefined : option.value, status: undefined },
        ),
      }))}
    />
  );
}
