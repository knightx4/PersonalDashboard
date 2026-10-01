'use client';

import { useRef } from 'react';
import { Button } from '@/components/ui/button';
import { flyChip } from '@/components/ui/fly-chip';

/**
 * The flight, run on demand: a chip leaves the word "capture" and lands on
 * the word "todo". Under reduced motion the button does nothing.
 */
export function FlyChipDemo() {
  const from = useRef<HTMLSpanElement>(null);
  const to = useRef<HTMLSpanElement>(null);

  function fly() {
    if (!from.current || !to.current) return;
    void flyChip({
      from: from.current,
      to: to.current,
      label: 'Ring the dentist about the October appointment',
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-4">
      <span ref={from} className="font-mono text-micro text-ink-muted">
        capture
      </span>
      <Button variant="secondary" onClick={fly}>
        Fly a chip
      </Button>
      <span ref={to} className="ml-auto font-mono text-micro text-ink-muted">
        todo
      </span>
    </div>
  );
}
