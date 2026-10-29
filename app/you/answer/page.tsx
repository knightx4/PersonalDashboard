import { requireUser } from '@/lib/auth/server';
import { loadAccountSettings } from '@/lib/core/account/settings';
import { goalsRoutine } from '@/lib/feedback/routine';
import { formatDateTime } from '@/lib/jobs/applications/load';
import { createYouClient } from '@/lib/you/auth/server';
import { loadDashQuestions } from '@/lib/you/dash-questions';
import { latestQuestionRun, questionRunState } from '@/lib/you/dash-questions-run';
import { AnswerView } from './answer-view';
import { AskDash, AskDashStatus } from './ask-dash';

export const metadata = { title: 'Answer' };
export const dynamic = 'force-dynamic';

/**
 * You's Answer tab (plan #2617.2): Dash's questions about you, open ones to
 * answer or skip, then your answers to edit and the skipped ones folded, and
 * the press that asks Dash for more (plan #2617.3). A
 * failed read throws to the You error boundary (app/you/error.tsx).
 */
export default async function Page() {
  const user = await requireUser();
  const you = await createYouClient();
  const [{ open, past }, latest, settings] = await Promise.all([
    loadDashQuestions(you, user.id),
    latestQuestionRun(you, user.id),
    loadAccountSettings(user.id),
  ]);
  const routine = goalsRoutine();
  const available = Boolean(routine.id && routine.token);
  const run = questionRunState(latest);
  return (
    <AnswerView
      open={open}
      past={past}
      timezone={settings.timezone}
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
