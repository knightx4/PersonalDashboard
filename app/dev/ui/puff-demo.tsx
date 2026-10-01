'use client';

import { useRef } from 'react';
import { Button } from '@/components/ui/button';
import { puffAt } from '@/components/ui/puff';

/**
 * The puff, run on demand at the word "here". Under reduced motion the
 * button does nothing.
 */
export function PuffDemo() {
  const at = useRef<HTMLSpanElement>(null);

  function puff() {
    if (!at.current) return;
    void puffAt(at.current);
  }

  return (
    <div className="flex flex-wrap items-center gap-4">
      <Button variant="secondary" onClick={puff}>
        Puff
      </Button>
      <span ref={at} className="font-mono text-micro text-ink-muted">
        here
      </span>
    </div>
  );
}
