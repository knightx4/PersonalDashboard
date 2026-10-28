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
      what="your finances"
      error={error}
      reset={reset}
      backHref="/finances/spending"
      backLabel="Back to spending"
    />
  );
}
