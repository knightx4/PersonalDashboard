/* ui-ok-file: card-per-row -- two halves side by side, not a list of rows. */

import { Card } from '@/components/ui/card';
import { cn } from '@/lib/cn';
import type { Entry } from './entries';

export type Show = 'both' | 'now' | 'next';

export function parseShow(value: string | undefined): Show {
  return value === 'now' || value === 'next' ? value : 'both';
}

/**
 * One component drawn twice: as the app had it before the overhaul (13 October 2026) and as it is now. Side
 * by side from md up, stacked on a phone with today first. `show` keeps only
 * one half, for flicking between them at one place on the page.
 */
export function Pair({ entry, show }: { entry: Entry; show: Show }) {
  const halves = [
    show !== 'next' && { key: 'now', title: 'Before', body: entry.now() },
    show !== 'now' && { key: 'next', title: 'After', body: entry.next() },
  ].filter(Boolean) as { key: string; title: string; body: React.ReactNode }[];

  return (
    <div className={cn('grid gap-3', halves.length === 2 && 'md:grid-cols-2')}>
      {halves.map((half) => (
        <Card key={half.key} padding="standard" className="min-w-0">
          <p
            className={cn(
              'mb-4 text-micro font-semibold uppercase tracking-wider',
              half.key === 'next' ? 'text-accent' : 'text-ink-muted',
            )}
          >
            {half.title}
          </p>
          {half.body}
        </Card>
      ))}
    </div>
  );
}
