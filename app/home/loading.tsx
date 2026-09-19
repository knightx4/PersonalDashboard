import { Skeleton } from '@/components/ui/skeleton';
import { cardVariants } from '@/components/ui/card';
import { cn } from '@/lib/cn';

/**
 * The front door's own shape: the masthead, a few brief lines, then the
 * tiles. Not the inner list shape -- this page renders its own shell.
 */
export default function Loading() {
  return (
    <div className="min-h-full">
      <div className="h-14 bg-page" />
      <main className="mx-auto max-w-3xl px-4 py-6 sm:px-6">
        <div className="border-b border-border-strong pb-6 pt-2">
          <Skeleton className="h-3.5 w-28" />
          <Skeleton className="mt-3 h-12 w-80 max-w-full" />
        </div>
        <div className="mt-2 divide-y divide-border">
          {Array.from({ length: 3 }).map((_, index) => (
            <div key={index} className="flex items-center gap-3 py-3.5">
              <Skeleton className="size-6 shrink-0 rounded-[7px]" />
              <Skeleton className="h-4" style={{ width: `${62 - index * 9}%` }} />
            </div>
          ))}
        </div>
        <div className="mt-10 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 5 }).map((_, index) => (
            <div key={index} className={cn(cardVariants({ padding: 'dense' }), 'flex items-center gap-3')}>
              <Skeleton className="size-8 shrink-0 rounded-[9px]" />
              <div className="min-w-0 flex-1 space-y-2">
                <Skeleton className="h-3.5 w-24" />
                <Skeleton className="h-3 w-32" />
              </div>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
