import { Card } from '@/components/ui/card';
import { PageHeaderSkeleton, RowsSkeleton, Skeleton } from '@/components/ui/skeleton';

/** The inbox's shape while it loads: the header, the four counts, then the rows. */
export default function Loading() {
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeaderSkeleton action={false} />

      <Card padding="dense" className="grid grid-cols-2 gap-1 sm:grid-cols-4">
        {[0, 1, 2, 3].map((cell) => (
          <div key={cell} className="space-y-1.5 p-2">
            <Skeleton className="h-5 w-6" />
            <Skeleton className="h-3.5 w-20" />
          </div>
        ))}
      </Card>

      <RowsSkeleton rows={5} />
    </div>
  );
}
