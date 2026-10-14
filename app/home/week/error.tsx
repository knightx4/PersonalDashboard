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
      what="your week"
      error={error}
      reset={reset}
      backHref="/home/week"
      backLabel="Back to the week"
    />
  );
}
