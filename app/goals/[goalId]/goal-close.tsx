'use client';

import { useEffect, useState } from 'react';
import { Disclosure } from '@/components/ui/disclosure';
import { useChangedWhileWatched, useReducedMotion } from '@/components/ui/motion';
import { StatusGlyph, StatusRing } from '@/components/ui/status-glyph';
import { cn } from '@/lib/cn';
import type { StatusGlyph as GlyphName } from '@/lib/status-glyphs';

/**
 * A goal closing on its page (plan #1341): its hexagon completes with one
 * ring leaving it in the workspace accent, and its steps fold into one line
 * under the heading. Both play only for a close made while you watch; a page
 * loaded with the goal already closed draws the solid hexagon and the folded
 * line at once, and so does a close under reduced motion.
 */

/** The ring's 600ms, as in app/globals.css. */
export const GOAL_RING_MS = 600;
/** When the fold has finished: its 450ms wait for the ring and its own 300ms. */
export const GOAL_FOLD_DONE_MS = 750;

/** The goal's hexagon beside its title. */
export function GoalGlyph({
  glyph,
  label,
  closed,
  size = 20,
}: {
  glyph: GlyphName;
  label: string;
  closed: boolean;
  size?: number;
}) {
  const changed = useChangedWhileWatched(closed);
  const reduceMotion = useReducedMotion();
  const ring = closed && changed && !reduceMotion;
  return (
    <span className="relative inline-flex shrink-0">
      <StatusGlyph glyph={glyph} label={label} size={size} className={closed ? 'text-ink' : 'text-ink-muted'} />
      {/* Mounted with the close, so the keyframes play once; unmounted on a
          reopen, so closing again plays it again. */}
      {ring && <StatusRing size={size} className="goal-ring absolute inset-0 text-accent" />}
    </span>
  );
}

/**
 * The goal's steps, folded into one line once the goal is closed. A close
 * made on screen first plays the fold on the steps as they stand, then puts
 * the line in their place.
 */
export function GoalStepsFold({
  closed,
  meta,
  children,
}: {
  closed: boolean;
  /** What the folded line says about the steps in it: "8 of 9 steps done". */
  meta?: string;
  children: React.ReactNode;
}) {
  const changed = useChangedWhileWatched(closed);
  const reduceMotion = useReducedMotion();
  const [folded, setFolded] = useState(false);
  // A reopen puts the steps back at once, and a second close folds again.
  if (!closed && folded) setFolded(false);
  const folding = closed && changed && !reduceMotion && !folded;

  useEffect(() => {
    if (!folding) return;
    const timer = window.setTimeout(() => setFolded(true), GOAL_FOLD_DONE_MS);
    return () => window.clearTimeout(timer);
  }, [folding]);

  if (closed && !folding) {
    return (
      <Disclosure title="Steps" meta={meta} className="px-1">
        <div className="pt-2">{children}</div>
      </Disclosure>
    );
  }
  return <div className={cn(folding && 'goal-fold')}>{children}</div>;
}
