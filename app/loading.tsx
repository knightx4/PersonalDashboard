import { ReadingPageSkeleton } from '@/components/ui/skeleton';

/**
 * The fallback for every page without a loading screen of its own.
 *
 * A folder's `loading.tsx` only shows once the layouts above it have drawn, and
 * the Dev, Learn, News and Goals layouts each read the database first. So
 * opening one of those areas from elsewhere left the old page on screen with
 * no sign of anything happening. This one sits under the root layout alone, so
 * it shows the moment a tab is pressed. The areas' own screens take over once
 * their layouts have drawn.
 */
export default function Loading() {
  return (
    <div className="px-4 py-6 sm:px-6">
      <ReadingPageSkeleton />
    </div>
  );
}
