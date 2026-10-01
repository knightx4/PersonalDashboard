'use client';

import Link from 'next/link';
import { useLayoutEffect, useRef, useState } from 'react';
import { cn } from '@/lib/cn';
import type { NewsTopic } from '@/lib/news/issues/topics';
import { chipsThatFit } from '@/lib/news/quick/chip-fit';

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

/**
 * A filled pill with no border, the same shape FilterChips draws, so the chip
 * in force reads like the filter chips on other pages (law 11: no hand-drawn
 * bordered box).
 */
const CHIP =
  'press inline-flex shrink-0 items-center whitespace-nowrap rounded-full px-2.5 py-1 text-small transition-colors duration-150';
const CHIP_OFF = 'bg-sunken text-ink-muted hover:bg-accent-tint hover:text-accent';
const CHIP_ON = 'bg-accent-tint font-medium text-accent';

/**
 * A row of topic chips above Quick read and the newsletter list (plan #860).
 *
 * Each chip is a link to the page with `?topic=` on it, so the choice survives
 * a reload and needs no script. Pressing the chip in force, or "All topics",
 * clears it. The chip in force is drawn even when nothing on it is left
 * unread, so there is always a way back out of it. Renders nothing when there
 * is no topic to offer.
 *
 * On a phone the row stays on one line (note 56043a15): as many chips as fit,
 * then "More", which opens the whole row. The chip in force moves to the front
 * there, so it is never the one folded away. Widths are measured from an
 * invisible copy of the row, and the line is clipped by CSS before that runs,
 * so the page never paints the chips wrapped and then folds them.
 */
export function TopicChips({ topics, selected, hrefs, allHref, className }: TopicChipsProps) {
  const shown = selected && !topics.includes(selected) ? [...topics, selected] : topics;
  const [fit, setFit] = useState<number | null>(null);
  const [open, setOpen] = useState(false);
  const rowRef = useRef<HTMLElement>(null);
  const ghostRef = useRef<HTMLDivElement>(null);
  const key = shown.join('|');

  useLayoutEffect(() => {
    const row = rowRef.current;
    const ghost = ghostRef.current;
    if (!row || !ghost) return;
    const phone = window.matchMedia(PHONE);
    const measure = () => {
      if (!phone.matches) return setFit(null);
      const widths = Array.from(ghost.children, (child) => (child as HTMLElement).offsetWidth);
      setFit(
        chipsThatFit({
          all: widths[0],
          topics: widths.slice(1, -1),
          more: widths[widths.length - 1],
          available: row.clientWidth,
          gap: GAP,
        }),
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(row);
    phone.addEventListener('change', measure);
    return () => {
      observer.disconnect();
      phone.removeEventListener('change', measure);
    };
  }, [key]);

  if (!shown.length) return null;

  const folded = fit !== null && !open;
  const phoneOrder = selected ? [selected, ...shown.filter((t) => t !== selected)] : shown;
  const drawn = fit === null ? shown : folded ? phoneOrder.slice(0, fit) : phoneOrder;

  return (
    <div className={cn('relative', className)}>
      <div
        ref={ghostRef}
        aria-hidden
        className="pointer-events-none invisible absolute left-0 top-0 flex gap-1.5"
      >
        <span className={CHIP}>All topics</span>
        {phoneOrder.map((topic) => (
          <span key={topic} className={CHIP}>
            {topic}
          </span>
        ))}
        <span className={CHIP}>More</span>
      </div>
      <nav
        ref={rowRef}
        aria-label="Filter by topic"
        className={cn(
          'flex gap-1.5',
          open ? 'flex-wrap' : 'max-md:flex-nowrap max-md:overflow-hidden md:flex-wrap',
        )}
      >
        <Link
          href={allHref}
          aria-current={selected ? undefined : 'true'}
          className={cn(CHIP, selected ? CHIP_OFF : CHIP_ON)}
        >
          All topics
        </Link>
        {drawn.map((topic) => {
          const current = topic === selected;
          return (
            <Link
              key={topic}
              href={current ? allHref : (hrefs[topic] ?? allHref)}
              aria-current={current ? 'true' : undefined}
              className={cn(CHIP, current ? CHIP_ON : CHIP_OFF)}
            >
              {topic}
            </Link>
          );
        })}
        {fit !== null && (
          <button
            type="button"
            aria-expanded={open}
            onClick={() => setOpen(!open)}
            className={cn(CHIP, CHIP_OFF)}
          >
            {open ? 'Less' : 'More'}
          </button>
        )}
      </nav>
    </div>
  );
}

/** Below md, where the row is kept to one line. Matches Tailwind's max-md. */
const PHONE = '(max-width: 767.98px)';
/** gap-1.5, in pixels. */
const GAP = 6;
