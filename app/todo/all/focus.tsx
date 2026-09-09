'use client';

import { useEffect } from 'react';

/**
 * Scroll to the task the palette sent you to.
 *
 * A task is the one thing in this application with no page of its own, so
 * ⌘K lands here with the row named rather than on a page built to satisfy a
 * search. The highlight is the page's, in CSS; this is only the scroll, which
 * cannot be done from the server.
 *
 * Nothing at all happens without the param, which is the whole contract: this
 * page is exactly what it was before for everybody who did not arrive from the
 * palette.
 */
export function FocusTask({ id }: { id: string }) {
  useEffect(() => {
    if (!id) return;
    const row = document.getElementById(`task-${id}`);
    row?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [id]);

  return null;
}
