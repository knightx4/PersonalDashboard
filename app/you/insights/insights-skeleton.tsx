import { PageColumn } from '@/components/shell/page-width';
import { Card } from '@/components/ui/card';
import { PageHeaderSkeleton, Skeleton } from '@/components/ui/skeleton';

/**
 * The Insights tab while its cards load: the header, one card in the shape
 * an insight takes (a claim, then its layers) and the forward row under it.
 */
export function InsightsSkeleton() {
  return (
    <PageColumn>
      <PageHeaderSkeleton />
      <Card padding="standard" className="space-y-4">
        <div className="space-y-2">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-5 w-11/12" />
          <Skeleton className="h-5 w-2/3" />
        </div>
        {[80, 72, 64].map((width) => (
          <div key={width} className="space-y-1.5">
            <Skeleton className="h-3 w-28" />
            <Skeleton className="h-3.5" style={{ width: `${width}%` }} />
          </div>
        ))}
      </Card>
      <Card padding="none" className="mt-3 flex items-center gap-2 px-3 py-2">
        <Skeleton className="h-(--control-h) w-16 rounded-control" />
        <Skeleton className="h-(--control-h) w-20 rounded-control" />
        <Skeleton className="h-(--control-h) w-16 rounded-control" />
        <Skeleton className="ml-auto h-(--control-h) w-20 rounded-control" />
      </Card>
    </PageColumn>
  );
}
