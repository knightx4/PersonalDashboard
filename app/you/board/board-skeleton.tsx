import { PageColumn } from '@/components/shell/page-width';
import { Card } from '@/components/ui/card';
import { PageHeaderSkeleton, RowsSkeleton, Skeleton } from '@/components/ui/skeleton';

/** The Board tab's list while it loads: the header with Ask the board, then rows in the shape a question's and a meeting's take. */
export function BoardListSkeleton() {
  return (
    <PageColumn>
      <PageHeaderSkeleton />
      <RowsSkeleton rows={5} />
    </PageColumn>
  );
}

/** One meeting while it loads: the header, the facts, then a disagreement in the shape it takes. */
export function BoardMeetingSkeleton() {
  return (
    <PageColumn className="space-y-6">
      <div>
        <PageHeaderSkeleton action={false} />
        <Card padding="dense" className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
          {[0, 1, 2, 3].map((fact) => (
            <div key={fact} className="space-y-1.5">
              <Skeleton className="h-2.5 w-16" />
              <Skeleton className="h-3.5 w-20" />
            </div>
          ))}
        </Card>
      </div>
      <div className="space-y-2">
        <Skeleton className="h-3.5 w-11/12" />
        <Skeleton className="h-3.5 w-4/5" />
      </div>
      <Card padding="standard" className="space-y-4">
        <Skeleton className="h-5 w-3/4" />
        {[88, 76].map((width) => (
          <div key={width} className="space-y-1.5">
            <Skeleton className="h-3 w-28" />
            <Skeleton className="h-3.5" style={{ width: `${width}%` }} />
            <Skeleton className="h-3.5" style={{ width: `${width - 20}%` }} />
          </div>
        ))}
        <div className="flex flex-wrap gap-2">
          {[0, 1, 2, 3].map((button) => (
            <Skeleton key={button} className="h-(--control-h) w-24 rounded-control" />
          ))}
        </div>
      </Card>
    </PageColumn>
  );
}
