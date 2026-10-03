'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { Gauge, Route, Timer } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { ChipSelect } from '@/components/ui/field';
import { practiceHref } from '@/lib/learn/flow/href';
import { AIM_DEPTHS, AIM_DEPTH_LABELS, type AimDepth, type Level3Counts } from '@/lib/learn/aims';
import { setLearnDepth, type LearnDepthState } from './learn-actions';

const initial: LearnDepthState = {};

/** The Learn goal a goal stands for, as this section needs it. */
export type GoalLearnAim = {
  id: string;
  name: string;
  depth: AimDepth;
  level3: boolean;
};

/** A count with thousands separators: 1,001. */
const count = (n: number) => n.toLocaleString('en-GB');

/**
 * What Learn does with a goal in the Learn area (plan #1491), on the goal's
 * own page now that Learn has no Goals tab: how well you want to know it,
 * which the cards and the plan are drawn to, a link to its plan and to
 * practise it, and for the Level 3 goal how much of the list you have shown
 * you know. The depth is a chip saved on change (law 12).
 */
export function GoalLearn({
  aim,
  plan,
  level3Counts,
}: {
  aim: GoalLearnAim;
  /** The goal's plan and how far through it you are; null until it has one. */
  plan: { href: string; line: string } | null;
  /** The Level 3 counts; null when they could not be read or the goal is another. */
  level3Counts: Level3Counts | null;
}) {
  const [state, save, saving] = useActionState(setLearnDepth, initial);
  return (
    <section aria-labelledby="learn-heading" className="space-y-2">
      <h2 id="learn-heading" className="px-1 text-ui font-semibold text-ink">
        Learning
      </h2>
      <Card padding="dense" className="space-y-1.5">
        <form action={save} className="flex flex-wrap items-center gap-2">
          <input type="hidden" name="aimId" value={aim.id} />
          <ChipSelect
            name="depth"
            defaultValue={aim.depth}
            key={`depth-${aim.depth}`}
            aria-label={`How well you want to know ${aim.name}`}
            icon={<Gauge className="size-3.5" strokeWidth={1.75} />}
            disabled={saving}
            onChange={(event) => event.currentTarget.form?.requestSubmit()}
          >
            {AIM_DEPTHS.map((depth) => (
              <option key={depth} value={depth}>
                {AIM_DEPTH_LABELS[depth].label}
              </option>
            ))}
          </ChipSelect>
          <span className="text-small text-ink-muted">
            Know it {AIM_DEPTH_LABELS[aim.depth].means}.
          </span>
        </form>
        {aim.level3 && (
          <p className="text-small tabular-nums text-ink-muted">
            {level3Counts
              ? `${count(level3Counts.claimed)} claimed, ${count(level3Counts.tested)} tested, of ${count(level3Counts.total)} on Wikipedia’s Level 3 vital list`
              : 'Your Level 3 counts could not be read.'}
          </p>
        )}
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-small text-ink-muted">
          {plan && (
            <span className="flex items-center gap-1">
              <Route className="size-3.5 shrink-0" strokeWidth={1.75} aria-hidden />
              <Link href={plan.href} className="text-accent hover:underline">
                Open the plan
              </Link>
              <span className="tabular-nums">· {plan.line}</span>
            </span>
          )}
          <span className="flex items-center gap-1">
            <Timer className="size-3.5 shrink-0" strokeWidth={1.75} aria-hidden />
            <Link
              href={practiceHref({ goal: aim.id })}
              aria-label={`Practise ${aim.name}`}
              className="text-accent hover:underline"
            >
              Practise
            </Link>
          </span>
        </p>
        {state.error && <p className="text-small text-danger">{state.error}</p>}
      </Card>
    </section>
  );
}
