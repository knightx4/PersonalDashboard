import Link from 'next/link';
import { cn } from '@/lib/cn';
import type { NewsTopic } from '@/lib/news/issues/topics';

export type TopicChipsProps = {
  /** The topics with something unread, in the order the chips are drawn. */
  topics: readonly NewsTopic[];
  /** The topic in force, or null for every topic. */
  selected: NewsTopic | null;
  /** Where each chip goes: the same page narrowed to that topic, other choices kept. */
  hrefs: Partial<Record<NewsTopic, string>>;
  /** The same page with no topic. */
  allHref: string;
  className?: string;
};

const CHIP =
  'press inline-flex items-center rounded-full border px-2.5 py-1 text-small transition-colors duration-150';

/**
 * A row of topic chips above Quick read and the newsletter list (plan #860).
 *
 * Each chip is a link to the page with `?topic=` on it, so the choice survives
 * a reload and needs no script. Pressing the chip in force, or "All topics",
 * clears it. The chip in force is drawn even when nothing on it is left
 * unread, so there is always a way back out of it. Renders nothing when there
 * is no topic to offer.
 */
export function TopicChips({ topics, selected, hrefs, allHref, className }: TopicChipsProps) {
  const shown = selected && !topics.includes(selected) ? [...topics, selected] : topics;
  if (!shown.length) return null;

  return (
    <nav aria-label="Filter by topic" className={cn('flex flex-wrap gap-1.5', className)}>
      <Link
        href={allHref}
        aria-current={selected ? undefined : 'true'}
        className={cn(
          CHIP,
          selected
            ? 'border-border text-ink-muted hover:bg-sunken hover:text-ink'
            : 'border-transparent bg-accent-tint font-medium text-accent',
        )}
      >
        All topics
      </Link>
      {shown.map((topic) => {
        const current = topic === selected;
        return (
          <Link
            key={topic}
            href={current ? allHref : (hrefs[topic] ?? allHref)}
            aria-current={current ? 'true' : undefined}
            className={cn(
              CHIP,
              current
                ? 'border-transparent bg-accent-tint font-medium text-accent'
                : 'border-border text-ink-muted hover:bg-sunken hover:text-ink',
            )}
          >
            {topic}
          </Link>
        );
      })}
    </nav>
  );
}

/** Each topic's chip address, from a function that builds the page's address. */
export function topicHrefs(
  topics: readonly NewsTopic[],
  href: (topic: NewsTopic) => string,
): Partial<Record<NewsTopic, string>> {
  return Object.fromEntries(topics.map((topic) => [topic, href(topic)]));
}
