'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { puffAt, QueueCleared } from '@/components/motion/clear';

const ITEMS = ['Return the kettle', 'Book the dentist', 'Renew the parking permit'];

/**
 * Clear (components/motion/clear.tsx), on demand: each item ticked off leaves
 * with a puff, and ticking off the last draws the day's sigil in cell by
 * cell. Putting the items back and clearing them again draws it again. Under
 * reduced motion there is no puff and the sigil is simply there. The gallery
 * entry starts it with one item, so one press clears the list.
 */
export function ClearDemo({ items = ITEMS }: { items?: readonly string[] }) {
  const [left, setLeft] = useState<readonly string[]>(items);
  const cleared = left.length === 0;
  return (
    <div className="space-y-3">
      <Button variant="secondary" onClick={() => setLeft(items)} disabled={left.length === items.length}>
        Put them back
      </Button>
      <QueueCleared cleared={cleared}>
        {cleared ? (
          <EmptyState
            tone="finished"
            seed="dev-ui:queue-cleared"
            title="Nothing on the list."
            description="Write the next thing down and it will be here."
          />
        ) : (
          <ul className="divide-y divide-border">
            {left.map((item) => (
              <li key={item} className="row-pad flex items-center justify-between gap-3 text-ui text-ink">
                {item}
                <Button
                  variant="ghost"
                  size="sm"
                  data-motion-demo="clear"
                  // Held down, Done fills before the row leaves, so the press
                  // is answered in the first frame (the critic's craft check).
                  className="active:bg-accent-tint active:text-accent"
                  onClick={(event) => {
                    void puffAt(event.currentTarget.closest('li') ?? event.currentTarget);
                    setLeft((now) => now.filter((entry) => entry !== item));
                  }}
                >
                  Done
                </Button>
              </li>
            ))}
          </ul>
        )}
      </QueueCleared>
    </div>
  );
}
