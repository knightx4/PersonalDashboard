'use client';

import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { settle, settleIn } from '@/components/motion/settle';

const ROWS = ['Return the kettle', 'Book the dentist', 'Renew the parking permit'];

/**
 * Settle (components/motion/settle.ts), on demand. Pressing it adds the next
 * row, which springs into place, and the list's name pulses once with its
 * name beside it. Under reduced motion the row is simply there and the name
 * still appears.
 */
export function SettleDemo() {
  const [shown, setShown] = useState(1);
  const list = useRef<HTMLUListElement>(null);
  const place = useRef<HTMLSpanElement>(null);
  const added = useRef(false);

  useEffect(() => {
    if (!added.current) return;
    added.current = false;
    const row = list.current?.lastElementChild;
    if (row) void settleIn(row);
    if (place.current) settle(place.current, 'Todo · Today');
  }, [shown]);

  function add() {
    added.current = true;
    setShown((n) => (n >= ROWS.length ? 1 : n + 1));
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-4">
        <Button variant="secondary" onClick={add} data-motion-demo="settle">
          Settle
        </Button>
        <span ref={place} className="inline-block font-mono text-micro text-ink-muted">
          todo
        </span>
      </div>
      <ul ref={list} className="divide-y divide-border">
        {ROWS.slice(0, shown).map((row) => (
          <li key={row} className="row-pad text-ui text-ink">
            {row}
          </li>
        ))}
      </ul>
    </div>
  );
}
