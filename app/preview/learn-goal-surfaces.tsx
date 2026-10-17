import { GoalLearn } from '@/app/goals/[goalId]/goal-learn';
import { FlowFocus, ScopeFilter } from '@/app/learn/flow/scope';

/**
 * The Learning section on a Learn-area goal's page (plan #1491, which took
 * it over from Learn's Goals tab) and Practice Flow's filter, drawn from
 * fixtures for the gallery: an ordinary goal with its plan, and the Level 3
 * list with its counts. Since plan #2302.2 the kind and the preparation line
 * are the subject's: prepared, stopped, preparing, and a goal not linked yet.
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
          subject: {
            id: '00000000-0000-4000-8000-0000000000b2',
            kind: 'practical_skill',
            kindReason: 'Building models in Excel is a hands-on skill taught by certification and training material.',
            kindBy: 'model',
            preparation: 'Prepared in 7 minutes · 4 documents stored, 31 topics drafted',
            stopped: false,
          },
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
          subject: null,
        }}
        plan={null}
        level3Counts={{ claimed: 212, tested: 37, total: 1000 }}
      />
      <GoalLearn
        aim={{
          id: '00000000-0000-4000-8000-0000000000a4',
          name: 'How French political thought shaped the American Revolution and the early republic',
          depth: 'deep',
          level3: false,
          subject: {
            id: '00000000-0000-4000-8000-0000000000b4',
            kind: 'narrow_question',
            kindReason:
              'Narrower than any one course: it draws on the American and French Revolution syllabi and on primary sources from both sides.',
            kindBy: 'person',
            preparation: 'Preparation stopped · step 2 of 8, Find syllabi and other structure documents',
            stopped: true,
          },
        }}
        plan={null}
        level3Counts={null}
      />
      <GoalLearn
        aim={{
          id: '00000000-0000-4000-8000-0000000000a5',
          name: 'Beekeeping',
          depth: 'familiar',
          level3: false,
          subject: {
            id: '00000000-0000-4000-8000-0000000000b5',
            kind: null,
            kindReason: null,
            kindBy: null,
            preparation: 'Preparing · step 1 of 8, Work out what kind of subject this is',
            stopped: false,
          },
        }}
        plan={null}
        level3Counts={null}
      />
      <GoalLearn
        aim={{
          id: '00000000-0000-4000-8000-0000000000a6',
          name: 'Urban economics',
          depth: 'familiar',
          level3: false,
          subject: null,
        }}
        plan={null}
        level3Counts={null}
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
