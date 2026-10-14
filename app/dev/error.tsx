'use client';

import { RouteError } from '@/components/ui/route-error';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <RouteError
      what="this Dev page"
      error={error}
      reset={reset}
      backHref="/dev/raised"
      backLabel="Back to Dev"
    />
  );
}
