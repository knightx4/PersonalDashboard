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
  children,
  className,
}: {
  title: React.ReactNode;
  /** The one fact that makes opening it a choice rather than a check. */
  meta?: React.ReactNode;
  defaultOpen?: boolean;
  /** Shared across siblings to make them an accordion; only one stays open. */
  name?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <details name={name} open={defaultOpen} className={cn('group/disc', className)}>
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
