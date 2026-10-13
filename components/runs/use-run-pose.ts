'use client';

import { useEffect, useRef, useState } from 'react';
import type { RunActivity } from '@/lib/core/run-activities';
import { POSE_HOLD_MS, runMoment, runPose, type RunMoment, type RunPose } from '@/lib/core/run-pose';

/**
 * The pose and moment Dash's mark should show for a run's newest line, with
 * each pose held for at least POSE_HOLD_MS so a burst of lines eases from one
 * to the next instead of flickering. A question takes over at once, because
 * it is waiting on you. Moments are never held back: each line plays its own
 * once, keyed by the line's id.
 */
export function useRunPose(newest: RunActivity | null | undefined): { pose: RunPose; moment: RunMoment | null } {
  const wanted = runPose(newest);
  const [shown, setShown] = useState<RunPose>(wanted);
  const since = useRef(0);
  const same = shown.state === wanted.state && shown.activity === wanted.activity;

  useEffect(() => {
    if (same) return;
    const now = Date.now();
    const wait = wanted.state === 'asking' ? 0 : Math.max(0, since.current + POSE_HOLD_MS - now);
    const timer = window.setTimeout(() => {
      since.current = Date.now();
      setShown(wanted);
    }, wait);
    return () => window.clearTimeout(timer);
    // wanted is rebuilt each render; its two fields are what matter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [same, wanted.state, wanted.activity]);

  return { pose: shown, moment: runMoment(newest) };
}
