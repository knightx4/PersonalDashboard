import { Skeleton } from '@/components/ui/skeleton';

/**
 * The front door's own shape: a title, then the module tiles. Not the inner
 * list shape -- this page renders its own shell.
 */
export default function Loading() {
  return (
    <div className="min-h-full">
      <div className="h-14 border-b border-border bg-surface" />
      <main className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
        <Skeleton className="h-8 w-32" />
        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          {Array.from({ length: 4 }).map((_, index) => (
            <div
              key={index}
              className="flex items-center gap-4 rounded-card border border-border bg-surface p-5"
            >
              <Skeleton className="size-11 shrink-0 rounded-xl" />
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
