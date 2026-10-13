import Link from '@/components/ui/link';
import { ChevronDown } from 'lucide-react';
import { ActionMenu } from '@/components/ui/action-menu';
import { toggleChipClass } from '@/components/ui/chip';
import { cn } from '@/lib/cn';

/**
 * A row of view chips, with any further views in a menu at its end (#516's
 * answer on /dev/plan). Taken out of the dev plan's summary strip (plan
 * #1157) so a goal's steps and All goals are narrowed by the same chips.
 *
 * Each view is a link rather than state, so the view you are on is in the
 * address and survives a reload. `hrefOf` says where each view lives; the
 * default view usually keeps the bare path.
 *
 * `counts` is optional: a view with a count above zero shows it after its
 * label. The dev plan passes none, since its strip counts beside the chips.
 */
export function ViewChips<V extends string>({
  view,
  chips,
  menu = [],
  labels,
  hrefOf,
  counts,
  scroll,
  className,
}: {
  view: V;
  chips: readonly V[];
  menu?: readonly V[];
  labels: Record<V, string>;
  hrefOf: (view: V) => string;
  counts?: Partial<Record<V, number>>;
  /** Passed to each link: false keeps the page where it is when the view changes. */
  scroll?: boolean;
  className?: string;
}) {
  const label = (candidate: V) => {
    const count = counts?.[candidate] ?? 0;
    return count > 0 ? (
      <>
        {labels[candidate]} <span className="tabular">{count}</span>
      </>
    ) : (
      labels[candidate]
    );
  };
  const inMenu = menu.includes(view);

  return (
    <nav aria-label="View" className={cn('flex flex-wrap items-center gap-x-1 gap-y-2', className)}>
      {chips.map((candidate) => (
        <Link
          key={candidate}
          href={hrefOf(candidate)}
          scroll={scroll}
          aria-current={candidate === view ? 'page' : undefined}
          className={toggleChipClass(candidate === view)}
        >
          {label(candidate)}
        </Link>
      ))}
      {/* The rest. Nothing is lost by moving a view off the row -- it is a
          link in here -- and the trigger says which one you are on when it
          is one of these, so the row still answers "where am I". */}
      {menu.length > 0 && (
        <ActionMenu
          label="More views"
          align="end"
          trigger={
            <span className="inline-flex items-center gap-1">
              {inMenu ? label(view) : 'More'}
              <ChevronDown strokeWidth={1.75} aria-hidden />
            </span>
          }
          triggerClassName={toggleChipClass(inMenu)}
          items={menu.map((candidate) => ({
            id: candidate,
            label: counts?.[candidate] ? `${labels[candidate]} ${counts[candidate]}` : labels[candidate],
            href: hrefOf(candidate),
            current: candidate === view,
          }))}
        />
      )}
    </nav>
  );
}
