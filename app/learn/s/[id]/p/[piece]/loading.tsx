import { ReadingPageSkeleton } from '@/components/ui/skeleton';

/**
 * Start, Carry on and the unit's piece links land here. Without a loading
 * screen at this segment the one under /learn never shows for them, and the
 * click looks dead until the piece has loaded.
 */
export default function Loading() {
  return <ReadingPageSkeleton />;
}
