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
      what="this page"
      error={error}
      reset={reset}
      backHref="/jobs/today"
      backLabel="Back to this week"
    />
  );
}
