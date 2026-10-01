import type { ComponentProps } from 'react';
import { GoalsView } from '@/app/learn/goals/goals-view';
import { FlowFocus, ScopeFilter } from '@/app/learn/flow/scope';
import type { Aim } from '@/lib/learn/aims';

/**
 * Learn's Goals list and Practice Flow's filter, drawn from fixtures for the
 * gallery (plan #1387). Three goals on an ordinary day: one with a plan, one
 * placed in a field, and the Level 3 list with its counts.
 */

const STAMP = '2026-09-20T09:00:00Z';

function aim(id: string, name: string, about: string | null, extra: Partial<Aim> = {}): Aim {
  return {
    id,
    name,
    about,
    depth: 'solid',
    listSource: null,
    fieldId: null,
    domainId: null,
    placedAt: STAMP,
    archivedAt: null,
    createdAt: STAMP,
    updatedAt: STAMP,
    ...extra,
  };
}

const goals: ComponentProps<typeof GoalsView> = {
  aims: [
    aim(
      '00000000-0000-4000-8000-0000000000a1',
      'SaaS and subscription business metrics',
      'Churn, net revenue retention, payback',
    ),
    aim('00000000-0000-4000-8000-0000000000a2', 'Financial modeling in Excel for operators', null),
    aim('00000000-0000-4000-8000-0000000000a3', 'Level 3 vital articles', null, {
      listSource: 'level3',
    }),
  ],
  places: {
    '00000000-0000-4000-8000-0000000000a1': { kind: 'field', name: 'Business and finance' },
    '00000000-0000-4000-8000-0000000000a2': { kind: 'spans' },
    '00000000-0000-4000-8000-0000000000a3': { kind: 'list' },
  },
  level3Counts: { claimed: 212, tested: 37, total: 1000 },
  plans: {
    '00000000-0000-4000-8000-0000000000a2': {
      href: '/learn/s/00000000-0000-4000-8000-0000000000b2',
      line: '3 of 9 lessons',
    },
  },
};

export function LearnGoalsPreview() {
  return <GoalsView {...goals} />;
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
