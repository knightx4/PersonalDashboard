import { PageWide } from '@/components/shell/page-width';
import { Card } from '@/components/ui/card';
import { PageHeaderSkeleton, Skeleton } from '@/components/ui/skeleton';

/**
 * A goal's page while it loads (plan #2778.4), whichever tab is opening,
 * drawn in the Dashboard's shape so nothing moves when it lands: the header,
 * the properties (three facts in a row and All details on a phone, a column
 * from laptop width), the row of four tabs, the strip, the done-when, the
 * tiles, and Dash's card and Recent files beside them from wide laptop width
 * or after the tiles below it.
 */
export function GoalPageSkeleton() {
  return (
    <PageWide className="grid grid-cols-1 gap-x-6 gap-y-4 lg:grid-cols-[minmax(0,1fr)_15rem]">
      <div className="lg:col-start-1 lg:row-start-1">
        <Skeleton className="mb-3 h-3 w-32" />
        <PageHeaderSkeleton />
      </div>
      <Card padding="dense" className="lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:self-start">
        <div className="grid grid-cols-3 gap-3 lg:grid-cols-1">
          {Array.from({ length: 3 }).map((_, index) => (
            <div key={index} className="space-y-1.5">
              <Skeleton className="h-3 w-14" />
              <Skeleton className="h-3.5 w-20" />
            </div>
          ))}
        </div>
        <Skeleton className="mt-3 h-3 w-20 lg:hidden" />
        <div className="hidden space-y-3 pt-3 lg:block">
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="space-y-1.5">
              <Skeleton className="h-3 w-16" />
              <Skeleton className="h-3.5 w-28" />
            </div>
          ))}
        </div>
      </Card>
      <div className="space-y-6 lg:col-start-1 lg:row-start-2">
        <div className="flex gap-6 border-b border-border pb-3">
          {[20, 12, 24, 14].map(
            (
              w /* ui-ok: the skeleton draws the strip and tiles one card each, as the loaded page does */,
            ) => (
              <Skeleton key={w} className="h-3.5" style={{ width: `${w * 4}px` }} />
            ),
          )}
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {Array.from({ length: 3 }).map((_, index) => (
            <Card
              key={index}
              padding="dense"
              className="space-y-2" /* ui-ok: the strip draws one card per slot, Now, Next and Later */
            >
              <Skeleton className="h-3 w-12" />
              <Skeleton className="h-4 w-4/5" />
              <Skeleton className="h-3 w-1/2" />
            </Card>
          ))}
        </div>
        <Card padding="standard" className="space-y-2">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-4 w-1/2" />
        </Card>
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_18rem]">
          <div className="@container min-w-0">
            <div className="grid grid-cols-1 gap-4 @lg:grid-cols-2 @min-[40rem]:grid-cols-3">
              {Array.from({ length: 3 }).map((_, index) => (
                <Card
                  key={index}
                  padding="standard"
                  className="space-y-3" /* ui-ok: each tile is its own card on the loaded page */
                >
                  <Skeleton className="h-3 w-20" />
                  <Skeleton
                    className="h-7 w-28" /* ui-ok: the height of a tile's figure, not a control */
                  />
                  <Skeleton className="h-3 w-3/4" />
                </Card>
              ))}
            </div>
          </div>
          <div className="min-w-0 space-y-4">
            <Card padding="standard" className="space-y-3">
              <Skeleton className="h-4 w-24" />
              <div className="space-y-2 rounded-card bg-sunken/60 px-3 py-2.5">
                <Skeleton className="h-3.5 w-4/5" />
                <Skeleton className="h-3 w-1/2" />
              </div>
              <Skeleton className="h-3 w-3/4" />
              <Skeleton
                className="h-8 w-24 rounded-control" /* ui-ok: the Ask Dash button's place while it loads */
              />
            </Card>
            <Card padding="standard" className="space-y-3">
              <Skeleton className="h-4 w-28" />
              {Array.from({ length: 3 }).map((_, index) => (
                <div key={index} className="flex gap-3">
                  <Skeleton className="size-4 shrink-0" />
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <Skeleton className="h-3.5 w-4/5" />
                    <Skeleton className="h-3 w-1/2" />
                  </div>
                </div>
              ))}
            </Card>
          </div>
        </div>
      </div>
    </PageWide>
  );
}
