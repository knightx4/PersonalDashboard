'use client';

import { RouteError } from '@/components/ui/route-error';

/** A goal's page that could not be drawn, on any tab (plan #2778.4). */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <RouteError
      what="this goal"
      error={error}
      reset={reset}
      backHref="/goals"
      backLabel="Back to your goals"
    />
  );
}
