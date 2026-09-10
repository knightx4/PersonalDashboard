'use client';

import { useEffect, useState } from 'react';
import { Activity } from 'lucide-react';
import { cn } from '@/lib/cn';
import type { ActivityLine } from '@/lib/shell/activity';

/**
 * The status line.
 *
 * One line, at the bottom, in machine voice. It says what the system did while
 * nobody was looking, which in an app built around background ingestion is
 * most of what happens.
 *
 * It is the cheapest rung of the attention ladder: it moves nothing, blocks
 * nothing, and is not addressed to you. Anything that genuinely needs you is
 * further up -- a nav count, or a banner.
 *
 * It fades back after a few seconds rather than staying at full strength. A
 * line that is always as loud as the page becomes a line nobody reads, and
 * this one is meant to be glanced at rather than watched.
 */
export function StatusLine({ lines }: { lines: ActivityLine[] }) {
  const [settled, setSettled] = useState(false);

  useEffect(() => {
    if (lines.length === 0) return;
    const timer = window.setTimeout(() => setSettled(true), 6000);
    return () => window.clearTimeout(timer);
  }, [lines]);

  if (lines.length === 0) return null;

  return (
    <div className="pointer-events-none sticky bottom-0 z-status hidden border-t border-shell-border bg-shell/85 backdrop-blur lg:block">
      <div
        className={cn(
          'flex items-center gap-2 px-4 py-1.5 font-mono text-micro transition-opacity duration-1000 sm:px-6',
          settled ? 'text-shell-muted/70' : 'text-shell-muted',
        )}
      >
        <Activity className="size-3 shrink-0" strokeWidth={1.75} aria-hidden />
        <span className="min-w-0 flex-1 truncate">
          {lines.map((line) => line.text).join('  ·  ')}
        </span>
        <Timestamp />
      </div>
    </div>
  );
}

/**
 * Rendered after mount, deliberately.
 *
 * A clock rendered on the server is a clock that is wrong by the time it
 * arrives, and one rendered during hydration is a mismatch warning. This is
 * the one thing on the page that has to come from the reader's own machine.
 */
function Timestamp() {
  const [now, setNow] = useState<string | null>(null);

  useEffect(() => {
    const tick = () =>
      setNow(
        new Date().toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }),
      );
    tick();
    const timer = window.setInterval(tick, 30_000);
    return () => window.clearInterval(timer);
  }, []);

  if (!now) return null;
  return <span className="tabular shrink-0">{now}</span>;
}
