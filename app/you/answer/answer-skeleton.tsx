import { MainRail } from '@/components/patterns/main-rail';
import { Card } from '@/components/ui/card';
import { PageHeaderSkeleton, Skeleton } from '@/components/ui/skeleton';

/**
 * The Answer tab while its questions load: the header, two open questions in
 * the shape they take (the question, why Dash asked, the box and the two
 * presses), and the rail's card beside them.
 */
export function AnswerSkeleton() {
  return (
    <MainRail
      main={
        <>
          <PageHeaderSkeleton />
          <div className="space-y-3">
            <Skeleton className="h-4 w-36" />
            <Card padding="none" className="divide-y divide-border">
              {[88, 64].map((width) => (
                <div key={width} className="space-y-3 px-4 py-4">
                  <div className="space-y-1.5">
                    <Skeleton className="h-4.5" style={{ width: `${width}%` }} />
                    <Skeleton className="h-3.5 w-1/2" />
                  </div>
                  <Skeleton className="h-16 w-full rounded-control" />
                  <div className="flex gap-2">
                    <Skeleton className="h-(--control-h) w-24 rounded-control" />
                    <Skeleton className="h-(--control-h) w-14 rounded-control" />
                  </div>
                </div>
              ))}
            </Card>
          </div>
        </>
      }
      rail={
        <Card padding="standard" className="space-y-2">
          <Skeleton className="h-6 w-10" />
          <Skeleton className="h-3.5 w-full" />
          <Skeleton className="h-3.5 w-3/4" />
        </Card>
      }
    />
  );
}
