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
 *
 * `defaultOpen="wide"` opens from laptop width and shuts on a phone (plan
 * #1937.8): the server draws it open, so the page reads in full before its
 * script loads, and a phone shuts it as it mounts. A fold left the other way
 * is kept as any other is. A link to an anchor on or inside the fold, such as
 * Home's #watching, opens it whatever its default.
 */

/** The width a `defaultOpen="wide"` fold opens from: the rail's lg. */
export const FOLD_WIDE = '(min-width: 64rem)';
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
  /** Open to begin with; `'wide'` opens from laptop width only. */
  defaultOpen?: boolean | 'wide';
  name?: string;
  onToggle?: (open: boolean) => void;
  className?: string;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDetailsElement>(null);
  // A `<details>` created open fires a toggle of its own. Until the kept fold
  // has been applied, that one is ignored, or it would clear what was kept.
  const applied = useRef(false);
  // The default this browser resolved `'wide'` to, for what is kept.
  const base = useRef(defaultOpen !== false);

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    base.current = defaultOpen === 'wide' ? window.matchMedia(FOLD_WIDE).matches : defaultOpen;
    const open = targeted(element) || openFor(base.current, readFold(remember));
    if (element.open !== open) element.open = open;
    applied.current = true;
  }, [remember, defaultOpen]);

  return (
    <details
      ref={ref}
      name={name}
      open={defaultOpen !== false}
      onToggle={(event) => {
        const open = event.currentTarget.open;
        if (applied.current) rememberFold(remember, open, base.current);
        onToggle?.(open);
      }}
      className={className}
    >
      {children}
    </details>
  );
}

/** Whether the page's #anchor is this fold or something round or inside it. */
function targeted(element: HTMLElement): boolean {
  const id = decodeURIComponent(window.location.hash.slice(1));
  if (!id) return false;
  const target = document.getElementById(id);
  return target !== null && (target.contains(element) || element.contains(target));
}
