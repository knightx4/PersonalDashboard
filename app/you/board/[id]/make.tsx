'use client';

import { useId, useMemo, useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { CheckRow, FieldError, Label, Select } from '@/components/ui/field';
import Link from '@/components/ui/link';
import { Segmented } from '@/components/ui/segmented';
import { whenWeekday } from '@/lib/core/when';
import { heldOnLabel } from '@/lib/you/board';
import type { DebateQuestion } from '@/lib/you/board-debate';
import {
  makeCandidates,
  stillToMake,
  type GoalChoice,
  type MadeItem,
  type MakeTarget,
} from '@/lib/you/board-make';

/**
 * Make it happen, under a decision (plan #2561.9). The decided option and the
 * verdict's conditions, each ticked to be written as a todo or as a step under
 * one of the person's goals, dated where the words give a date. Nothing is
 * written until Write is pressed; each written row is recorded on Home with an
 * Undo, links back to the question, and is listed here afterwards.
 */

export type MakeAction = (
  id: string,
  keys: string[],
  target: MakeTarget,
) => Promise<{ error: string | null; made?: MadeItem[] }>;

export type MakeProps = {
  action: MakeAction;
  goals: readonly GoalChoice[];
  /** Today in the person's zone, YYYY-MM-DD, for dates written without a year. */
  today: string;
  /** For the gallery: draw the card with steps chosen and this goal picked. */
  start?: { mode: 'todo' | 'goal'; goalId: string };
};

function dayText(day: string): string {
  return `${whenWeekday(day, { timeZone: 'UTC', style: 'short' })} ${heldOnLabel(day).replace(/ \d{4}$/, '')}`;
}

type Mode = 'todo' | 'goal';

export function MakeItHappen({
  question,
  make,
  failed: startError = null,
}: {
  question: DebateQuestion;
  make: MakeProps;
  /** For the gallery: draw the card with this error showing. */
  failed?: string | null;
}) {
  const [made, setMade] = useState<readonly MadeItem[]>(question.made);
  const candidates = useMemo(
    () => stillToMake(makeCandidates(question, make.today), made),
    [question, make.today, made],
  );
  const [unticked, setUnticked] = useState<ReadonlySet<string>>(new Set());
  const [mode, setMode] = useState<Mode>(make.start?.mode ?? 'todo');
  const [goalId, setGoalId] = useState(make.start?.goalId ?? '');
  const [error, setError] = useState<string | null>(startError);
  const [pending, startTransition] = useTransition();
  const goalSelectId = useId();
  const errorId = useId();

  const chosen = candidates.filter((c) => !unticked.has(c.key));
  const needsGoal = mode === 'goal' && goalId === '';

  if (candidates.length === 0 && made.length === 0) return null;

  function write() {
    setError(null);
    const target: MakeTarget = mode === 'todo' ? { kind: 'todo' } : { kind: 'goal', goalId };
    startTransition(async () => {
      const result = await make.action(
        question.id,
        chosen.map((c) => c.key),
        target,
      );
      if (result.made?.length) {
        setMade((current) => [...current, ...(result.made ?? [])]);
        setUnticked(new Set());
      }
      if (result.error) setError(result.error);
    });
  }

  return (
    <Card padding="standard" className="space-y-3" data-board-make>
      <p className="text-body font-semibold text-ink">Make it happen</p>

      {made.length > 0 && (
        <div className="space-y-1">
          <p className="text-small font-medium text-ink-muted">Made from this decision</p>
          <ul className="space-y-1.5">
            {made.map((item) => (
              <li key={item.id} className="text-body text-ink [overflow-wrap:anywhere]">
                <Link href={item.href}>{item.title}</Link>
                <span className="block text-small text-ink-muted">
                  {item.kind === 'todo' ? 'Todo' : item.goal ? `Step under ${item.goal}` : 'Step'}
                  {item.dueOn ? `, due ${dayText(item.dueOn)}` : ''}
                  {item.done ? ', done' : ''}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {candidates.length > 0 && (
        <>
          <fieldset className="space-y-0.5" disabled={pending}>
            <legend className="mb-1 text-small font-medium text-ink-muted">
              {made.length > 0 ? 'Still to write' : 'Write these'}
            </legend>
            {candidates.map((c) => (
              <CheckRow
                key={c.key}
                checked={!unticked.has(c.key)}
                onChange={(event) =>
                  setUnticked((current) => {
                    const next = new Set(current);
                    if (event.target.checked) next.delete(c.key);
                    else next.add(c.key);
                    return next;
                  })
                }
                title={<span className="[overflow-wrap:anywhere]">{c.text}</span>}
                hint={
                  <>
                    {c.role === 'action' ? 'What you decided' : 'Condition'}
                    {c.dueOn ? `, due ${dayText(c.dueOn)}` : ''}
                  </>
                }
              />
            ))}
          </fieldset>

          <div className="space-y-2">
            <Segmented<Mode>
              label="Write them as"
              value={mode}
              disabled={pending}
              onChange={setMode}
              options={[
                { value: 'todo', label: 'Todos' },
                { value: 'goal', label: 'Steps under a goal' },
              ]}
            />
            {mode === 'goal' &&
              (make.goals.length === 0 ? (
                <p className="text-ui text-ink-muted">You have no open goals to write steps under.</p>
              ) : (
                <div className="space-y-1">
                  <Label htmlFor={goalSelectId}>Goal</Label>
                  <Select
                    id={goalSelectId}
                    value={goalId}
                    disabled={pending}
                    onChange={(event) => setGoalId(event.target.value)}
                    className="w-full"
                  >
                    <option value="">Choose a goal</option>
                    {make.goals.map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.area ? `${g.area}: ${g.title}` : g.title}
                      </option>
                    ))}
                  </Select>
                </div>
              ))}
          </div>

          <FieldError id={errorId}>{error}</FieldError>

          <Button
            type="button"
            pending={pending}
            disabled={chosen.length === 0 || needsGoal || pending}
            onClick={write}
          >
            {pending
              ? 'Writing…'
              : chosen.length === 0
                ? 'Pick something to write'
                : `Write ${chosen.length === 1 ? 'it' : `${chosen.length} things`}`}
          </Button>
        </>
      )}
      {candidates.length === 0 && error && <FieldError id={errorId}>{error}</FieldError>}
    </Card>
  );
}
