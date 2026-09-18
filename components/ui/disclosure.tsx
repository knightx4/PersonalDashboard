import { ChevronRight } from 'lucide-react';
import { cn } from '@/lib/cn';

/**
 * A section that folds away.
 *
 * Native `<details>`, deliberately, and not a `useState` boolean:
 *
 *  - it folds before JavaScript loads, which is law 6 and which four
 *    hand-rolled versions of this in the app do not manage;
 *  - the keyboard and the accessibility tree come free and correct, where a
 *    div with an onClick needs a role, a tabindex, aria-expanded, a
 *    Space/Enter handler and aria-controls to reach the same place, and the
 *    four hand-rolled versions have between none and two of those;
 *  - `name` makes a set of them into an accordion with no code at all.
 *
 * The `summary` is the load-bearing part and the reason this takes a `meta`
 * prop. Law 10 is not "things collapse", it is "things collapse *and the
 * collapsed line tells you whether to open it*". A fold that hides its own
 * count has moved the work rather than saved it, so the closed row carries the
 * fact: eleven retailers, £240 outstanding, three failing. If there is no such
 * fact, the section probably should not fold.
 *
 * There is deliberately no border. See law 11 -- this almost always lives
 * inside something that already has one.
 */
export function Disclosure({
  title,
  meta,
  defaultOpen = false,
  name,
  onToggle,
  children,
  className,
}: {
  title: React.ReactNode;
  /** The one fact that makes opening it a choice rather than a check. */
  meta?: React.ReactNode;
  defaultOpen?: boolean;
  /** Shared across siblings to make them an accordion; only one stays open. */
  name?: string;
  /**
   * Opened or closed, for a caller that has to record it — a conversation is
   * marked read by being opened. Only ever passed from a client component;
   * without it this stays what it is, markup that folds before JavaScript
   * loads.
   */
  onToggle?: (open: boolean) => void;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <details
      name={name}
      open={defaultOpen}
      onToggle={onToggle ? (event) => onToggle(event.currentTarget.open) : undefined}
      className={cn('group/disc', className)}
    >
      <summary
        className={cn(
          'press flex cursor-pointer list-none items-center gap-2 rounded-control py-1 text-ui',
          'text-ink-muted hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2',
          '[&::-webkit-details-marker]:hidden',
        )}
      >
        <ChevronRight
          aria-hidden
          strokeWidth={2}
          className="size-3.5 shrink-0 transition-transform duration-150 group-open/disc:rotate-90"
        />
        <span className="font-medium text-ink">{title}</span>
        {meta ? <span className="text-small text-ink-muted">{meta}</span> : null}
      </summary>
      {/* The indent is the grouping, in place of the border law 11 forbids. */}
      <div className="mt-2 ml-5.5">{children}</div>
    </details>
  );
}

/**
 * A whole section of a page, folded away by its own heading.
 *
 * `Disclosure` above is deliberately a *thing inside a box* -- no border, an
 * indent for grouping, a muted summary that reads as a row rather than as a
 * title. Using it for a page's top-level sections put the section headings a
 * level below the rows underneath them and indented the lists off the page's
 * own left edge, which is why four pages hand-rolled a `<details>` with their
 * own chevron instead. This is that shape, once: the page's heading, a count,
 * and the content still flush with the rest of the page.
 *
 * The heading is a real `<h2>` and it is the summary's only child, which is the
 * one arrangement `<summary>` allows besides plain phrasing content. Dropping
 * to a `<span>` -- which is what the hand-rolled versions did -- takes the
 * section out of the document outline, so a screen reader loses the page's
 * shape at exactly the moment it gains the ability to skip past a section.
 *
 * Open by default, unlike `Disclosure`. A section is the page; it folds because
 * the reader is done with it, not before they have seen it. The exception is a
 * section that is already history -- Closed, Done -- which passes false.
 *
 * Law 10 for the fold, and its second half for `count`: the collapsed line has
 * to say whether opening it is worth it.
 */
export function SectionFold({
  title,
  count,
  hint,
  defaultOpen = true,
  children,
  className,
}: {
  title: React.ReactNode;
  /** The number of things inside, on the closed line. */
  count?: number;
  /** A fact the count cannot carry -- the day a summary covers, say. */
  hint?: React.ReactNode;
  defaultOpen?: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <details open={defaultOpen} className={cn('group/fold', className)}>
      <summary
        className={cn(
          'press cursor-pointer list-none rounded-control py-1',
          'focus-visible:outline-2 focus-visible:outline-offset-2',
          '[&::-webkit-details-marker]:hidden',
        )}
      >
        <h2 className="flex flex-wrap items-baseline gap-2 text-body font-semibold text-ink">
          <ChevronRight
            aria-hidden
            strokeWidth={2}
            className="size-4 shrink-0 translate-y-0.5 text-ink-ghost transition-transform duration-150 group-open/fold:rotate-90"
          />
          {title}
          {count !== undefined && (
            <span className="tabular font-normal text-ink-muted">({count})</span>
          )}
          {hint && <span className="text-small font-normal text-ink-muted">{hint}</span>}
        </h2>
      </summary>
      <div className="mt-2 space-y-2">{children}</div>
    </details>
  );
}

/**
 * A group inside something that is already a box: a heading, space, and no
 * frame of its own.
 *
 * This exists because the alternative was being hand-written 93 times as
 * `rounded-lg border border-border bg-canvas p-3`, which is a second box
 * inside the first one arguing with it. Law 11.
 */
export function Group({
  title,
  action,
  children,
  className,
}: {
  title?: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn('space-y-2', className)}>
      {(title || action) && (
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          {title ? <h3 className="text-small font-semibold text-ink-muted">{title}</h3> : <span />}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}
