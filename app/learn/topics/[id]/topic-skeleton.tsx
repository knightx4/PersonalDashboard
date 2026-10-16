import { PageColumn } from '@/components/shell/page-width';
import { cardVariants } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/cn';

/**
 * A topic page while it loads, in the page's own order so nothing jumps when
 * it lands: the title, the facts, what it covers, then the ten levels.
 */
export function TopicSkeleton() {
  return (
    <PageColumn>
      <Skeleton className="mb-2 h-3 w-48" />
      <Skeleton className="mb-4 h-5 w-56" />
      <div className={cn(cardVariants(), 'mb-4 grid grid-cols-2 gap-x-6 gap-y-3 px-3 py-3 sm:grid-cols-4')}>
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="space-y-1.5">
            <Skeleton className="h-2.5 w-16" />
            <Skeleton className="h-3.5 w-20" />
          </div>
        ))}
      </div>
      <div className={cn(cardVariants(), 'mb-5 space-y-2 px-3 py-3')}>
        <Skeleton className="h-3.5 w-full" />
        <Skeleton className="h-3.5 w-2/3" />
      </div>
      <Skeleton className="mb-2 h-3.5 w-24" />
      <div className={cn(cardVariants(), 'divide-y divide-border overflow-hidden')}>
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="space-y-2 px-3 py-3">
            <Skeleton className="h-3 w-28" />
            <Skeleton className="h-3.5 w-5/6" />
            <Skeleton className="h-3.5 w-3/5" />
          </div>
        ))}
      </div>
    </PageColumn>
  );
}
