'use client';

import { useEffect, useRef } from 'react';

/**
 * One interaction model per filter surface.
 *
 * Inventory mixed two: the rail's filters applied the moment you clicked
 * them, while the sort and grouping selects sat there doing nothing until you
 * found the Apply button. Same page, same job, two rules.
 *
 * This makes the selects behave like the rail. The Apply button stays in the
 * markup and is hidden once this mounts, so the form still works with
 * JavaScript off -- which is the whole reason these are GET forms.
 */
export function SubmitOnChange() {
  const anchor = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const form = anchor.current?.closest('form');
    if (!form) return;

    form.dataset.autoSubmit = 'on';

    function onChange(event: Event) {
      const target = event.target as HTMLElement;
      // Text inputs submit on Enter, as they always did. Auto-submitting on
      // every keystroke would put one navigation per character between the
      // user and the page they came from.
      if (target instanceof HTMLSelectElement) form?.requestSubmit();
    }

    form.addEventListener('change', onChange);
    return () => {
      form.removeEventListener('change', onChange);
      delete form.dataset.autoSubmit;
    };
  }, []);

  return <span ref={anchor} hidden />;
}
