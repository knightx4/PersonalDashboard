import { ReadingPageSkeleton } from '@/components/ui/skeleton';

/**
 * Every page in this area without a loading screen of its own shows this: a
 * header and a column of rows, the shape most of them draw.
 */
export default function Loading() {
  return <ReadingPageSkeleton />;
}
