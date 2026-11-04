import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

/**
 * The monthly review while it loads (plan #2593.8.3), in the closed review's
 * shape: Dash's mark, the month and the one line of its opening.
 */
export function MonthReviewSkeleton() {
  return (
    <Card
      padding="standard"
      className="mb-6 flex items-start gap-3"
      aria-busy="true"
      aria-label="Loading the monthly review"
    >
      <Skeleton className="size-6 shrink-0 rounded-full" />
      <div className="min-w-0 flex-1 space-y-2 pt-0.5">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-4 w-full max-w-md" />
      </div>
    </Card>
  );
}
