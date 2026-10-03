'use client';

import { useRef } from 'react';
import { Button } from '@/components/ui/button';
import { sendToPlace } from '@/components/motion/place';
import { travel } from '@/components/motion/travel';

const ITEM = 'Ring the dentist about the October appointment';

/**
 * Travel (components/motion/travel.ts), on demand: a chip leaves the word
 * "capture" and lands on the word "todo". The second button plays the whole
 * of capture's landing through sendToPlace: the puff, the chip, and "todo"
 * settling with its name beside it. Under reduced motion only the name
 * appears.
 */
export function TravelDemo() {
  const from = useRef<HTMLSpanElement>(null);
  const to = useRef<HTMLSpanElement>(null);

  function fly() {
    if (!from.current || !to.current) return;
    void travel({ from: from.current, to: to.current, label: ITEM });
  }

  function send() {
    if (!from.current || !to.current) return;
    void sendToPlace({ from: from.current, to: to.current, label: ITEM, name: 'Todo · Today' });
  }

  return (
    <div className="flex flex-wrap items-center gap-4">
      <span ref={from} className="font-mono text-micro text-ink-muted">
        capture
      </span>
      <Button variant="secondary" onClick={fly} data-motion-demo="travel">
        Travel
      </Button>
      <Button variant="ghost" onClick={send}>
        The whole landing
      </Button>
      <span ref={to} className="ml-auto inline-block font-mono text-micro text-ink-muted">
        todo
      </span>
    </div>
  );
}
