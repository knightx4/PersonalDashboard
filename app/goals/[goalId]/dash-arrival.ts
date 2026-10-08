'use client';

import { useEffect, useRef } from 'react';
import { settleIn } from '@/components/motion/settle';
import { prefersReducedMotion } from '@/components/motion/reduced';
import { EASE, MOTION_MS } from '@/lib/motion';

/**
 * A step Dash finished, arriving (plan #1561; docs/UI-QUALITY-SPEC.md, Part 8):
 * the first time its row comes into view, the row settles into place under its
 * parent and Dash's mark beside it flashes once. Later visits show the row and
 * the mark as they are.
 *
 * Which steps could arrive comes from the server (lib/goals/dash-arrivals.ts:
 * closed by a Dash run in the last two weeks). Which of those you have seen is
 * kept in this browser, under one key, as the folds are (lib/fold-memory.ts).
 * Where storage cannot be read nothing plays, since without it every visit
 * would look like the first. Under reduced motion the step is marked seen and
 * nothing moves: the row and the mark are simply there.
 */

export const ARRIVED_KEY = 'goals.dash-arrived';

/** The most step ids kept; the oldest go first. Two weeks of closes fits easily. */
const KEEP = 400;

/** The ids already seen, or null when storage cannot be read. */
export function readArrived(): string[] | null {
  try {
    const raw = window.localStorage.getItem(ARRIVED_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return null;
  }
}

/** Record that this step's arrival has been seen. */
export function rememberArrived(id: string): void {
  try {
    const seen = (readArrived() ?? []).filter((other) => other !== id);
    seen.push(id);
    window.localStorage.setItem(ARRIVED_KEY, JSON.stringify(seen.slice(-KEEP)));
  } catch {
    /* Storage blocked: readArrived returns null, so nothing plays again either. */
  }
}

/**
 * The mark's one flash. The mark is 12 pixels across, so the done mark's
 * 1.06 swell (dash-mark-flash in app/globals.css) cannot be seen on a phone:
 * this one swells to half again its size and takes the accent at the peak.
 */
const FLASH_KEYFRAMES: Keyframe[] = [
  { opacity: 0.4, transform: 'scale(0.7)' },
  { opacity: 1, transform: 'scale(1.5)', color: 'var(--color-accent)', offset: 0.5 },
  { opacity: 1, transform: 'scale(1)' },
];

function flashMark(mark: HTMLElement): void {
  if (prefersReducedMotion() || typeof mark.animate !== 'function') return;
  mark.animate(FLASH_KEYFRAMES, { duration: MOTION_MS.move, easing: EASE.outSoft });
}

/**
 * The ref goes on the wrapper round Dash's mark on the step's row. `arrived`
 * is whether the step is one Dash finished lately.
 */
export function useDashArrival(stepId: string, arrived: boolean) {
  const markRef = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!arrived) return;
    const mark = markRef.current;
    const row = mark?.closest('li');
    if (!mark || !row) return;
    const seen = readArrived();
    if (seen === null || seen.includes(stepId)) return;
    const play = () => {
      rememberArrived(stepId);
      if (prefersReducedMotion()) return;
      const opacity = Number(window.getComputedStyle(row).opacity);
      void settleIn(row, { opacity: Number.isFinite(opacity) ? opacity : 1 }).then(() =>
        flashMark(mark),
      );
    };
    if (typeof IntersectionObserver !== 'function') {
      play();
      return;
    }
    // Only once you can see it: a finished step can sit under a closed fold
    // or below the screen.
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      observer.disconnect();
      play();
    });
    observer.observe(row);
    return () => observer.disconnect();
  }, [arrived, stepId]);
  return markRef;
}
