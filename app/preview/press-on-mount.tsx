'use client';

import { useEffect, useRef } from 'react';

/**
 * Presses the first button matching `selector` inside its children once, after
 * they mount, so the gallery can photograph a menu open: the real menu, opened
 * the way a person opens it, rather than a drawing of one.
 */
export function PressOnMount({ selector, children }: { selector: string; children: React.ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    box.current?.querySelector<HTMLButtonElement>(selector)?.click();
  }, [selector]);
  return <div ref={box}>{children}</div>;
}
