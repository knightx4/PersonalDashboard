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
      what="your questions to Dash"
      error={error}
      reset={reset}
      backHref="/home"
      backLabel="Back to home"
    />
  );
}
