'use client';

import { useLayoutEffect, useRef } from 'react';
import { prefersReducedMotion } from '@/components/motion/reduced';
import { EASE, MOTION_MS } from '@/lib/motion';

/**
 * The moment "A text that arrives first" (plan #2748.10), on the People list.
 * When the rows are redrawn with a thread that has a newer text, its row
 * rises to the top while the rows it passes move down one place, its
 * preview line changes to the new words and, if the text is unread, the dot
 * lands with a little give. The list only jumped before.
 *
 * It reads each row's place before and after the redraw (a FLIP), so it
 * moves whatever order the server drew. Rows are found by `data-person-row`,
 * the preview by `data-person-preview` and the dot by `data-person-unread`.
 * Under reduced motion nothing moves; the row is simply where it now belongs.
 */

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
    for (const row of rows) {
      const el = root.querySelector<HTMLElement>(`[data-person-row="${CSS.escape(row.id)}"]`);
      if (!el) continue;
      // Within the list, so scrolling it between two redraws is not a move.
      const top = el.getBoundingClientRect().top - root.getBoundingClientRect().top + root.scrollTop;
      const at = row.last?.at ?? null;
      next.set(row.id, { top, at, unread: row.unread });
      const was = before.get(row.id);
      if (!was || !move || typeof el.animate !== 'function') continue;
      const dy = was.top - top;
      if (Math.abs(dy) > 1) {
        // The row that gained a text rides over the ones it passes.
        const risen = at !== was.at;
        // It rides over the rows it passes as one solid row, so no two rows' words overlap.
        if (risen) {
          el.style.zIndex = '1';
          el.style.backgroundColor = 'var(--c-surface)';
        }
        const run = el.animate([{ transform: `translateY(${dy}px)` }, { transform: 'none' }], {
          duration: MOTION_MS.move,
          easing: EASE.outSoft,
        });
        const settle = () => {
          el.style.zIndex = '';
          el.style.backgroundColor = '';
        };
        run.finished.then(settle).catch(settle);
      }
      if (at !== was.at) {
        el.querySelector<HTMLElement>('[data-person-preview]')?.animate(
          [{ opacity: 0, transform: 'translateY(0.25rem)' }, { opacity: 1, transform: 'none' }],
          { duration: MOTION_MS.move, easing: EASE.outSoft },
        );
      }
      if (row.unread && (!was.unread || at !== was.at)) {
        el.querySelector<HTMLElement>('[data-person-unread]')?.animate(
          [{ opacity: 0, transform: 'scale(0.2)' }, { opacity: 1, transform: 'none' }],
          { duration: MOTION_MS.move, easing: EASE.spring },
        );
      }
    }
    seen.current = next;
  }, [list, rows]);
}
