import { ActionMenu } from '@/components/ui/action-menu';
import Link from '@/components/ui/link';
import { cn } from '@/lib/cn';
import type { DisplayChoice } from '@/lib/list-display';
import type { ColumnFilter } from '@/lib/table-view';

/**
 * What a table's column header holds (note f05f5f04, shared by plan #2341.2):
 * a column with a filter opens a menu holding its sort and its filter's
 * choices; a column without one is its sort link alone. The sort comes from
 * the Display panel's list (lib/list-display.ts) and the filter from
 * `columnFilters` (lib/table-view.ts), so the header, the panel and the
 * filter chips all set the same address. Goes inside the page's `<TH>`.
 */
export function ColumnHeading({
  sort,
  filter,
  open = false,
}: {
  sort: DisplayChoice;
  filter?: ColumnFilter;
  /** For the gallery: draw the menu open. */
  open?: boolean;
}) {
  if (!filter) {
    return (
      <Link
        href={sort.href}
        className={cn('transition-colors duration-quick', sort.chosen ? 'text-accent' : 'hover:text-ink')}
      >
        {sort.label}
      </Link>
    );
  }
  return (
    <ActionMenu
      label={`Sort or filter by ${sort.label.toLowerCase()}`}
      align="start"
      defaultOpen={open}
      // The header row is not drawn on a phone, so neither is its menu.
      panelClassName="max-md:hidden"
      // The heading alone, at the width the sort link had: a
      // chevron on five headings pushed Comp off the card.
      trigger={sort.label}
      triggerClassName={cn(
        'h-auto w-auto justify-start p-0 text-left text-micro font-semibold uppercase tracking-wider',
        sort.chosen || filter.active ? 'text-accent' : 'text-ink-muted hover:text-ink',
      )}
      items={[{ id: 'sort', label: `Sort by ${sort.label.toLowerCase()}`, href: sort.href, current: sort.chosen }, ...filter.choices]}
    />
  );
}
