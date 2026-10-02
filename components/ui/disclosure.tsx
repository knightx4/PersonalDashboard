import { ChevronRight } from 'lucide-react';
import { cn } from '@/lib/cn';
import { FoldDetails } from '@/components/ui/fold-details';

/**
 * The `<details>` every fold here is drawn with: plain markup, or, given a
 * `remember` key, the client one that comes back the way it was left in this
 * browser (plan #1432). Server pages can pass the key, since it is a string.
 */
function Details({
  remember,
  defaultOpen,
  name,
  onToggle,
  className,
  children,
}: {
  remember?: string;
  defaultOpen: boolean;
  name?: string;
  onToggle?: (open: boolean) => void;
  className?: string;
  children: React.ReactNode;
}) {
  if (remember) {
    return (
      <FoldDetails
        remember={remember}
        defaultOpen={defaultOpen}
        name={name}
        onToggle={onToggle}
        className={className}
      >
        {children}
      </FoldDetails>
    );
  }
  return (
    <details
      name={name}
      open={defaultOpen}
      onToggle={onToggle ? (event) => onToggle(event.currentTarget.open) : undefined}
      className={className}
    >
      {children}
    </details>
  );
}

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
  remember,
  summaryClassName,
  bodyClassName,
  children,
  className,
}: {
  title: React.ReactNode;
  /** The one fact that makes opening it a choice rather than a check. */
  meta?: React.ReactNode;
  defaultOpen?: boolean;
  /**
   * Keep the fold in this browser under this key, so it is still folded next
   * visit (lib/fold-memory.ts). Leave it out for a fold that belongs to one
   * item rather than to the page, such as an answer under a question.
   */
  remember?: string;
  /** Added to the summary row, for a fold that is a whole row of a list. */
  summaryClassName?: string;
  /** Replaces the body's indent, for content that has to sit flush. */
  bodyClassName?: string;
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
    <Details
      remember={remember}
      name={name}
      defaultOpen={defaultOpen}
      onToggle={onToggle}
      className={cn('group/disc', className)}
    >
      <summary
        className={cn(
          'press flex cursor-pointer list-none items-center gap-2 rounded-control py-1 text-ui',
          'text-ink-muted hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2',
          '[&::-webkit-details-marker]:hidden',
          summaryClassName,
        )}
      >
        <ChevronRight
          aria-hidden
          strokeWidth={2}
          className="size-3.5 shrink-0 transition-transform duration-150 group-open/disc:rotate-90"
        />
        <span className="min-w-0 font-medium text-ink">{title}</span>
        {meta ? <span className="text-small text-ink-muted">{meta}</span> : null}
      </summary>
      {/* The indent is the grouping, in place of the border law 11 forbids. */}
      <div className={bodyClassName ?? 'mt-2 ml-5.5'}>{children}</div>
    </Details>
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
  remember,
  children,
  className,
}: {
  title: React.ReactNode;
  /** Keep the fold in this browser under this key (lib/fold-memory.ts). */
  remember?: string;
  /** The number of things inside, on the closed line. */
  count?: number;
  /** A fact the count cannot carry -- the day a summary covers, say. */
  hint?: React.ReactNode;
  defaultOpen?: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Details remember={remember} defaultOpen={defaultOpen} className={cn('group/fold', className)}>
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
    </Details>
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
  fold = false,
  remember,
  children,
  className,
}: {
  title?: React.ReactNode;
  action?: React.ReactNode;
  /** With `fold`, keep the fold in this browser under this key. */
  remember?: string;
  /**
   * Folds the group away by its heading, open to begin with. The action stays
   * opposite the heading rather than going inside the summary, because a form
   * is not allowed in one, and it stays usable while the group is shut.
   */
  fold?: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  if (fold && title) {
    return (
      <section className={cn('relative', className)}>
        <Details remember={remember} defaultOpen className="group/grp space-y-2">
          <summary
            className={cn(
              'press flex cursor-pointer list-none items-center gap-1.5 rounded-control',
              'focus-visible:outline-2 focus-visible:outline-offset-2',
              '[&::-webkit-details-marker]:hidden',
              action ? 'pr-32' : undefined,
            )}
          >
            <ChevronRight
              aria-hidden
              strokeWidth={2}
              className="size-3.5 shrink-0 text-ink-ghost transition-transform duration-150 group-open/grp:rotate-90"
            />
            <h3 className="text-small font-semibold text-ink-muted">{title}</h3>
          </summary>
          {children}
        </Details>
        {action && <div className="absolute top-0 right-0">{action}</div>}
      </section>
    );
  }

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
