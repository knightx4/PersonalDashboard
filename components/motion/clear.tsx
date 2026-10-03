'use client';

/**
 * Clear, one of the three shared motion pieces (plan #1550): an item leaving
 * and, when it was a list's last, the day's sigil drawing in.
 *
 * The leaving is a puff at the point the item left: a few soft circles spread
 * out from it and fade (`puffAt`). Capture plays it at the input as an item is
 * filed, just before the chip travels (sendToPlace in ./place.ts). It is
 * chrome, so it never holds anything up; the promise resolves once the puff
 * has been removed, and at once when nothing is drawn. The animation is CSS,
 * `@keyframes puff` and the `puff` utility in app/globals.css, which also
 * hides it under prefers-reduced-motion. This file places the circles in a
 * fixed, pointer-less, aria-hidden element on <body>, gives each its drift,
 * and removes the element when the keyframes are done. It checks reduced
 * motion itself as well, so nothing is appended at all.
 *
 * The sigil is QueueCleared, below, round the list.
 */

import { useEffect, useState } from 'react';
import { cn } from '@/lib/cn';
import { MOTION_MS } from '@/lib/motion';
import { useChangedWhileWatched, useReducedMotion } from '@/components/ui/motion';
import { sigilDrawMs } from '@/components/ui/sigil';
import { prefersReducedMotion } from './reduced';

/** The `puff` utility's duration in app/globals.css: one move. */
export const PUFF_MS = MOTION_MS.move;

/** How many circles, and how far each one drifts from the point. */
const PUFF_DOTS = 5;
const PUFF_RADIUS_PX = 18;

/** A viewport point, an element (its centre, read now), or a rect taken earlier. */
export type PuffPoint = { x: number; y: number } | Element | DOMRectReadOnly;

/**
 * Where each of `count` circles drifts to, spread evenly round the point,
 * starting straight up, rounded to whole pixels.
 */
export function puffOffsets(
  count = PUFF_DOTS,
  radius = PUFF_RADIUS_PX,
): { dx: number; dy: number }[] {
  return Array.from({ length: count }, (_, i) => {
    const angle = -Math.PI / 2 + (i * 2 * Math.PI) / count;
    return {
      dx: Math.round(Math.cos(angle) * radius),
      dy: Math.round(Math.sin(angle) * radius),
    };
  });
}

/**
 * The viewport point a puff starts from: the point itself, or the centre of
 * the element or rect. Null for an element or rect with no size, which is
 * hidden or unmounted.
 */
export function puffOrigin(point: PuffPoint): { x: number; y: number } | null {
  if ('getBoundingClientRect' in point || 'width' in point) {
    const rect = 'getBoundingClientRect' in point ? point.getBoundingClientRect() : point;
    if (!rect.width || !rect.height) return null;
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  }
  return { x: point.x, y: point.y };
}

const PUFF_CLASS = 'pointer-events-none fixed z-toast h-0 w-0';

/**
 * Play a puff at `point`. Resolves once it has been removed. Resolves at
 * once, drawing nothing, under reduced motion, outside a browser, or when
 * the element or rect has no size.
 */
export function puffAt(point: PuffPoint): Promise<void> {
  if (typeof window === 'undefined' || typeof document === 'undefined') return Promise.resolve();
  if (prefersReducedMotion()) return Promise.resolve();

  const origin = puffOrigin(point);
  if (!origin) return Promise.resolve();

  const puff = document.createElement('span');
  puff.setAttribute('aria-hidden', 'true');
  puff.className = PUFF_CLASS;
  puff.style.left = `${Math.round(origin.x)}px`;
  puff.style.top = `${Math.round(origin.y)}px`;

  for (const { dx, dy } of puffOffsets()) {
    const dot = document.createElement('span');
    dot.className = 'puff';
    dot.style.setProperty('--puff-dx', `${dx}px`);
    dot.style.setProperty('--puff-dy', `${dy}px`);
    puff.appendChild(dot);
  }
  document.body.appendChild(puff);

  // A timer rather than animationend: it fires whether or not the keyframes
  // ran, so the element never outlives the puff.
  return new Promise((resolve) => {
    setTimeout(() => {
      puff.remove();
      resolve();
    }, PUFF_MS + 40);
  });
}

/** The longest a sigil takes to draw in: fourteen cells, the most it has. */
export const QUEUE_CLEARED_MS = sigilDrawMs(14);

/**
 * The wrapper round a worked list that draws the day's sigil in when the list
 * is cleared on screen (plan #1340). Put it round both the list and the
 * finished EmptyState that replaces it, so it stays mounted while the last
 * item goes: that is how it can tell a clear made while you watch from a page
 * that loaded already empty, which shows the sigil at once. Under reduced
 * motion the sigil is simply there.
 *
 * It lays nothing out (`display: contents`), so wrapping a list changes none
 * of its spacing. Key it by whatever narrows the list -- a filter, a topic, a
 * search -- so that switching to a view that happens to be empty is a new list
 * rather than a cleared one.
 */
export function QueueCleared({
  cleared,
  children,
}: {
  /** True when the list is empty because it has been worked. */
  cleared: boolean;
  children: React.ReactNode;
}) {
  const changed = useChangedWhileWatched(cleared);
  const reduceMotion = useReducedMotion();
  const [drawn, setDrawn] = useState(false);
  // An item coming back resets it, so clearing the list again draws it again.
  if (!cleared && drawn) setDrawn(false);
  const drawing = cleared && changed && !reduceMotion && !drawn;

  useEffect(() => {
    if (!drawing) return;
    const timer = window.setTimeout(() => setDrawn(true), QUEUE_CLEARED_MS);
    return () => window.clearTimeout(timer);
  }, [drawing]);

  return <div className={cn('contents', drawing && 'sigil-draw-in')}>{children}</div>;
}
