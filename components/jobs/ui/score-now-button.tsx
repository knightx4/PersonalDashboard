'use client';

import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { scoreLeads } from '@/app/jobs/(app)/find/recommend-actions';
import { DashAction } from '@/components/ui/dash-action';
import { useToast } from '@/components/ui/toast';

/**
 * Score now: fit and the chance of an interview for every lead not scored
 * yet, on Find's recommended roles and in the pipeline, without waiting for
 * the daily run. `unscored` is how many leads on the page have no scores; it
 * prices the hint, and the button is not drawn when there are none.
 */
export function ScoreNowButton({ unscored, className }: { unscored: number; className?: string }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  const toast = useToast();
  if (unscored === 0 && !pending) return null;

  const press = () =>
    start(async () => {
      const result = await scoreLeads();
      toast({ text: result.error ?? result.message ?? 'Scored.' });
      router.refresh();
    });

  return (
    <DashAction
      type="button"
      size="sm"
      variant="secondary"
      pending={pending}
      onClick={press}
      paid="app/jobs/(app)/find/recommend-actions.ts#scoreLeads"
      what="Cost of scoring the leads not scored yet"
      count={unscored}
      align="end"
      wrapperClassName={className ?? 'shrink-0'}
    >
      {pending ? 'Scoring…' : 'Score now'}
    </DashAction>
  );
}
