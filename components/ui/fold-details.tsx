'use client';

import { useLayoutEffect, useRef } from 'react';
import { openFor, readFold, rememberFold } from '@/lib/fold-memory';

/**
 * A native `<details>` that comes back the way you left it (plan #1432).
 *
 * The fold primitives in disclosure.tsx and the folding `CardSection` render
 * this when they are given a `remember` key, and a plain `<details>` when they
 * are not. It is still the element itself, so the fold works before the
 * script loads (law 6) and a parent's `has-[>details[open]]` still matches.
 *
 * The kept fold is applied straight to the element after mounting rather than
 * through state: the server cannot know what this browser kept, so it draws the
 * default, and the element keeps its own open state from then on, which is the
 * only way a fold the reader just made cannot be written back over by React on
 * the next render. The vault tree works the same way.
 */
export function FoldDetails({
  remember,
  defaultOpen = false,
  name,
  onToggle,
  className,
  children,
}: {
  /** The key the fold is kept under in this browser, such as `jobs.fold.Closed`. */
  remember: string;
  defaultOpen?: boolean;
  name?: string;
  onToggle?: (open: boolean) => void;
  className?: string;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDetailsElement>(null);
  // A `<details>` created open fires a toggle of its own. Until the kept fold
  // has been applied, that one is ignored, or it would clear what was kept.
  const applied = useRef(false);

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const open = openFor(defaultOpen, readFold(remember));
    if (element.open !== open) element.open = open;
    applied.current = true;
  }, [remember, defaultOpen]);

  return (
    <details
      ref={ref}
      name={name}
      open={defaultOpen}
      onToggle={(event) => {
        const open = event.currentTarget.open;
        if (applied.current) rememberFold(remember, open, defaultOpen);
        onToggle?.(open);
      }}
      className={className}
    >
      {children}
    </details>
  );
}
