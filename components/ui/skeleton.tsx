import { cn } from '@/lib/cn';

/**
 * Skeletons, never spinners.
 *
 * A loading state renders the page's real shape -- a header, a rail, a few
 * rows -- so the layout does not jump when the data lands and the eye already
 * knows where to look. A centred spinner tells you nothing except that you are
 * waiting.
 *
 * The shimmer is in globals.css and drops out entirely under
 * prefers-reduced-motion.
 */
export function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLSpanElement>) {
  return <span className={cn('skeleton block', className)} aria-hidden {...props} />;
}

/** The page header: a title, a subtitle, and whatever sits on the right. */
export function PageHeaderSkeleton({ action = true }: { action?: boolean }) {
  return (
    <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
      <div className="space-y-2">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-3.5 w-64" />
      </div>
      {action && <Skeleton className="h-8 w-28 rounded-lg" />}
    </div>
  );
}

/** A bordered list of rows -- the app's most common shape. */
export function RowsSkeleton({ rows = 6, thumb = false }: { rows?: number; thumb?: boolean }) {
  return (
    <div className="divide-y divide-border overflow-hidden rounded-card border border-border bg-surface">
      {Array.from({ length: rows }).map((_, index) => (
        <div key={index} className="flex items-center gap-3 px-3 py-3">
          {thumb && <Skeleton className="size-11 shrink-0 rounded-lg" />}
          <div className="min-w-0 flex-1 space-y-2">
            <Skeleton className="h-3.5" style={{ width: `${58 - index * 4}%` }} />
            <Skeleton className="h-3 w-1/3" />
          </div>
          <Skeleton className="h-3.5 w-16 shrink-0" />
        </div>
      ))}
    </div>
  );
}

export function RailSkeleton() {
  return (
    <div className="hidden w-56 shrink-0 space-y-6 lg:block">
      {Array.from({ length: 3 }).map((_, group) => (
        <div key={group} className="space-y-2">
          <Skeleton className="h-2.5 w-20" />
          {Array.from({ length: 4 }).map((_, item) => (
            <Skeleton key={item} className="h-7 rounded-lg" />
          ))}
        </div>
      ))}
    </div>
  );
}

/** The two-column filter layout: rail plus a list. */
export function ListPageSkeleton({ thumb = false }: { thumb?: boolean }) {
  return (
    <div className="flex flex-col gap-6 lg:flex-row">
      <RailSkeleton />
      <div className="min-w-0 flex-1">
        <PageHeaderSkeleton />
        <RowsSkeleton thumb={thumb} />
      </div>
    </div>
  );
}

/** A single reading column. */
export function ReadingPageSkeleton() {
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeaderSkeleton action={false} />
      <RowsSkeleton rows={5} />
    </div>
  );
}
