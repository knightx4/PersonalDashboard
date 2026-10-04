'use client';

import { cn } from '@/lib/cn';
import { popoverSurface } from '@/components/ui/popover';
import { FiledLines } from '@/components/shell/capture';
import {
  CaptureFoot,
  CaptureHeader,
  FiledCaptures,
  PlaceLine,
} from '@/components/shell/capture-places';
import { captureAction, CAPTURE_ACTIONS, type CaptureAction } from '@/lib/capture/actions';
import { goalsPlaceName } from '@/lib/capture/destination';
import type { FiledCapture } from '@/lib/capture/place';
import type { CapturePlace, CaptureSort } from '@/lib/capture/sort';

/**
 * The one capture box (plan #1581) in the surface gallery, drawn twice from
 * fixtures: while a two-part sentence is typed, with the line saying where
 * each part will go, and after three things were filed, with a sentence Dash
 * is not sure about asking for a place. The real panel floats over the page;
 * here the same pieces sit in its surface without the scrim.
 */

const ACTION = captureAction('anything') as CaptureAction;
const PLACES: CapturePlace[] = ['todo', 'goals', 'jobs'];
const ROLE = { id: '00000000-0000-4000-8000-000000000002', title: 'Senior Product Analyst, Payments Risk', company: 'Stripe' };
const GOAL = { id: '00000000-0000-4000-8000-000000000001', title: 'Run a half marathon before the end of March' };

const TWO_PARTS: CaptureSort = {
  parts: [
    { place: 'jobs', text: 'Sent the cover letter to Stripe', goal: null, role: ROLE },
    { place: 'todo', text: 'chase Sam on Friday', goal: null, role: null },
  ],
  confidence: 0.92,
  sure: true,
};

const FILED: FiledCapture[] = [
  {
    place: 'todo',
    text: 'Book the dentist for the week after next',
    where: 'Todo · Today',
    href: '/todo',
    actionId: '00000000-0000-4000-8000-000000000011',
    goals: null,
    undoneAt: null,
  },
  {
    place: 'goals',
    text: 'Ran 10k this morning in 58 minutes, the furthest yet',
    where: `Goals · ${GOAL.title}`,
    href: '/goals',
    actionId: null,
    goals: {
      captureId: '00000000-0000-4000-8000-000000000012',
      entries: [
        {
          kind: 'close',
          step_id: '00000000-0000-4000-8000-000000000013',
          title: 'Run 10k without stopping',
          goal_title: GOAL.title,
          undone_at: null,
        },
      ],
    },
    undoneAt: null,
  },
  {
    place: 'jobs',
    text: 'Recruiter is Sam Okafor, second round is a case study',
    where: `Job search · ${ROLE.title} at ${ROLE.company}`,
    href: '/jobs',
    actionId: '00000000-0000-4000-8000-000000000014',
    goals: null,
    undoneAt: '2026-10-04T09:00:00Z',
  },
];

const nothing = () => {};

function Box({
  text,
  children,
}: {
  text: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn(popoverSurface, 'w-full overflow-hidden shadow-2xl')}>
      <CaptureHeader action={ACTION} actions={CAPTURE_ACTIONS} onSwitch={nothing} />
      <textarea
        readOnly
        value={text}
        placeholder={ACTION.placeholder}
        aria-label={ACTION.label}
        rows={3}
        data-focus-ring="none"
        className="w-full resize-none bg-transparent px-3 py-3 text-body text-ink outline-none placeholder:text-ink-ghost"
      />
      {children}
    </div>
  );
}

export function CaptureBoxSurface() {
  return (
    <div className="space-y-8 py-4">
      <Box text="Sent the cover letter to Stripe, chase Sam on Friday">
        <PlaceLine guess={{ state: 'answered', sort: TWO_PARTS }} places={PLACES} picked={null} onPick={nothing} />
        <CaptureFoot pending={false} costs={{}} />
      </Box>
      <Box text="Lunch with Priya">
        <PlaceLine
          guess={{ state: 'answered', sort: { parts: [], confidence: 0, sure: false } }}
          places={PLACES}
          picked={null}
          onPick={nothing}
        />
        <CaptureFoot pending={false} costs={{}} />
        <FiledCaptures
          filed={FILED}
          busy={null}
          error={null}
          onUndo={nothing}
          goalLines={(item) =>
            item.goals ? (
              <FiledLines filed={item.goals} onChanged={nothing} withinGoal={goalsPlaceName(item.goals.entries)} />
            ) : null
          }
        />
      </Box>
    </div>
  );
}
