'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import { prefersReducedMotion } from '@/components/motion/reduced';
import { cn } from '@/lib/cn';
import { EASE, MOTION_MS } from '@/lib/motion';

/**
 * The concept and what rests on it, drawn as a small map: the concept is a
 * node, and a line runs from it to each concept it unlocks.
 *
 * A known concept is lit: the node and its lines are drawn in the positive
 * colour rather than the border's. The first time you see a concept lit after
 * coming to know it (plan #1562; docs/UI-QUALITY-SPEC.md, Part 8, "A concept
 * known"), the node lights and the lines trace out to each concept below it,
 * once. Later visits show it lit and still.
 *
 * Which concepts can play is the server's call (lib/learn/graph/lit.ts: known
 * in the last two weeks). Which of those you have seen is kept in this
 * browser under one key, as the Goals arrivals are
 * (app/goals/[goalId]/dash-arrival.ts). Where storage cannot be read nothing
 * plays, since without it every visit would look like the first. Under
 * reduced motion the concept is marked seen and is simply lit.
 */

export const LIT_KEY = 'learn.concepts-lit';

/** The most concept ids kept; the oldest go first. */
const KEEP = 400;

/** The ids already seen lit, or null when storage cannot be read. */
export function readLit(): string[] | null {
  try {
    const raw = window.localStorage.getItem(LIT_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return null;
  }
}

export function rememberLit(id: string): void {
  try {
    const seen = (readLit() ?? []).filter((other) => other !== id);
    seen.push(id);
    window.localStorage.setItem(LIT_KEY, JSON.stringify(seen.slice(-KEEP)));
  } catch {
    /* Storage blocked: readLit returns null, so nothing plays again either. */
  }
}

/** The node lighting: it swells past its size and comes back, like the Goals mark's flash. */
const NODE_KEYFRAMES: Keyframe[] = [
  { opacity: 0.3, transform: 'scale(0.5)' },
  { opacity: 1, transform: 'scale(1.4)', offset: 0.5 },
  { opacity: 1, transform: 'scale(1)' },
];

/** Light the node, then trace the rail down and each branch out as the rail reaches it. */
function trace(map: HTMLElement): void {
  if (prefersReducedMotion()) return;
  const node = map.querySelector<HTMLElement>('[data-lit-node]');
  const rail = map.querySelector<HTMLElement>('[data-lit-rail]');
  if (!node || typeof node.animate !== 'function') return;
  node.animate(NODE_KEYFRAMES, { duration: MOTION_MS.move, easing: EASE.outSoft });
  if (!rail) return;
  const start = MOTION_MS.quick;
  rail.animate([{ transform: 'scaleY(0)' }, { transform: 'scaleY(1)' }], {
    duration: MOTION_MS.moment,
    delay: start,
    easing: EASE.outSoft,
    fill: 'backwards',
  });
  const railTop = rail.getBoundingClientRect().top;
  const railHeight = rail.getBoundingClientRect().height || 1;
  for (const branch of Array.from(map.querySelectorAll<HTMLElement>('[data-lit-branch]'))) {
    const reach = Math.min(1, Math.max(0, (branch.getBoundingClientRect().top - railTop) / railHeight));
    branch.animate([{ transform: 'scaleX(0)' }, { transform: 'scaleX(1)' }], {
      duration: MOTION_MS.move,
      delay: start + reach * MOTION_MS.moment,
      easing: EASE.outSoft,
      fill: 'backwards',
    });
  }
}

/**
 * The map. `children` are the concepts that rest on this one, each an `<li>`
 * holding a `<MapBranch />`. `play` is whether this concept was known lately
 * enough for the moment to play.
 */
export function UnlocksMap({
  conceptId,
  name,
  lit,
  play,
  children,
}: {
  conceptId: string;
  name: string;
  lit: boolean;
  play: boolean;
  children: ReactNode;
}) {
  const mapRef = useRef<HTMLDivElement>(null);
  const railRef = useRef<HTMLSpanElement>(null);

  // The rail runs from the middle of the node to the last branch, which only
  // the laid-out page knows, so it is measured, and again when the width
  // changes how the rows wrap.
  useEffect(() => {
    const map = mapRef.current;
    const rail = railRef.current;
    if (!map || !rail) return;
    const fit = () => {
      const node = map.querySelector<HTMLElement>('[data-lit-node]');
      const branches = map.querySelectorAll<HTMLElement>('[data-lit-branch]');
      const last = branches[branches.length - 1];
      if (!node || !last) return;
      const top = map.getBoundingClientRect().top;
      const from = node.getBoundingClientRect();
      const to = last.getBoundingClientRect();
      const start = from.top + from.height / 2 - top;
      rail.style.top = `${start}px`;
      rail.style.height = `${Math.max(0, to.top + to.height - top - start)}px`;
    };
    fit();
    if (typeof ResizeObserver !== 'function') return;
    const observer = new ResizeObserver(fit);
    observer.observe(map);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!lit || !play) return;
    const map = mapRef.current;
    if (!map) return;
    const seen = readLit();
    if (seen === null || seen.includes(conceptId)) return;
    const go = () => {
      rememberLit(conceptId);
      trace(map);
    };
    if (typeof IntersectionObserver !== 'function') {
      go();
      return;
    }
    // Only once you can see it: the section sits well down the page.
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      observer.disconnect();
      go();
    });
    observer.observe(map);
    return () => observer.disconnect();
  }, [conceptId, lit, play]);

  return (
    <div
      ref={mapRef}
      className={cn('relative', lit ? 'text-positive' : 'text-border-strong')}
      data-lit={lit || undefined}
    >
      {/* The rail from the node down to the last branch. A line, not a box. */}
      <span
        ref={railRef}
        data-lit-rail
        aria-hidden
        className="absolute left-[5px] h-0 w-0.5 origin-top rounded-full bg-current"
      />
      <p className="flex items-center gap-2 text-ui text-ink">
        <span
          data-lit-node
          aria-hidden
          className={cn(
            'relative size-3 shrink-0 rounded-full',
            lit ? 'bg-positive ring-4 ring-positive-tint' : 'bg-border-strong',
          )}
        />
        <span className="font-medium">{name}</span>
        {lit && <span className="text-small text-positive">Known</span>}
      </p>
      <ul className="mt-2 space-y-2 pl-6">{children}</ul>
    </div>
  );
}

/** The short line from the rail into one concept's row. Goes first inside its `<li>`. */
export function MapBranch() {
  return (
    <span
      data-lit-branch
      aria-hidden
      className="absolute top-2.5 -left-[19px] h-0.5 w-4 origin-left rounded-full bg-current"
    />
  );
}
