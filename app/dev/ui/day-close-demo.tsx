'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { DayClosed } from '@/components/todo/day-closed';
import { completionMoment } from '@/components/motion/complete';
import type { DoneTodayTask } from '@/lib/todo/agenda/day-close';

const DUE = ['Return the kettle', 'Book the dentist', 'Renew the parking permit'];

/**
 * The day closing on the agenda (DayClosed in components/todo/day-closed.tsx),
 * on demand: tick each thing due today and the last one folds the done ones
 * into a pile, draws the day's sigil in and says how many. Putting them back
 * opens the day again. Under reduced motion the folded pile is simply there.
 * The gallery entry starts with one already done, so one press closes the day.
 */
export function DayCloseDemo({
  due = DUE,
  alreadyDone = [],
}: {
  due?: readonly string[];
  alreadyDone?: readonly string[];
}) {
  const [done, setDone] = useState<readonly string[]>(alreadyDone);
  const left = due.filter((title) => !done.includes(title));
  const closed = left.length === 0;
  const pile: DoneTodayTask[] = [...done].reverse().map((title) => ({ id: title, title }));

  return (
    <div className="space-y-3">
      <Button
        variant="secondary"
        onClick={() => setDone(alreadyDone)}
        disabled={done.length === alreadyDone.length}
      >
        Put them back
      </Button>
      <DayClosed closed={closed} done={pile} seed="dev-ui:day-close" nothingElse />
      {!closed && (
        <ul className="divide-y divide-border">
          {left.map((title) => (
            <li
              key={title}
              className="row-pad flex items-center justify-between gap-3 text-ui text-ink"
            >
              {title}
              <Button
                variant="ghost"
                size="sm"
                data-motion-demo="day-close"
                onClick={() => {
                  completionMoment();
                  setDone((now) => [...now, title]);
                }}
              >
                Done
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
