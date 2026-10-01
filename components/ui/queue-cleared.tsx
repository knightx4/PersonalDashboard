'use client';

import { useEffect, useState } from 'react';
import { cn } from '@/lib/cn';
import { useChangedWhileWatched, useReducedMotion } from './motion';
import { sigilDrawMs } from './sigil';

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
