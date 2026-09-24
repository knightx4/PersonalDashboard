import { Card } from '@/components/ui/card';
import { PageHeaderSkeleton, RowsSkeleton, Skeleton } from '@/components/ui/skeleton';

/**
 * Dash's shape while it loads: the header, the Status card with its two rows,
 * then the lists below it.
 */
export default function Loading() {
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeaderSkeleton action={false} />

      <Card padding="dense" className="space-y-3">
        <Skeleton className="h-4 w-16" />
        <div className="space-y-2">
          <Skeleton className="h-3.5 w-72 max-w-full" />
          <Skeleton className="h-3 w-56 max-w-full" />
        </div>
        <div className="space-y-2 border-t border-border pt-3">
          <Skeleton className="h-3.5 w-48" />
        </div>
      </Card>

      <RowsSkeleton rows={4} />
    </div>
  );
}
