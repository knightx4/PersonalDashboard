import { Card } from '@/components/ui/card';
import { PageHeaderSkeleton, Skeleton } from '@/components/ui/skeleton';

/**
 * The plan's shape while it loads: the header, the overnight card, the summary
 * line, the search box and a few module cards. Without it, pressing the Plan
 * tab left the previous page on screen with no sign anything was happening
 * until the whole plan had rendered.
 */
export default function Loading() {
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeaderSkeleton action={false} />

      <Card padding="dense" className="flex items-center gap-3">
        <Skeleton className="size-8 shrink-0 rounded-[9px]" />
        <div className="min-w-0 flex-1 space-y-2">
          <Skeleton className="h-3.5 w-40" />
          <Skeleton className="h-3 w-64 max-w-full" />
        </div>
        <Skeleton className="h-(--control-h) w-24 rounded-control" />
      </Card>

      <div className="space-y-6">
        <Skeleton className="h-3.5 w-72 max-w-full" />
        <Skeleton className="h-(--control-h) w-full rounded-control" />
      </div>

      <div className="space-y-3">
        {/* ui-ok: card-per-row -- one card per module section, which is what
          * the plan itself draws; the rows inside sit in one divided card. */}
        {[4, 3, 2].map((rows, section) => (
          <Card key={section} padding="none" className="px-3">
            <div className="row-pad flex items-center gap-3">
              <Skeleton className="size-6 shrink-0 rounded-[7px]" />
              <Skeleton className="h-4 w-32" />
            </div>
            <div className="divide-y divide-border border-t border-border">
              {Array.from({ length: rows }).map((_, index) => (
                <div key={index} className="row-pad flex items-center gap-3">
                  <Skeleton className="size-[18px] shrink-0 rounded" />
                  <Skeleton className="h-3.5" style={{ width: `${58 - index * 8}%` }} />
                </div>
              ))}
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
