import Link from 'next/link';
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
  seed,
  className,
  children,
}: {
  icon?: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  title: string;
  description: string;
  action?: { label: string; href: string };
  secondaryAction?: { label: string; href: string };
  tone?: 'empty' | 'finished';
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

  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center px-6 text-center',
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
      <p className="mt-1.5 max-w-sm text-body leading-relaxed text-ink-muted">{description}</p>
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
        <div className="mt-3 flex flex-wrap items-center justify-center gap-2">{children}</div>
      )}
    </div>
  );
}
