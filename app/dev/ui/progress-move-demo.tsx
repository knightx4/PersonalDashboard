'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { GoalProgress } from '@/app/goals/goal-progress';
import type { GoalProgress as Progress } from '@/lib/goals/status';

const LIVE = 6;

function progressAt(done: number): Progress {
  const open = LIVE - done;
  const onYou = Math.ceil(open / 2);
  return {
    live: LIVE,
    done,
    bands: { on_you: onYou, waiting: 0, with_claude: open - onYou, done },
    move: open === 0 ? 'settled' : 'on_you',
    moves: { on_you: onYou, waiting: 0, with_claude: open - onYou, settled: 0 },
    questions: 0,
  };
}

/**
 * A goal's progress (plan #1342), closing and reopening a step on demand: the
 * bands slide and the count counts over 300ms. Under reduced motion both land
 * at once.
 */
export function ProgressMoveDemo() {
  const [done, setDone] = useState(2);
  return (
    <div className="flex flex-wrap items-center gap-4">
      <Button variant="secondary" disabled={done >= LIVE} onClick={() => setDone((n) => Math.min(LIVE, n + 1))}>
        Close a step
      </Button>
      <Button variant="secondary" disabled={done <= 0} onClick={() => setDone((n) => Math.max(0, n - 1))}>
        Reopen a step
      </Button>
      <GoalProgress progress={progressAt(done)} label="Example goal" />
    </div>
  );
}
