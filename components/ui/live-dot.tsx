import { cn } from '@/lib/cn';

/**
 * The dot that says something is running (accent) or has gone quiet
 * (caution).
 *
 * The dot stays solid and a ring pulses behind it. The copies this replaced
 * used `animate-pulse`, which fades the dot itself, so for part of every
 * second it was nearly invisible and a glance could read it as off. The ring
 * stops under reduced motion; the dot stays. `still` draws the dot alone, for
 * a state that is not live.
 */
export function LiveDot({
  tone = 'accent',
  still = false,
  className,
}: {
  tone?: 'accent' | 'caution' | 'muted';
  still?: boolean;
  className?: string;
}) {
  const fill = tone === 'caution' ? 'bg-caution' : tone === 'muted' ? 'bg-ink-ghost' : 'bg-accent';
  return (
    <span aria-hidden className={cn('relative inline-flex size-2 shrink-0', className)}>
      {!still && <span className={cn('absolute inset-0 rounded-pill opacity-50 motion-safe:animate-ping', fill)} />}
      <span className={cn('relative inline-flex size-2 rounded-pill', fill)} />
    </span>
  );
}
