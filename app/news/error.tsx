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
      what="your news"
      error={error}
      reset={reset}
      backHref="/news"
      backLabel="Back to Quick read"
    />
  );
}
