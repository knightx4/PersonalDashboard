import { ChevronDown } from 'lucide-react';
import Link from '@/components/ui/link';
import { ActionMenu } from '@/components/ui/action-menu';
import { toggleChipClass } from '@/components/ui/chip';
import { EmptyState } from '@/components/ui/empty-state';
import { cn } from '@/lib/cn';
import {
  sameTagFilter,
  tagFilterChoices,
  tagFilterLabel,
  tagFilterQuery,
  type TagFilter,
} from '@/lib/todo/tasks/tag-filter';

/** How many tags the phone's row shows before More. */
const PHONE_TAGS = 2;

function keyOf(choice: TagFilter): string {
  return choice === null ? 'all' : choice.kind === 'tag' ? `tag:${choice.tag}` : 'untagged';
}

function labelOf(choice: TagFilter): string {
  return choice === null ? 'All tags' : choice.kind === 'tag' ? choice.tag : 'Untagged';
}

/**
 * The row of tag chips over a list of todos (plan #2340.3), on the agenda and
 * on the all-tasks page. Each chip is an address, so the filter survives a
 * reload and goes along when the page is linked. "All tags" clears it.
 *
 * `keep` is what else the address holds (the status tab, the search), so
 * choosing a tag stays inside them.
 */
export function TagFilterRow({
  pathname,
  used,
  filter,
  keep = {},
  menuOpen = false,
  className,
}: {
  pathname: string;
  /** The person's tags, most used first (loadUsedTags). */
  used: readonly string[];
  filter: TagFilter;
  keep?: Record<string, string>;
  /** For the gallery: draw the phone's More menu open. */
  menuOpen?: boolean;
  className?: string;
}) {
  const tags = tagFilterChoices(used, filter);
  const hrefOf = (choice: TagFilter) => {
    const query = new URLSearchParams({ ...keep, ...tagFilterQuery(choice) }).toString();
    return query ? `${pathname}?${query}` : pathname;
  };

  const chip = (choice: TagFilter, extra?: string) => {
    const on = sameTagFilter(choice, filter);
    return (
      <Link
        key={keyOf(choice)}
        href={hrefOf(choice)}
        aria-current={on ? 'page' : undefined}
        className={cn(toggleChipClass(on), 'max-w-full', extra)}
      >
        <span className="min-w-0 truncate">{labelOf(choice)}</span>
      </Link>
    );
  };

  // On a phone the row stays on one line (taste: categories-one-line): All
  // tags, two tags with the chosen one always among them, and More for the
  // rest, Untagged included. More names the choice when it holds it.
  const chosen = filter?.kind === 'tag' ? filter.tag : null;
  const shown = tags.slice(0, PHONE_TAGS);
  if (chosen && !shown.includes(chosen)) shown[shown.length - 1] = chosen;
  const rest: TagFilter[] = [
    ...tags.filter((tag) => !shown.includes(tag)).map((tag) => ({ kind: 'tag' as const, tag })),
    { kind: 'untagged' },
  ];
  const inMenu = rest.some((choice) => sameTagFilter(choice, filter));

  return (
    <>
      <nav aria-label="Filter by tag" className={cn('flex flex-wrap items-center gap-1 max-sm:hidden', className)}>
        {chip(null)}
        {tags.map((tag) => chip({ kind: 'tag', tag }))}
        {chip({ kind: 'untagged' })}
      </nav>
      <nav aria-label="Filter by tag" className={cn('flex min-w-0 items-center gap-1 sm:hidden', className)}>
        {chip(null)}
        {shown.map((tag) => chip({ kind: 'tag', tag }, 'min-w-0 max-w-32 shrink'))}
        <ActionMenu
          label="More tags"
          align="end"
          defaultOpen={menuOpen}
          // Held to the menu's own 180px, so its right edge stays on the More
          // chip's and a long tag wraps rather than pushing it to the screen's
          // edge. Each entry a full press target, and the menu gone from sm
          // up, where the row has no More.
          panelClassName="max-w-45 break-words [&_[role=menuitem]]:min-h-11 sm:hidden"
          trigger={
            <span className="inline-flex min-w-0 items-center gap-1">
              <span className="min-w-0 truncate">{inMenu ? labelOf(filter) : 'More'}</span>
              <ChevronDown strokeWidth={1.75} aria-hidden />
            </span>
          }
          triggerClassName={cn(toggleChipClass(inMenu), 'w-auto min-w-0 max-w-32')}
          items={rest.map((choice) => ({
            id: keyOf(choice),
            label: labelOf(choice),
            href: hrefOf(choice),
            current: sameTagFilter(choice, filter),
          }))}
        />
      </nav>
    </>
  );
}

/** A filter nothing matches: says so, and offers the way back to everything. */
export function TagFilterEmpty({
  filter,
  clearHref,
  className,
}: {
  filter: Exclude<TagFilter, null>;
  clearHref: string;
  className?: string;
}) {
  return (
    <EmptyState
      title={filter.kind === 'tag' ? `No todos carry ${tagFilterLabel(filter)}.` : 'Every todo has a tag.'}
      description={
        filter.kind === 'tag'
          ? 'Tag a todo with it and it will show here.'
          : 'Todos with no tag show here.'
      }
      action={{ label: 'Clear the filter', href: clearHref }}
      className={className}
    />
  );
}
