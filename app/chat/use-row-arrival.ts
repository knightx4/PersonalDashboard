'use client';

import { useLayoutEffect, useRef } from 'react';
import { prefersReducedMotion } from '@/components/motion/reduced';
import { EASE, MOTION_MS } from '@/lib/motion';

/**
 * The moment "A text that arrives first" (plan #2748.10), on the People list.
 * When the rows are redrawn with a thread that has a newer text, its row
 * leaves its place, the rows it passes move down one place each, and it
 * arrives at the top with its preview line changed to the new words and, if
 * the text is unread, the dot landing with a little give. The list only
 * jumped before. The row takes its turn rather than riding over the others,
 * so every row stays whole in every frame (plan #2854.6).
 *
 * It reads each row's place before and after the redraw (a FLIP), so it
 * moves whatever order the server drew. Rows are found by `data-person-row`,
 * the preview by `data-person-preview` and the dot by `data-person-unread`.
 * Under reduced motion nothing moves; the row is simply where it now belongs.
 */

/** How long the row that gained a text takes to fade from its old place, and how long the rows it passed wait before they move. */
const LEAVE_MS = MOTION_MS.instant;
const PASSED_DELAY_MS = 50;

/** A copy of the row at its old place, fading out, so the place is not empty while the others move. */
function leave(root: HTMLElement, el: HTMLElement, top: number) {
  const ghost = el.cloneNode(true) as HTMLElement;
  for (const node of [ghost, ...ghost.querySelectorAll<HTMLElement>('*')]) {
    for (const name of node.getAttributeNames()) if (name.startsWith('data-person')) node.removeAttribute(name);
  }
  ghost.setAttribute('aria-hidden', 'true');
  ghost.inert = true;
  Object.assign(ghost.style, { position: 'absolute', top: `${top}px`, left: `${el.getBoundingClientRect().left - root.getBoundingClientRect().left + root.scrollLeft}px`, width: `${el.getBoundingClientRect().width}px`, pointerEvents: 'none' });
  const was = root.style.position;
  if (getComputedStyle(root).position === 'static') root.style.position = 'relative';
  root.appendChild(ghost);
  const done = () => {
    ghost.remove();
    root.style.position = was;
  };
  const run = ghost.animate([{ opacity: 1 }, { opacity: 0 }], { duration: LEAVE_MS, easing: EASE.sway, fill: 'forwards' });
  run.finished.then(done).catch(done);
}

type Seen = { top: number; at: string | null; unread: boolean };

export function useRowArrival(
  list: React.RefObject<HTMLElement | null>,
  rows: readonly { id: string; unread: boolean; last: { at: string } | null }[],
) {
  const seen = useRef<Map<string, Seen>>(new Map());

  useLayoutEffect(() => {
    const root = list.current;
    if (!root) return;
    const before = seen.current;
    const next = new Map<string, Seen>();
    const move = !prefersReducedMotion();
    const found: { row: (typeof rows)[number]; el: HTMLElement; top: number; at: string | null; was: Seen | undefined }[] = [];
    for (const row of rows) {
      const el = root.querySelector<HTMLElement>(`[data-person-row="${CSS.escape(row.id)}"]`);
      if (!el) continue;
      // Within the list, so scrolling it between two redraws is not a move.
      const top = el.getBoundingClientRect().top - root.getBoundingClientRect().top + root.scrollTop;
      const at = row.last?.at ?? null;
      next.set(row.id, { top, at, unread: row.unread });
      found.push({ row, el, top, at, was: before.get(row.id) });
    }
    const animate = move && found.every((f) => typeof f.el.animate === 'function');
    // A row that gained a text does not ride over the others: it fades out at its
    // old place and in at the top while the rows it passed slide down one place each.
    // Rows never cross, so none covers another and none is cut off.
    const risen = (f: (typeof found)[number]) => Boolean(f.was) && f.at !== f.was!.at && Math.abs(f.was!.top - f.top) > 1;
    const anyRisen = found.some(risen);
    for (const f of found) {
      const { row, el, top, at, was } = f;
      if (!was || !animate) continue;
      const dy = was.top - top;
      let arrive = 0;
      if (risen(f)) {
        // A copy stays at the old place and fades out while the real row, already at the
        // top, fades in as the rows it passed clear the way.
        leave(root, el, was.top);
        arrive = LEAVE_MS;
        const total = PASSED_DELAY_MS + MOTION_MS.move;
        el.animate(
          [
            { opacity: 0, offset: 0 },
            { opacity: 0, offset: LEAVE_MS / total },
            { opacity: 1, offset: 1 },
          ],
          { duration: total, easing: EASE.sway },
        );
      } else if (Math.abs(dy) > 1) {
        // The rows it passes wait for its place to clear, then move down one place each.
        el.animate([{ transform: `translateY(${dy}px)` }, { transform: 'none' }], {
          duration: MOTION_MS.move,
          easing: EASE.outSoft,
          delay: anyRisen ? PASSED_DELAY_MS : 0,
          fill: 'backwards',
        });
      }
      if (at !== was.at) {
        el.querySelector<HTMLElement>('[data-person-preview]')?.animate(
          [{ opacity: 0, transform: 'translateY(0.25rem)' }, { opacity: 1, transform: 'none' }],
          { duration: MOTION_MS.move, easing: EASE.outSoft, delay: arrive, fill: 'backwards' },
        );
      }
      if (row.unread && (!was.unread || at !== was.at)) {
        el.querySelector<HTMLElement>('[data-person-unread]')?.animate(
          [{ opacity: 0, transform: 'scale(0.2)' }, { opacity: 1, transform: 'none' }],
          { duration: MOTION_MS.move, easing: EASE.spring, delay: arrive, fill: 'backwards' },
        );
      }
    }
    seen.current = next;
  }, [list, rows]);
}
