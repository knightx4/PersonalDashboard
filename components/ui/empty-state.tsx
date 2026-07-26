import Link from 'next/link';
import { cn } from '@/lib/cn';
import { buttonVariants } from './button';

/**
 * Every section needs a real empty state, because a new account starts empty on
 * all five. Each one says what will fill it and offers the action that does so
 * -- an empty box with "nothing here" teaches the user nothing and gives them
 * nowhere to go.
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  secondaryAction,
  className,
}: {
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  title: string;
  description: string;
  action?: { label: string; href: string };
  secondaryAction?: { label: string; href: string };
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center rounded-card border border-dashed ' +
          'border-border bg-surface px-6 py-16 text-center',
        className,
      )}
    >
      <div className="mb-4 flex size-12 items-center justify-center rounded-full bg-brand-tint">
        <Icon className="size-6 text-brand" strokeWidth={1.75} />
      </div>
      <h3 className="text-base font-semibold text-ink">{title}</h3>
      <p className="mt-1.5 max-w-sm text-sm leading-relaxed text-ink-muted">{description}</p>
      {(action || secondaryAction) && (
        <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
          {action && (
            <Link href={action.href} className={buttonVariants({ variant: 'primary' })}>
              {action.label}
            </Link>
          )}
          {secondaryAction && (
            <Link
              href={secondaryAction.href}
              className={buttonVariants({ variant: 'secondary' })}
            >
              {secondaryAction.label}
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
