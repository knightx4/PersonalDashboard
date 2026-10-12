'use client';

import { useActionState, useState } from 'react';
import { AddTrigger } from '@/components/ui/add-trigger';
import { Button } from '@/components/ui/button';
import { FieldError, Input } from '@/components/ui/field';
import { StatusGlyph } from '@/components/ui/status-glyph';

/**
 * What answering came back with: the answer written and whether Dash is
 * carrying on in the same run or a new one, or why it was refused.
 */
export type AnswerRunState = { error?: string; answered?: string; continued?: boolean };

export type AnswerRunAction = (prev: AnswerRunState, form: FormData) => Promise<AnswerRunState>;

const initial: AnswerRunState = {};

/**
 * Answering the question a run is waiting on (plan #1824): each choice is a
 * press that answers with it, and "Answer in your own words" opens a box for
 * anything else. A question asked without choices shows the box straight
 * away, since it is the only way to answer. One press answers, unlike a plan
 * decision's options, which fill the box first: a run is held while it waits,
 * and the choices were written for this moment.
 *
 * The action is the runs table's own, the plan's or the goals'
 * (app/dev/plan/run-actions.ts, app/goals/runs/[runId]/actions.ts). Once it
 * has gone through, the run's page draws your answer as a line and the
 * choices give way to it; until then this says it was sent.
 */
export function RunAnswer({
  runId,
  options,
  action,
}: {
  runId: string;
  options: readonly string[] | null;
  action: AnswerRunAction;
}) {
  const [state, answer, pending] = useActionState(action, initial);
  const choices = options ?? [];
  const [writing, setWriting] = useState(choices.length === 0);
  const placeholder = choices.length > 0 ? 'In your own words' : 'Your answer';

  if (state.answered !== undefined) {
    return (
      <p role="status" className="mt-1 flex items-center gap-1.5 text-small text-ink-muted">
        <StatusGlyph glyph="check" size={12} />
        <span>
          {state.continued
            ? 'Sent. Dash is starting again with your answer.'
            : 'Sent. Dash carries on with your answer.'}
        </span>
      </p>
    );
  }

  return (
    <div className="mt-1.5 space-y-1.5">
      {choices.length > 0 && (
        <form action={answer}>
          <input type="hidden" name="runId" value={runId} />
          <ul className="flex flex-wrap gap-1.5" aria-label="Answer with one of its choices">
            {choices.map((option) => (
              <li key={option} className="min-w-0 max-w-full">
                <Button
                  type="submit"
                  name="answer"
                  value={option}
                  size="sm"
                  variant="secondary"
                  disabled={pending}
                  className="h-auto min-h-7 max-w-full py-1 text-left break-words whitespace-normal"
                >
                  {option}
                </Button>
              </li>
            ))}
          </ul>
        </form>
      )}
      {writing ? (
        <form action={answer} className="flex items-center gap-1.5">
          <input type="hidden" name="runId" value={runId} />
          {/* The words in the box, as the answer boxes beside it in the
              inboxes have them, with the name read out from the same words. */}
          <Input
            name="answer"
            required
            maxLength={4000}
            autoFocus={choices.length > 0}
            placeholder={placeholder}
            aria-label={placeholder}
            className="min-w-0 flex-1"
          />
          <Button type="submit" size="sm" pending={pending}>
            Answer
          </Button>
        </form>
      ) : (
        <AddTrigger label="Answer in your own words" onClick={() => setWriting(true)} disabled={pending} />
      )}
      {state.error && <FieldError>{state.error}</FieldError>}
    </div>
  );
}
