import Link from '@/components/ui/link';
import { cn } from '@/lib/cn';
import { buttonVariants } from './button';
import { Sigil } from './sigil';

/**
 * Every section needs a real empty state, because a new account starts empty on
 * all five. Each one says what will fill it and offers the action that does so
 * -- an empty box with "nothing here" teaches the user nothing and gives them
 * nowhere to go.
 *
 * Two kinds of empty, and they must not look alike:
 *
 *   `empty` -- nothing yet. The page is waiting for the first thing, so it
 *   says what will fill it and offers the action that does. The dashed border
 *   is a placeholder's border: this is where something will go.
 *
 *   `finished` -- nothing left. The queue is worked, the list is clear, the
 *   week has nothing with a clock on it. That is an achievement rather than
 *   an absence, so it gets the quiet-day sigil in the workspace accent, no
 *   box, and no call to action, because the action is to go and do something
 *   else. Pass a `seed` (the account and the day) so the mark is yours and
 *   today's.
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  secondaryAction,
  tone = 'empty',
  align = 'center',
  size = 'page',
  titleAs: TitleTag = 'p',
  seed,
  className,
  children,
}: {
  icon?: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  title: string;
  /** Required at page size; a box or an inline line can go without. */
  description?: string;
  action?: { label: string; href: string };
  secondaryAction?: { label: string; href: string };
  tone?: 'empty' | 'finished';
  /** `start` for an explanation long enough to be read: a shared left edge. */
  align?: 'center' | 'start';
  /**
   * `page` is the whole page or panel empty. `box` is one empty section of a
   * page: the same dashed placeholder, smaller, at ui size. `inline` is an
   * empty list inside a card: one muted line with its action beside it.
   * The hand-written dashed cards these replaced mostly set `border-dashed`
   * without a border width, so their outline never drew.
   */
  size?: 'page' | 'box' | 'inline';
  /** The title's element at box size, when the empty section is one a heading names. */
  titleAs?: 'p' | 'h2' | 'h3';
  /** For `finished`: what the sigil is drawn from. Falls back to the title. */
  seed?: string;
  className?: string;
  /**
   * An action this component cannot express as a link -- one that opens a
   * compose surface on the page you are already on. Sits under the links,
   * quieter than them, because the link is still the primary offer.
   */
  children?: React.ReactNode;
}) {
  const finished = tone === 'finished';
  const start = align === 'start';

  if (size === 'inline') {
    return (
      <div className={cn('flex flex-wrap items-baseline gap-x-3 gap-y-1 py-1 text-ui text-ink-muted', className)}>
        <p>{title}</p>
        {action && (
          <Link href={action.href} className={buttonVariants({ variant: 'link', size: 'sm' })}>
            {action.label}
          </Link>
        )}
        {children}
      </div>
    );
  }

  if (size === 'box') {
    return (
      <div
        className={cn(
          'sheet flex flex-col rounded-card border border-dashed bg-surface px-4 py-8',
          start ? 'items-start text-left' : 'items-center text-center',
          className,
        )}
      >
        <TitleTag className="text-ui font-medium text-ink">{title}</TitleTag>
        {description && <p className="mt-1 max-w-sm text-small text-ink-muted">{description}</p>}
        {(action || children) && (
          <div className={cn('mt-3 flex flex-wrap items-center gap-2', start ? 'justify-start' : 'justify-center')}>
            {action && (
              <Link href={action.href} className={buttonVariants({ variant: 'secondary', size: 'sm' })}>
                {action.label}
              </Link>
            )}
            {children}
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      className={cn(
        'flex flex-col justify-center px-6',
        start ? 'items-start text-left' : 'items-center text-center',
        finished ? 'py-14' : 'sheet rounded-card border border-dashed bg-surface py-16',
        className,
      )}
    >
      {finished ? (
        <Sigil seed={seed ?? title} size={64} className="mb-5 text-accent" />
      ) : (
        Icon && (
          <div className="mb-4 flex size-12 items-center justify-center rounded-full bg-accent-tint">
            <Icon className="size-5 text-accent" strokeWidth={1.75} />
          </div>
        )
      )}
      <h3
        className={cn(
          'font-semibold text-ink',
          finished ? 'font-display text-title tracking-tight' : 'text-body',
        )}
      >
        {title}
      </h3>
      {description && <p className="mt-1.5 max-w-sm text-body leading-relaxed text-ink-muted">{description}</p>}
      {(action || secondaryAction) && (
        <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
          {action && (
            <Link
              href={action.href}
              className={buttonVariants({ variant: finished ? 'secondary' : 'primary' })}
            >
              {action.label}
            </Link>
          )}
          {secondaryAction && (
            <Link
              href={secondaryAction.href}
              className={buttonVariants({ variant: finished ? 'ghost' : 'secondary' })}
            >
              {secondaryAction.label}
            </Link>
          )}
        </div>
      )}
      {children && (
        <div
          className={cn(
            'mt-3 flex flex-wrap items-center gap-2',
            start ? 'justify-start' : 'justify-center',
          )}
        >
          {children}
        </div>
      )}
    </div>
  );
}
