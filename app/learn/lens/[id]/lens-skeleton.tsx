import { PageColumn } from '@/components/shell/page-width';
import { cardVariants } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/cn';

/**
 * A lens while it loads, in the page's own order so nothing jumps when it
 * lands: the title, the facts, the bar and bands, then the topics.
 */
export function LensSkeleton() {
  return (
    <PageColumn>
      <Skeleton className="mb-2 h-3 w-40" />
      <Skeleton className="mb-4 h-5 w-56" />
      <div className={cn(cardVariants(), 'mb-6 grid grid-cols-2 gap-x-4 gap-y-3 px-3 py-3 sm:grid-cols-4')}>
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="space-y-1.5">
            <Skeleton className="h-2.5 w-14" />
            <Skeleton className="h-3.5 w-20" />
          </div>
        ))}
      </div>
      <div className={cn(cardVariants(), 'mb-6 space-y-3 px-3 py-3')}>
        <Skeleton className="h-3.5 w-48" />
        <Skeleton className="h-2 w-full" />
        <div className="grid grid-cols-4 gap-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-6 w-full" />
          ))}
        </div>
      </div>
      <Skeleton className="mb-2 h-3.5 w-16" />
      <div className={cn(cardVariants(), 'divide-y divide-border overflow-hidden')}>
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="space-y-2 px-3 py-3">
            <Skeleton className="h-3.5 w-2/5" />
            <Skeleton className="h-1.5 w-full" />
          </div>
        ))}
      </div>
    </PageColumn>
  );
}
