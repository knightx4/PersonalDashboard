import { cn } from '@/lib/cn';

/**
 * A number with its label under it: one of several in a row ("23 Applied",
 * "4 Interviews"). Figure is the one number a page is about; Stat is smaller
 * and comes in rows.
 *
 * The number first, then the label, always in that order: the copies this
 * replaced put the label above in some places and below in others, at title
 * size in one and body size in the next. `md` is the display face at title
 * size, `sm` is body size; both tabular and tight.
 */
export function Stat({
  value,
  label,
  size = 'md',
  className,
}: {
  value: React.ReactNode;
  label: React.ReactNode;
  size?: 'sm' | 'md';
  className?: string;
}) {
  return (
    <div className={cn('min-w-0', className)}>
      <p
        className={cn(
          'tabular font-semibold tracking-tight text-ink',
          size === 'md' ? 'font-display text-title' : 'text-body',
        )}
      >
        {value}
      </p>
      <p className="text-small text-ink-muted">{label}</p>
    </div>
  );
}
