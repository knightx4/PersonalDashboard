'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { ListChecks, Target } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { LEVEL3_AIM_NAME } from '@/lib/learn/aims';
import { addLevel3Goal, type Level3State } from './level3-actions';

const initial: Level3State = {};

/**
 * Where the learning goals are (plan #1491): a link to the Learn area on
 * /goals, which took over from Learn's Goals tab, and the Level 3 goal in one
 * press until you have it.
 */
export function LearnGoalsLine({ href, offerLevel3 }: { href: string; offerLevel3: boolean }) {
  const [state, add, adding] = useActionState(addLevel3Goal, initial);
  return (
    <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-ui">
      <Link href={href} className="flex items-center gap-1.5 text-accent hover:underline">
        <Target className="size-3.5" strokeWidth={1.75} aria-hidden />
        Your learning goals, in Goals
      </Link>
      {offerLevel3 && (
        <form action={add} className="flex flex-wrap items-center gap-2">
          <Button type="submit" variant="ghost" size="sm" disabled={adding}>
            <ListChecks className="size-3.5" strokeWidth={1.75} aria-hidden />
            {adding ? 'Adding…' : `Add “${LEVEL3_AIM_NAME}”`}
          </Button>
          {state.error && <span className="text-small text-danger">{state.error}</span>}
        </form>
      )}
    </div>
  );
}
