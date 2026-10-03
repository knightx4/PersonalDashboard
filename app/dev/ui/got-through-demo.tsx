'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { QueueCleared } from '@/components/motion/clear';
import { GotThrough, type GotThroughSummary } from '@/app/news/quick/got-through';

const STORIES = ['Rates held for a third month', 'Rail strike called off', 'A late harvest'];

const SUMMARY: GotThroughSummary = {
  read: 9,
  skipped: 4,
  longest: { headline: 'Rates held for a third month', held: '3 minutes' },
  due: [
    { from: 'The Morning Letter', when: 'tomorrow around 6:00 AM' },
    { from: 'The Weekly', when: 'on Friday around 7:00 AM' },
  ],
};

/**
 * The end of Quick read (GotThrough in app/news/quick/got-through.tsx), on
 * demand: pass each story and the last one draws the day's sigil in, then
 * lifts in the card saying what you got through, its figures counting up.
 * Putting the stories back opens the deck again. Under reduced motion the
 * sigil and the card are simply there. The gallery entry starts with one
 * story, so one press reaches the end.
 */
export function GotThroughDemo({ stories = STORIES }: { stories?: readonly string[] }) {
  const [left, setLeft] = useState<readonly string[]>(stories);
  const done = left.length === 0;
  return (
    <div className="space-y-3">
      <Button
        variant="secondary"
        onClick={() => setLeft(stories)}
        disabled={left.length === stories.length}
      >
        Put them back
      </Button>
      <QueueCleared cleared={done}>
        {done ? (
          <EmptyState
            tone="finished"
            seed="dev-ui:got-through"
            title="You are caught up"
            description="New stories show here as they arrive."
          />
        ) : (
          <ul className="divide-y divide-border">
            {left.map((story) => (
              <li
                key={story}
                className="row-pad flex items-center justify-between gap-3 text-ui text-ink"
              >
                {story}
                <Button
                  variant="ghost"
                  size="sm"
                  data-motion-demo="got-through"
                  onClick={() => setLeft((now) => now.filter((entry) => entry !== story))}
                >
                  Next
                </Button>
              </li>
            ))}
          </ul>
        )}
      </QueueCleared>
      <GotThrough done={done} summary={SUMMARY} />
    </div>
  );
}
