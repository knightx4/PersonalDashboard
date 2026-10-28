import { PageColumn } from '@/components/shell/page-width';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

/** Rows per group in the skeleton: two groups of two, then one of one. */
const GROUPS = [2, 2, 1];

/**
 * The Accounts page while it loads (plan #2593.6), in the loaded page's
 * shape so nothing moves when the data lands: the eyebrow and title with
 * the action beside them, the net worth card with its figure and chart, then
 * the one card of rows with a heading and a total over each group, then the
 * count.
 */
export function AccountsSkeleton() {
  return (
    <PageColumn>
      <div className="mb-5 flex items-end justify-between gap-3">
        <div className="space-y-2">
          <Skeleton className="h-3.5 w-16" />
          <Skeleton className="h-6 w-28" />
        </div>
        <Skeleton className="h-(--control-h) w-28 rounded-control" />
      </div>
      <Card padding="standard" className="mb-6 space-y-3">
        <Skeleton className="h-4 w-20" />
        <Skeleton className="h-14 w-48" />
        <Skeleton className="h-4 w-64 max-w-full" />
        <Skeleton className="mt-4 h-36 w-full" />
        <Skeleton className="h-3.5 w-full max-w-sm" />
      </Card>
      <Card padding="none">
        {GROUPS.map((rows, group) => (
          <div key={group} className="border-b border-border last:border-b-0">
            <div className="card-pad-x flex justify-between pb-2 pt-3">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-3 w-14" />
            </div>
            <div className="divide-y divide-border">
              {Array.from({ length: rows }).map((_, row) => (
                <div key={row} className="card-pad-x row-pad space-y-2">
                  <div className="flex justify-between gap-3">
                    <Skeleton className="h-4 w-44" />
                    <Skeleton className="h-4 w-20" />
                  </div>
                  <Skeleton className="h-3.5 w-32" />
                </div>
              ))}
            </div>
          </div>
        ))}
      </Card>
      <Skeleton className="mt-3 h-3.5 w-20" />
    </PageColumn>
  );
}
