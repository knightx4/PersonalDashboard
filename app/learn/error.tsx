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
      what="your learning"
      error={error}
      reset={reset}
      backHref="/learn/now"
      backLabel="Back to Now"
    />
  );
}
