import { PageWide } from '@/components/shell/page-width';
import { Card } from '@/components/ui/card';
import { PageHeaderSkeleton, Skeleton } from '@/components/ui/skeleton';

/**
 * The Ask tab while its questions load, in the one column the page takes: the
 * header, the fold's title, one surface with an area's label and two open
 * questions in the shape they take (the question, why Dash asked, the two
 * presses), then the count line at the foot.
 */
export function AskSkeleton() {
  return (
    <PageWide>
      <PageHeaderSkeleton />
      <div className="space-y-3">
        <Skeleton className="h-4 w-36" />
        <Card padding="none">
          <div className="px-4 pt-4">
            <Skeleton className="h-3 w-28" />
          </div>
          {[88, 64].map((width, i) => (
            <div key={width} className={i > 0 ? 'space-y-3 border-t border-border px-4 py-4' : 'space-y-3 px-4 pb-4 pt-2'}>
              <div className="space-y-1.5">
                <Skeleton className="h-4.5" style={{ width: `${width}%` }} />
                <Skeleton className="h-3.5 w-1/2" />
              </div>
              <div className="flex gap-2">
                <Skeleton className="h-(--control-h) w-20 rounded-control" />
                <Skeleton className="h-(--control-h) w-14 rounded-control" />
              </div>
            </div>
          ))}
        </Card>
        <Skeleton className="h-3.5 w-2/3" />
      </div>
    </PageWide>
  );
}
