import Link from 'next/link';
import { RoutinesScreen } from '@/components/routines/routine-list';
import { routinesFor } from '@/lib/routines/registry';
import { routineView, runKey, type RoutineFacts } from '@/lib/routines/view';

/**
 * The Routines pages in Dev and Goals after their reads, from the real
 * registry and fixed facts: one routine that has never run, one whose clock
 * is turned off, one whose last run failed, and the rest finished.
 */

const NOW = Date.parse('2026-10-10T09:00:00Z');
const TZ = 'Europe/London';

const facts: RoutineFacts = {
  schedules: [
    { jobname: 'vision-review-weekly', schedule: '41 14 * * 0', active: true, lastStartedAt: '2026-10-04T14:41:00Z', lastStatus: 'succeeded', lastMessage: null },
    { jobname: 'spec-audit-weekly', schedule: '47 14 * * 1', active: true, lastStartedAt: null, lastStatus: null, lastMessage: null },
    { jobname: 'overnight-tick', schedule: '*/4 * * * *', active: true, lastStartedAt: '2026-10-10T08:56:00Z', lastStatus: 'succeeded', lastMessage: null },
    { jobname: 'inspiration-daily', schedule: '35 14 * * *', active: false, lastStartedAt: '2026-10-09T14:35:00Z', lastStatus: 'succeeded', lastMessage: null },
    { jobname: 'goals-reshape-tick', schedule: '3-59/10 * * * *', active: true, lastStartedAt: '2026-10-10T08:53:00Z', lastStatus: 'succeeded', lastMessage: null },
  ],
  runs: new Map([
    [runKey('plan_runs', 'audit'), { createdAt: '2026-10-05T14:47:30Z', status: 'finished', error: null }],
    [runKey('plan_runs', 'feature'), { createdAt: '2026-10-10T02:16:00Z', status: 'finished', error: null }],
    [runKey('plan_runs', 'notes'), { createdAt: '2026-10-10T06:00:00Z', status: 'failed', error: 'CLAUDE_NOTES_ROUTINE_TOKEN was refused: 401 Token is not authorized for this routine.' }],
    [runKey('goals_runs', 'daily'), { createdAt: '2026-10-10T12:33:57Z', status: 'done', error: null }],
    [runKey('goals_runs', 'weekly'), { createdAt: '2026-10-09T12:33:58Z', status: 'done', error: null }],
    [runKey('goals_runs', 'reshape'), { createdAt: '2026-10-09T21:52:00Z', status: 'done', error: null }],
  ]),
};

export function DevRoutinesSurface() {
  return (
    <RoutinesScreen
      description="What Dash does on a schedule for the app, and how each last went."
      routines={routinesFor('dev').map((routine) => routineView(routine, facts, NOW, TZ))}
    />
  );
}

export function GoalRoutinesSurface() {
  return (
    <RoutinesScreen
      description="What Dash does on a schedule for your goals, and how each last went."
      actions={
        <Link href="/goals/runs" className="text-small text-ink-muted underline-offset-2 hover:underline">
          Every run
        </Link>
      }
      routines={routinesFor('goals').map((routine) => routineView(routine, facts, NOW, TZ))}
    />
  );
}
