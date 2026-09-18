import { Card } from '@/components/ui/card';
import { PageHeaderSkeleton, Skeleton } from '@/components/ui/skeleton';

/**
 * The agenda's shape while it loads: the header, the add-task bar, and two
 * piles of rows. A generic list skeleton put a bordered list where the add bar
 * sits, so the page jumped when the real one landed.
 */
export default function Loading() {
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeaderSkeleton action={false} />

      {/* The dial, not forty pixels. The bar this stands in for is a text
          control and a button, and both take their height from the density
          variable -- so a skeleton written at a fixed forty was eight taller
          than the thing that replaced it at the default density, and the page
          jumped by exactly that. Which is the one failure this file exists to
          prevent. */}
      <Card padding="dense" className="flex items-center gap-2">
        <Skeleton className="h-(--control-h) flex-1 rounded-control" />
        <Skeleton className="h-(--control-h) w-20 rounded-control" />
      </Card>

      <div className="mt-6 space-y-6">
        {/* ui-ok: card-per-row -- the map is over two piles, not two rows, and
          * the Card inside is padding="none" with divide-y: this is law 13's
          * correct shape, which the rule cannot tell from its opposite. */}
        {[3, 2].map((rows, pile) => (
          <div key={pile}>
            <Skeleton className="h-3.5 w-24" />
            <Card padding="none" className="mt-2 divide-y divide-border px-3">
              {Array.from({ length: rows }).map((_, index) => (
                <div key={index} className="row-pad flex items-start gap-3">
                  <Skeleton className="mt-0.5 size-[18px] shrink-0 rounded" />
                  <div className="min-w-0 flex-1 space-y-2">
                    <Skeleton className="h-3.5" style={{ width: `${62 - index * 9}%` }} />
                    <Skeleton className="h-3 w-1/4" />
                  </div>
                </div>
              ))}
            </Card>
          </div>
        ))}
      </div>
    </div>
  );
}
