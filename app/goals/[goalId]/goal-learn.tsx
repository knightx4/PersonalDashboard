'use client';

import Link, { linkVariants } from '@/components/ui/link';
import { useActionState } from 'react';
import { CircleAlert, Gauge, ListChecks, Route, Shapes, Timer } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { ChipSelect } from '@/components/ui/field';
import { practiceHref } from '@/lib/learn/flow/href';
import { AIM_DEPTHS, AIM_DEPTH_LABELS, type AimDepth, type Level3Counts } from '@/lib/learn/aims';
import { GOAL_KINDS, GOAL_KIND_LABELS, type GoalKind, type GoalKindBy } from '@/lib/learn/goal-kind';
import { setLearnDepth, setLearnKind, type LearnDepthState, type LearnKindState } from './learn-actions';
import { formatNumber } from '@/lib/money';
import { cn } from '@/lib/cn';

const initial: LearnDepthState = {};
const initialKind: LearnKindState = {};

/** The Learn goal a goal stands for, as this section needs it. */
export type GoalLearnAim = {
  id: string;
  name: string;
  depth: AimDepth;
  level3: boolean;
  /** The subject the goal points at (plan #2302.2); null until it is linked, and for the Level 3 list. */
  subject: GoalLearnSubject | null;
};

/** The subject a goal points at: its kind and its preparation, which are the subject's, not the goal's. */
export type GoalLearnSubject = {
  id: string;
  /** What kind of subject it is (plan #2247.2); null until its preparation has sorted it. */
  kind: GoalKind | null;
  kindReason: string | null;
  kindBy: GoalKindBy | null;
  /** The preparation in one line (`preparationLine`). */
  preparation: string;
  /** The preparation stopped on a failed step, which wants the person: drawn with weight. */
  stopped: boolean;
};

/** A count with thousands separators: 1,001. */
const count = (n: number) => formatNumber(n);

/**
 * What Learn does with a goal in the Learn area (plan #1491), on the goal's
 * own page now that Learn has no Goals tab: how well you want to know it,
 * which the cards and the plan are drawn to, the kind and preparation of the
 * subject it points at (plan #2302.2), a link to its plan and to
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
  const [kindState, saveKind, savingKind] = useActionState(setLearnKind, initialKind);
  const { subject } = aim;
  return (
    <section aria-labelledby="learn-heading" className="space-y-2">
      <h2 id="learn-heading" className="px-1 text-ui font-semibold text-ink">
        Learning
      </h2>
      <Card padding="dense" className="space-y-1.5">
        <form action={save} className="flex flex-wrap items-center gap-2">
          <input type="hidden" name="aimId" value={aim.id} />
          <ChipSelect
            touch
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
        {subject && (
          <form action={saveKind} className="space-y-0.5">
            <input type="hidden" name="subjectId" value={subject.id} />
            <div className="flex flex-wrap items-center gap-2">
              <ChipSelect
                touch
                name="kind"
                defaultValue={subject.kind ?? ''}
                key={`kind-${subject.kind ?? 'none'}`}
                aria-label={`What kind of subject ${aim.name} is`}
                icon={<Shapes className="size-3.5" strokeWidth={1.75} />}
                placeholderValue=""
                disabled={savingKind}
                onChange={(event) => event.currentTarget.form?.requestSubmit()}
              >
                {subject.kind === null && (
                  <option value="" disabled>
                    Not sorted yet
                  </option>
                )}
                {GOAL_KINDS.map((kind) => (
                  <option key={kind} value={kind}>
                    {GOAL_KIND_LABELS[kind].label}
                  </option>
                ))}
              </ChipSelect>
              <span className="text-small text-ink-muted">
                {subject.kind
                  ? `Sources are chosen for ${GOAL_KIND_LABELS[subject.kind].means}.`
                  : 'Dash sorts it as the subject is prepared.'}
              </span>
            </div>
            {subject.kind && subject.kindReason && (
              <p className="text-small text-ink-muted">
                {subject.kindBy === 'person' ? 'You chose this kind.' : `Why: ${subject.kindReason}`}
              </p>
            )}
            {kindState.error && <p className="text-small text-danger">{kindState.error}</p>}
          </form>
        )}
        {subject && (
          <p
            className={cn(
              'flex items-start gap-1 text-small tabular-nums',
              subject.stopped ? 'font-medium text-caution' : 'text-ink-muted',
            )}
          >
            {subject.stopped ? (
              <CircleAlert className="mt-0.5 size-3.5 shrink-0" strokeWidth={1.75} aria-hidden />
            ) : (
              <ListChecks className="mt-0.5 size-3.5 shrink-0" strokeWidth={1.75} aria-hidden />
            )}
            {subject.preparation}
          </p>
        )}
        {!subject && !aim.level3 && (
          <p className="text-small text-ink-muted">Dash links it to a subject when the goal is next saved.</p>
        )}
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
              <Link href={plan.href} className={cn(linkVariants(), 'press-area')}>
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
              className={cn(linkVariants(), 'press-area')}
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
