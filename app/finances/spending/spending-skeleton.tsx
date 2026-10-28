import { Card } from '@/components/ui/card';
import { PageHeaderSkeleton, RailSkeleton, Skeleton } from '@/components/ui/skeleton';
import { PageWide } from '@/components/shell/page-width';

/**
 * Spending while it loads (plan #2593.7), in the page's own shape: the
 * range rail, the header, the figure's card, the tabs and the month chart,
 * so nothing jumps when the numbers land.
 */
export function SpendingSkeleton() {
  return (
    <PageWide className="flex flex-col gap-6 xl:flex-row">
      <RailSkeleton />
      <div className="min-w-0 flex-1 space-y-4">
        <PageHeaderSkeleton action={false} />
        <Card padding="standard" className="space-y-3">
          <Skeleton className="h-3.5 w-36" />
          <Skeleton className="w-48" style={{ height: '2.75rem' }} />
          <Skeleton className="h-3 w-3/5" />
        </Card>
        <div className="border-b border-border pb-2">
          <Skeleton className="h-4 w-80 max-w-full" />
        </div>
        <Card padding="standard" className="space-y-3">
          <Skeleton className="h-3.5 w-24" />
          <div className="flex h-44 items-end gap-2">
            {[40, 55, 35, 60, 50, 70, 45, 65, 52, 58, 48, 30].map((h, i) => (
              <Skeleton key={i} className="flex-1 rounded-t-control" style={{ height: `${h}%` }} />
            ))}
          </div>
        </Card>
      </div>
    </PageWide>
  );
}
