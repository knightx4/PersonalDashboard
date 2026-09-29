import { ReadingPageSkeleton } from '@/components/ui/skeleton';

/**
 * Opening a subject from inside Learn. The loading screen under /learn only
 * shows when arriving from another area, so this segment needs its own.
 */
export default function Loading() {
  return <ReadingPageSkeleton />;
}
