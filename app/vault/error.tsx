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
      what="your notes"
      error={error}
      reset={reset}
      backHref="/vault"
      backLabel="Back to all notes"
    />
  );
}
