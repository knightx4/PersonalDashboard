import { GoalLearn } from '@/app/goals/[goalId]/goal-learn';
import { FlowFocus, ScopeFilter } from '@/app/learn/flow/scope';

/**
 * The Learning section on a Learn-area goal's page (plan #1491, which took
 * it over from Learn's Goals tab) and Practice Flow's filter, drawn from
 * fixtures for the gallery: an ordinary goal with its plan, and the Level 3
 * list with its counts.
 */

export function LearnGoalsPreview() {
  return (
    <div className="space-y-6">
      <GoalLearn
        aim={{
          id: '00000000-0000-4000-8000-0000000000a2',
          name: 'Financial modeling in Excel for operators',
          depth: 'solid',
          level3: false,
        }}
        plan={{ href: '/learn/s/00000000-0000-4000-8000-0000000000b2', line: '3 of 9 lessons' }}
        level3Counts={null}
      />
      <GoalLearn
        aim={{
          id: '00000000-0000-4000-8000-0000000000a3',
          name: 'Every Level 3 vital article',
          depth: 'familiar',
          level3: true,
        }}
        plan={null}
        level3Counts={{ claimed: 212, tested: 37, total: 1000 }}
      />
    </div>
  );
}

/** The filter with Goals only chosen, and the line a goal's Practise link opens on. */
export function FlowScopePreview() {
  return (
    <>
      <ScopeFilter filter="goals" />
      <FlowFocus name="Financial modeling in Excel for operators" back="Everything" />
    </>
  );
}
