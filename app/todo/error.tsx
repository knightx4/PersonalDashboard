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
      what="your list"
      error={error}
      reset={reset}
      backHref="/todo"
      backLabel="Back to the agenda"
    />
  );
}
