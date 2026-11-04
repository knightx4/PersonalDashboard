import { DetailLayout } from '@/components/shell/detail-layout';
import { PageColumn } from '@/components/shell/page-width';
import { Card } from '@/components/ui/card';
import { PageHeaderSkeleton, RowsSkeleton, Skeleton } from '@/components/ui/skeleton';

/** The Advisors tab's list while it loads: the header with Ask the advisors, then rows in the shape a question's and a meeting's take. */
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

/** One advisor's profile while it loads: the large avatar and name, the tabs, then the About card. */
export function AdvisorProfileSkeleton() {
  return (
    <DetailLayout
      header={
        <div className="mb-5 space-y-2">
          <Skeleton className="h-3 w-40" />
          <div className="flex items-center gap-3">
            <Skeleton className="size-24 shrink-0 rounded-pill" />
            <div className="min-w-0 flex-1 space-y-2">
              <Skeleton className="h-6 w-48" />
              <Skeleton className="h-3.5 w-64 max-w-full" />
            </div>
          </div>
        </div>
      }
      properties={
        <div className="grid grid-cols-2 gap-x-4 gap-y-3 lg:grid-cols-1">
          {[0, 1].map((fact) => (
            <div key={fact} className="space-y-1.5">
              <Skeleton className="h-2.5 w-16" />
              <Skeleton className="h-3.5 w-20" />
            </div>
          ))}
        </div>
      }
    >
      <div className="mb-5 flex gap-4 border-b border-border pb-2">
        <Skeleton className="h-4 w-16" />
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-4 w-18" />
      </div>
      <Card padding="standard" className="space-y-4">
        {[92, 84, 70].map((width) => (
          <div key={width} className="space-y-1.5">
            <Skeleton className="h-3 w-28" />
            <Skeleton className="h-3.5" style={{ width: `${width}%` }} />
            <Skeleton className="h-3.5" style={{ width: `${width - 20}%` }} />
          </div>
        ))}
      </Card>
    </DetailLayout>
  );
}
