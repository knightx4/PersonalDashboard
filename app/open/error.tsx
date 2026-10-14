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
      what="this link"
      error={error}
      reset={reset}
      backHref="/home"
      backLabel="Back to Home"
    />
  );
}
