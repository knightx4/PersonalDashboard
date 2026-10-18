import { ActionMenu } from '@/components/ui/action-menu';
import Link from '@/components/ui/link';
import { SearchField } from '@/components/shell/search-field';
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
 *
 * A text column's filter is a typed value (plan #2341.3): its menu opens on a
 * field that sets the column's param as you type, the way the box above a
 * list sets `q`. A column with no sort gives its `label` and its menu holds
 * the filter alone.
 */
export function ColumnHeading({
  sort,
  label,
  filter,
  open = false,
}: {
  sort?: DisplayChoice;
  /** The word the header shows, when it is not the sort's own label. */
  label?: string;
  filter?: ColumnFilter;
  /** For the gallery: draw the menu open. */
  open?: boolean;
}) {
  const word = label ?? sort?.label ?? '';
  if (!filter) {
    if (!sort) return <>{word}</>;
    return (
      <Link
        href={sort.href}
        className={cn('transition-colors duration-quick', sort.chosen ? 'text-accent' : 'hover:text-ink')}
      >
        {word}
      </Link>
    );
  }
  const chosen = sort?.chosen ?? false;
  return (
    <ActionMenu
      label={sort ? `Sort or filter by ${word.toLowerCase()}` : `Filter by ${word.toLowerCase()}`}
      align="start"
      defaultOpen={open}
      // The header row is not drawn on a phone, so neither is its menu.
      panelClassName="max-md:hidden"
      // The heading alone, at about the width the sort link had: a
      // chevron on five headings pushed Comp off the card.
      // A filtered column carries a dot as well as the accent (plan #2341.3),
      // since a sorted column is accent too and the two need telling apart.
      trigger={
        filter.active ? (
          <span className="inline-flex items-center gap-1">
            {word}
            <span className="size-1.5 rounded-full bg-accent" aria-hidden />
            <span className="sr-only">(filtered)</span>
          </span>
        ) : (
          word
        )
      }
      triggerClassName={cn(
        'h-auto w-auto justify-start p-0 text-left text-micro font-semibold uppercase tracking-wider',
        chosen || filter.active ? 'text-accent' : 'text-ink-muted hover:text-ink',
      )}
      header={
        filter.typed && (
          <div className="w-64 p-1 pb-1.5">
            <SearchField placeholder={filter.typed.placeholder} paramName={filter.typed.param} />
          </div>
        )
      }
      items={[
        ...(sort
          ? [{ id: 'sort', label: `Sort by ${word.toLowerCase()}`, href: sort.href, current: sort.chosen }]
          : []),
        ...filter.choices,
      ]}
    />
  );
}
