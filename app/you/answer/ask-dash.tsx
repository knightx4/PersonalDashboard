'use client';

import { useState, useTransition } from 'react';
import { useRefreshWhileRunning } from '@/app/you/board/refresh-while-running';
import { Banner } from '@/components/ui/banner';
import { Card } from '@/components/ui/card';
import { DashAction } from '@/components/ui/dash-action';
import { DashMark } from '@/components/ui/dash-mark';
import { FieldError } from '@/components/ui/field';
import { linkVariants } from '@/components/ui/link';
import type { QuestionRunState } from '@/lib/you/dash-questions-run';
import { askDash } from './actions';

/**
 * The press that has Dash write new questions on the Answer tab (plan
 * #2617.3), and the line that says how the run is going.
 *
 * AskDash is the button, drawn in the page header while there are questions
 * and inside the empty state before the first. While a run is queued or
 * running it shows Dash at work and cannot be pressed again; the server
 * refuses a second run as well (one open run per person, you 0034).
 *
 * AskDashStatus sits under the header: a run going, with when it started and
 * a link to watch it, or why the last one failed. Either way the page reads
 * itself again every minute while a run goes, so the questions appear when
 * it finishes.
 */

export type AskResult = { error: string | null };

export function AskDash({
  run,
  available,
  onAsk = askDash,
}: {
  run: QuestionRunState;
  /** Whether the deployment can start a run (both goals routine variables set). */
  available: boolean;
  onAsk?: () => Promise<AskResult>;
}) {
  const [starting, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  if (!available) return null;
  const running = run.kind === 'running';

  const ask = () =>
    startTransition(async () => {
      const result = await onAsk();
      setError(result.error);
    });

  return (
    <span className="inline-flex flex-col items-end gap-1">
      <DashAction
        type="button"
        variant="secondary"
        pending={starting || running}
        disabled={running}
        onClick={ask}
        routine="goals"
        what="Cost of new questions"
        align="end"
      >
        {running ? 'Dash is writing questions' : starting ? 'Starting…' : 'Ask me new questions'}
      </DashAction>
      <FieldError>{error}</FieldError>
    </span>
  );
}

export function AskDashStatus({
  run,
  runWhen,
  available,
}: {
  run: QuestionRunState;
  /** When the newest run was asked for, already written in their zone. */
  runWhen: string | null;
  available: boolean;
}) {
  const running = run.kind === 'running';
  useRefreshWhileRunning(running);

  if (!available) {
    return (
      <p className="text-ui text-ink-muted">
        Dash cannot write questions on this deployment yet. It needs CLAUDE_GOALS_ROUTINE_ID and
        CLAUDE_GOALS_ROUTINE_TOKEN in the project’s environment variables.
      </p>
    );
  }
  if (running) {
    return (
      <Card padding="standard" className="flex items-start gap-2.5" role="status">
        <DashMark state="working" activity="writing" decorative className="mt-0.5" />
        <p className="text-body text-ink">
          Dash is reading your notes and goals to write up to five new questions
          {runWhen ? `, started ${runWhen.replace(/^(Today|Yesterday)\b/, (day) => day.toLowerCase())}` : ''}. They appear here when it is done.
          {run.run.runUrl && (
            <>
              {' '}
              <a
                href={run.run.runUrl}
                target="_blank"
                rel="noreferrer noopener"
                className={linkVariants({ tone: 'quiet' })}
              >
                Watch the run
              </a>
            </>
          )}
        </p>
      </Card>
    );
  }
  if (run.kind === 'failed') return <Banner tone="warn">{run.error}</Banner>;
  return null;
}
