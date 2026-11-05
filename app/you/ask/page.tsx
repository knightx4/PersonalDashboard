import { requireUser } from '@/lib/auth/server';
import { loadAccountSettings } from '@/lib/core/account/settings';
import { isOwner } from '@/lib/dev/owner';
import { goalsRoutine } from '@/lib/feedback/routine';
import { formatDateInline, formatDateTime } from '@/lib/jobs/applications/load';
import { createYouClient } from '@/lib/you/auth/server';
import { loadDashQuestions } from '@/lib/you/dash-questions';
import { latestQuestionRun, questionRunState } from '@/lib/you/dash-questions-run';
import { nextWeeklyAskAt } from '@/lib/you/dash-questions-triggers';
import { AskView } from './ask-view';
import { AskDash, AskDashStatus } from './ask-dash';

export const metadata = { title: 'Ask' };
export const dynamic = 'force-dynamic';

/**
 * You's Ask tab (plans #2617.2 and #2635.3): Dash's questions about you, open
 * ones grouped by area to answer or skip, then your answers to edit and the
 * skipped ones folded, and the press that asks Dash for more (plan #2617.3).
 * The old /you/answer address redirects here (next.config.ts). A failed read
 * throws to the You error boundary (app/you/error.tsx).
 */
export default async function Page() {
  const user = await requireUser();
  const you = await createYouClient();
  const [{ open, past }, latest, settings, owner] = await Promise.all([
    loadDashQuestions(you, user.id),
    latestQuestionRun(you, user.id),
    loadAccountSettings(user.id),
    isOwner({ user }),
  ]);
  const routine = goalsRoutine();
  const available = Boolean(routine.id && routine.token);
  const run = questionRunState(latest);

  // The weekly check runs for the owner only (inngest/you/dash-questions-tick.ts),
  // so only the owner is told a day.
  const responses = past.map((q) => q.answeredAt ?? q.skippedAt).filter((s): s is string => Boolean(s));
  const weekly = owner && available;
  const nextAt = weekly
    ? nextWeeklyAskAt({
        now: new Date().getTime(),
        latest,
        openCount: open.length,
        lastResponseAt: responses.length ? responses.reduce((a, b) => (a > b ? a : b)) : null,
      })
    : null;

  return (
    <AskView
      open={open}
      past={past}
      timezone={settings.timezone}
      nextAsk={nextAt ? formatDateInline(nextAt, settings.timezone) : null}
      weekly={weekly}
      ask={<AskDash run={run} available={available} />}
      notice={
        <AskDashStatus
          run={run}
          runWhen={latest ? formatDateTime(latest.requestedAt, settings.timezone) : null}
          available={available}
        />
      }
    />
  );
}
