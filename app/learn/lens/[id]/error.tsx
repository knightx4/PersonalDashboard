'use client';

import { RouteError } from '@/components/ui/route-error';

/** A lens that could not be read: said, with the way back to Subjects. */
export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <RouteError what="this lens" error={error} reset={reset} backHref="/learn/know" backLabel="Back to Subjects" />;
}
