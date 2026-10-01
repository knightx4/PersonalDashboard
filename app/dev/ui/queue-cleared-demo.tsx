'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { QueueCleared } from '@/components/ui/queue-cleared';

const ITEMS = ['Return the kettle', 'Book the dentist', 'Renew the parking permit'];

/**
 * A worked list cleared on screen (plan #1340), on demand: tick the last item
 * off and the day's sigil draws in cell by cell. Putting the items back and
 * clearing them again draws it again. Under reduced motion the sigil is simply
 * there.
 */
export function QueueClearedDemo() {
  const [left, setLeft] = useState<readonly string[]>(ITEMS);
  const cleared = left.length === 0;
  return (
    <div className="space-y-3">
      <Button variant="secondary" onClick={() => setLeft(ITEMS)} disabled={left.length === ITEMS.length}>
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
                  onClick={() => setLeft((now) => now.filter((entry) => entry !== item))}
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
