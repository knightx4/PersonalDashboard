import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { Target } from 'lucide-react';
import { EmptyState } from '@/components/ui/empty-state';
import { requireUser } from '@/lib/auth/server';
import { createLearnClient } from '@/lib/learn/auth/server';
import { loadSubjects } from '@/lib/learn/graph/load';
import { firstParam, practiceHref } from '@/lib/learn/flow/href';
import { goalsOnlyOrDefault } from '@/lib/learn/goals-only-setting';
import { goalSubjectId } from '@/lib/learn/levels/practice-store';
import { FlowFocus, ScopeFilter, type FlowOnly } from './scope';
import { askCell } from '@/lib/learn/levels/answer-store';
import { collectSpend, recordLearnSpend } from '@/lib/learn/spend';
import { CellAnswer } from '@/components/learn/cell-answer';
import { CellQuestionSkeleton } from '@/components/learn/cell-answer-view';
import { roleWhy } from '@/lib/learn/levels/role-line';
import { roleLineFinder } from '@/lib/learn/levels/role-match';
import { LevelsFlow } from './levels';
import { PlacementFlow } from './placement';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Practice Flow: one question after another, until you stop or there is
 * nothing left to ask. Shown on the Now tab with its Practice only switch on
 * (plan #1486); it was a tab of its own at /learn/flow before, and that route
 * redirects to the switch with its query kept (`lib/learn/flow/href.ts`).
 *
 * Every question is about a level of a topic (plan #2138.6, ./levels.tsx):
 * placement on a topic not yet placed, then the fringe. Since plan #2313.2
 * nothing else is asked: no survey question about a theme from your notes
 * and no goal question written ahead, so no hidden subject is made to hold
 * them. Unfocused, the topics are those of every prepared subject and every
 * goal's subject (plan #2302.1).
 *
 * `?track=<subject id>` focuses the flow on one subject (plan #779). A subject
 * that is not one of yours, or no longer exists, is dropped rather than shown
 * as empty. `?only=tracks` asks about prepared subjects alone and
 * `?only=goals` about your goals' subjects alone; while Goals only is on in
 * Learn settings (plan #2164.1) the latter is the default and `?only=all` is
 * Everything. `?goal=<aim id>` is a goal's Practise link on the Goals page: it
 * goes to the subject the goal points at, and a goal pointing at none back to
 * the unfocused questions.
 */
export async function PracticeFlow({
  track: trackParam,
  only,
  goal: goalParam,
  cell: cellParam,
  run,
  end,
  after,
  placement,
  skip,
}: {
  track?: string | string[];
  only?: string | string[];
  goal?: string | string[];
  cell?: string | string[];
  /** When the practice run began (plan #2138.6). */
  run?: string | string[];
  /** The run to sum up. */
  end?: string | string[];
  /** The question just answered; only part of the key. */
  after?: string | string[];
  /** `placement=1` with a track: the placement before its first lesson (plan #2292.2). */
  placement?: string | string[];
  /** `skip=1` on a placement's end: straight on to the lesson. */
  skip?: string | string[];
}) {
  // `?cell=<id>` asks an explain question about one level of a topic (plan
  // #2138.5), graded against that level and the ones around it. Without it,
  // placement and the fringe choose the level (#2138.6, ./levels.tsx).
  if (cellParam !== undefined) {
    const cellId = typeof cellParam === 'string' && UUID.test(cellParam) ? cellParam : null;
    if (!cellId) redirect(practiceHref());
    const user = await requireUser();
    const spend = collectSpend();
    const cellLearn = await createLearnClient();
    const asked = await askCell(
      cellLearn,
      user.id,
      cellId,
      process.env.ANTHROPIC_API_KEY ? { anthropicApiKey: process.env.ANTHROPIC_API_KEY, onSpend: spend.sink } : undefined,
      undefined,
      roleLineFinder(cellLearn, user.id),
    );
    await recordLearnSpend(user.id, 'write-cell-case', spend.reports);
    return (
      <div className="mt-6">
        {asked.ok ? (
          <CellAnswer key={asked.asked.questionId} asked={{ ...asked.asked, why: asked.asked.role ? roleWhy(asked.asked.role) : undefined }} nextHref={practiceHref()} holdForward />
        ) : (
          <EmptyState
            icon={Target}
            title="That level cannot be asked"
            description={asked.error}
            action={{ label: 'Practice', href: practiceHref() }}
          />
        )}
      </div>
    );
  }

  const trackId = typeof trackParam === 'string' && UUID.test(trackParam) ? trackParam : null;
  if (trackParam !== undefined && trackId === null) redirect(practiceHref());
  const goalId =
    trackId === null && typeof goalParam === 'string' && UUID.test(goalParam) ? goalParam : null;
  if (trackId === null && goalParam !== undefined && goalId === null) redirect(practiceHref());
  const user = await requireUser();
  const supabase = await createLearnClient();

  // A goal's questions are its subject's.
  if (goalId) {
    const subjectId = await goalSubjectId(supabase, goalId).catch(() => null);
    redirect(subjectId ? practiceHref({ track: subjectId }) : practiceHref());
  }

  // Goals only on Learn settings (plan #2164.1), an opt-in (#2302.1): while it
  // is on the flow opens on Goals only.
  const goalsOnly = await goalsOnlyOrDefault(supabase, user.id);

  // A focused flow asks about one subject already, so the filter has nothing
  // to add. With no filter named, Goals only is the default while the setting
  // is on; Everything is written as `only=all` to get past it.
  const filter: FlowOnly =
    trackId !== null
      ? null
      : only === 'tracks' || only === 'goals'
        ? only
        : only === undefined && goalsOnly
          ? 'goals'
          : null;

  const subjects = trackId ? await loadSubjects(supabase) : [];
  const focused = trackId ? subjects.find((subject) => subject.id === trackId) : undefined;
  if (trackId && !focused) redirect(practiceHref());
  const subject = focused ? { id: focused.id, name: focused.name } : null;
  return (
    <div>
      {subject ? <FlowFocus name={subject.name} back="All subjects" /> : <ScopeFilter filter={filter} />}
      <div className="mt-6">
        <Suspense key={`${subject?.id ?? 'all'}:${filter ?? ''}:${firstParam(run) ?? ''}:${firstParam(end) ?? ''}:${firstParam(after) ?? ''}`} fallback={<CellQuestionSkeleton />}>
          {subject && firstParam(placement) === '1' ? (
            <PlacementFlow userId={user.id} subject={subject} run={run} end={end} skip={firstParam(skip) === '1'} />
          ) : (
            <LevelsFlow userId={user.id} subject={subject} only={filter} run={run} end={end} />
          )}
        </Suspense>
      </div>
    </div>
  );
}
