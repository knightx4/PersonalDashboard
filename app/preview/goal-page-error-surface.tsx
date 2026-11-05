'use client';

import { RouteError } from '@/components/ui/route-error';

const failure = Object.assign(new Error('Reading the goal failed'), { digest: '2778041' });

/** A goal's page when a read failed, on any tab (plan #2778.4): the goal's own error page. */
export function GoalPageErrorSurface() {
  return (
    <RouteError
      what="this goal"
      error={failure}
      reset={() => {}}
      backHref="/goals"
      backLabel="Back to your goals"
    />
  );
}
