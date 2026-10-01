'use client';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';

/**
 * The hooks a finishing mark is built from (plan #1339): whether the person
 * has asked for reduced motion, whether a value changed while the page was on
 * screen, and a number counting to its new value.
 *
 * A mark plays only for a change made while you watch. A page that loads
 * already finished shows the end state at once, so every hook here starts at
 * the value it is given and moves only when that value changes afterwards.
 */

const REDUCE = '(prefers-reduced-motion: reduce)';

function subscribeReducedMotion(onStoreChange: () => void): () => void {
  const mq = window.matchMedia(REDUCE);
  mq.addEventListener('change', onStoreChange);
  return () => mq.removeEventListener('change', onStoreChange);
}

function getReducedMotionSnapshot(): boolean {
  return window.matchMedia(REDUCE).matches;
}

function getReducedMotionServerSnapshot(): boolean {
  return false;
}

/** Whether the person has asked for reduced motion; false on the server. */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribeReducedMotion,
    getReducedMotionSnapshot,
    getReducedMotionServerSnapshot,
  );
}

/**
 * Whether `value` has changed since this component mounted. False on the
 * first render, so a page loaded in its finished state plays nothing; true
 * from the first render that sees a different value, and true after that.
 * A mark for arriving somewhere is `finished && useChangedWhileWatched(finished)`.
 */
export function useChangedWhileWatched<T>(value: T): boolean {
  const [first] = useState(value);
  const [changed, setChanged] = useState(false);
  if (!changed && !Object.is(value, first)) setChanged(true);
  return changed || !Object.is(value, first);
}

/** ease-out-soft, as near as a cubic gets to --ease-out-soft. */
export function easeOutSoft(t: number): number {
  const clamped = Math.min(1, Math.max(0, t));
  return 1 - Math.pow(1 - clamped, 3);
}

/** The whole number shown `elapsed` ms into a count from `from` to `to`. */
export function countAt(from: number, to: number, elapsed: number, durationMs: number): number {
  if (durationMs <= 0 || elapsed >= durationMs) return to;
  return Math.round(from + (to - from) * easeOutSoft(elapsed / durationMs));
}

/**
 * A number counting to `target` whenever it changes, and landing on it
 * exactly. `from: 'previous'` starts at the target, so a page that loads shows
 * the final value at once and only a change made on screen counts; `from:
 * 'zero'` counts up from nothing on mount, as the dashboard's headline figures
 * do. Under reduced motion it is the target, always.
 */
export function useCountUp(
  target: number,
  { durationMs = 300, from = 'previous' }: { durationMs?: number; from?: 'previous' | 'zero' } = {},
): number {
  const reduceMotion = useReducedMotion();
  const [shown, setShown] = useState(from === 'zero' ? 0 : target);
  const latest = useRef(shown);

  useEffect(() => {
    if (reduceMotion) {
      latest.current = target;
      return;
    }
    const start = latest.current;
    if (start === target) return;
    const began = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const value = countAt(start, target, now - began, durationMs);
      latest.current = value;
      setShown(value);
      if (now - began < durationMs) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target, durationMs, reduceMotion]);

  return reduceMotion ? target : shown;
}
