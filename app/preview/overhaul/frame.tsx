import { cn } from '@/lib/cn';

/**
 * One drawing on /preview/overhaul with the line under it that says what it
 * is and where it came from. `source` is the file and line a hand-written
 * copy was taken from, so a reader can check the drawing against the app.
 */
export function Specimen({
  label,
  source,
  children,
  className,
}: {
  label: string;
  source?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <figure className={cn('min-w-0 space-y-2', className)}>
      <div className="flex min-h-8 flex-wrap items-center gap-2">{children}</div>
      <figcaption className="text-small text-ink-muted">
        {label}
        {source && <span className="block break-all font-mono text-micro text-ink-ghost">{source}</span>}
      </figcaption>
    </figure>
  );
}

/** A stack of specimens with even spacing. */
export function Specimens({ children }: { children: React.ReactNode }) {
  return <div className="space-y-5">{children}</div>;
}
