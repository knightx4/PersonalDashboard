'use client';

import { useLayoutEffect, useRef } from 'react';
import { useChangedWhileWatched, useReducedMotion } from '@/components/ui/motion';
import { StatusRing } from '@/components/ui/status-glyph';

/**
 * The step's status glyph at the top of its own page: the trigger of its
 * status menu, the first in the page, since the step's own row comes before
 * its sub-steps.
 */
export const STEP_GLYPH = 'button[aria-label^="Status of"] svg';

/**
 * A step closing on its own page (plan #1623): one hexagon ring grows out of
 * its status glyph in the workspace accent, the same ring GoalGlyph plays when
 * a goal closes on its page (app/goals/[goalId]/goal-close.tsx). It plays only
 * for a close made while you watch; a page loaded with the step already done
 * shows the solid glyph and nothing more, and so does a close under reduced
 * motion. The finished sub-steps beneath fold as they always do, so there is
 * no second fold here.
 *
 * The glyph is drawn by the plan's shared row, which the goal page and the
 * dev plan use too, so the ring is laid over it from here rather than drawn
 * inside it: placed on the glyph before the first frame is painted.
 */
export function StepCloseRing({
  closed,
  children,
}: {
  /** Whether the step is done. */
  closed: boolean;
  children: React.ReactNode;
}) {
  const changed = useChangedWhileWatched(closed);
  const reduceMotion = useReducedMotion();
  const ring = closed && changed && !reduceMotion;
  const wrapRef = useRef<HTMLDivElement>(null);
  const ringRef = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    if (!ring) return;
    const wrap = wrapRef.current;
    const holder = ringRef.current;
    const glyph = wrap?.querySelector(STEP_GLYPH);
    if (!wrap || !holder || !glyph) return;
    const outer = wrap.getBoundingClientRect();
    const box = glyph.getBoundingClientRect();
    holder.style.left = `${box.left - outer.left}px`;
    holder.style.top = `${box.top - outer.top}px`;
    holder.style.width = `${box.width}px`;
    holder.style.height = `${box.height}px`;
    holder.style.visibility = 'visible';
  }, [ring]);

  return (
    <div ref={wrapRef} className="relative">
      {children}
      {/* Mounted with the close, so the keyframes play once; unmounted on a
          reopen, so closing again plays it again. */}
      {ring && (
        <span
          ref={ringRef}
          data-step-ring=""
          className="pointer-events-none absolute flex"
          style={{ visibility: 'hidden' }}
        >
          <StatusRing className="goal-ring size-full text-accent" />
        </span>
      )}
    </div>
  );
}
