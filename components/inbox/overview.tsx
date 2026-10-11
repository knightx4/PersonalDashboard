import { cardVariants } from '@/components/ui/card';
import { cn } from '@/lib/cn';

/** The anchor each section of an inbox is reached by from its overview. */
export function inboxAnchor(key: string): string {
  return `inbox-${key}`;
}

export type InboxCell = { key: string; title: string; count: number; hint: string };

/**
 * The top of an inbox, in Dev and in Goals: how many of each kind there are,
 * each a link to its section. A long inbox otherwise has to be scrolled to
 * find out whether the questions are two or twenty, and that decides whether
 * you start with them.
 */
export function InboxOverview({ cells }: { cells: readonly InboxCell[] }) {
  return (
    <nav
      aria-label="Inbox sections"
      className={cn(cardVariants({ padding: 'dense' }), 'grid grid-cols-2 gap-1 sm:grid-cols-4')}
    >
      {cells.map((cell) => (
        <a
          key={cell.key}
          href={`#${inboxAnchor(cell.key)}`}
          className="press flex flex-col gap-0.5 rounded-control p-2 hover:bg-sunken"
        >
          <span className="tabular text-title font-semibold text-ink">{cell.count}</span>
          <span className="text-small font-semibold text-ink">{cell.title}</span>
          <span className="text-micro text-ink-muted">{cell.hint}</span>
        </a>
      ))}
    </nav>
  );
}
