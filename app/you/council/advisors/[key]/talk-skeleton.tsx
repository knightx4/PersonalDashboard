import { Card } from '@/components/ui/card';
import { RowsSkeleton, Skeleton } from '@/components/ui/skeleton';

/** The Talk tab while its talk loads (plan #2581.6): the talk's name, a few turns, the box's opener, then the talks. */
export function AdvisorTalkSkeleton() {
  return (
    <div className="space-y-6" aria-busy>
      <Card padding="dense" className="space-y-3">
        <div className="space-y-1.5">
          <Skeleton className="h-4 w-56 max-w-full" />
          <Skeleton className="h-3 w-28" />
        </div>
        {[80, 92, 64].map((width, i) => (
          <div key={width} className="flex gap-2">
            <Skeleton className={i === 1 ? 'size-5 shrink-0 rounded-pill' : 'size-4 shrink-0 rounded-pill'} />
            <div className="min-w-0 flex-1 space-y-1.5">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-3.5" style={{ width: `${width}%` }} />
              <Skeleton className="h-3.5" style={{ width: `${width - 24}%` }} />
            </div>
          </div>
        ))}
        <Skeleton className="h-(--control-h) w-32 rounded-control" />
      </Card>
      <RowsSkeleton rows={3} />
    </div>
  );
}
