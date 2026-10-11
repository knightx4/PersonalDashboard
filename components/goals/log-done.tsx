'use client';

import { useRef, useState, useTransition } from 'react';
import { Undo2 } from 'lucide-react';
import { AddTrigger } from '@/components/ui/add-trigger';
import { Button } from '@/components/ui/button';
import { FieldError, Input } from '@/components/ui/field';
import { PaidCostsProvider, PaidHint } from '@/components/ui/paid-hint';
import { cn } from '@/lib/cn';
import { describeFiled, estimateAsked, type FiledEntry } from '@/lib/goals/capture';
import {
  ESTIMATE_CHIPS,
  ESTIMATE_QUESTION,
  PROGRESS_ESTIMATES,
  type ProgressEstimate,
} from '@/lib/goals/progress';
import type { PaidCosts } from '@/lib/core/spend/paid-actions';
import {
  estimateGoalCapture,
  fileGoalCapture,
  goalCaptureCosts,
  undoGoalCapture,
} from '@/app/goals/capture-actions';

/**
 * The "What did you do?" box on Home and on each goal's page (plan #1740).
 *
 * A line such as "cleaned the kitchen and did laundry" is filed against your
 * goals the way quick capture files it (fileGoalCapture): progress on a step,
 * a closed step, a count towards a rhythm, or finished work no step fits
 * added as a step already closed. What it was filed as is listed under the
 * box, each line with its Undo, and the first progress on a step with no
 * total asks once how far along it is, as capture's lines do. On a goal's
 * page `goalId` names that goal, which filing is told as the likely one.
 *
 * The lines leave out the goal's name: on a goal's page the page names it,
 * and on Home each row of Done today beneath says it.
 *
 * Until it is pressed the box is one quiet line (law 14), and it goes back
 * to that line once what was written is filed, with the filed lines and
 * their Undo under it. A failure keeps the box open with what was written.
 * Escape on an empty box closes it.
 */

type Filed = { captureId: string; entries: FiledEntry[] };

const PAID = 'app/goals/capture-actions.ts#fileGoalCapture' as const;

/** What the box says once a line is filed. */
function filedMessage(count: number): string {
  if (count === 0) return 'Kept. Nothing in it matched an open goal.';
  return count === 1 ? 'Filed as one change.' : `Filed as ${count} changes.`;
}

/** A filed line without its goal's name. */
export function describeLogged(entry: FiledEntry): string {
  const goal = entry.goal_title;
  return describeFiled(entry)
    .replace(` in ${goal}`, '')
    .replace(` against ${goal}`, '')
    .replace(` for ${goal}`, '')
    .replace(` on ${goal}`, '');
}

export function LogDone({
  goalId = null,
  label = 'Log what you did',
  placeholder = 'What did you do?',
  initial = [],
  initialMessage,
  initialOpen = false,
  className,
}: {
  /** The line the box is until it is pressed. */
  label?: string;
  /** Drawn open, for the gallery. */
  initialOpen?: boolean;
  /** The goal whose page this is, passed to filing as the hint. */
  goalId?: string | null;
  placeholder?: string;
  /** Lines already filed, for the gallery. */
  initial?: Filed[];
  initialMessage?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(initialOpen);
  const [text, setText] = useState('');
  const [filed, setFiled] = useState<Filed[]>(initial);
  const [message, setMessage] = useState<string | undefined>(initialMessage);
  const [error, setError] = useState<string | null>(null);
  const [costs, setCosts] = useState<PaidCosts | null>(null);
  const [pending, start] = useTransition();
  const fieldRef = useRef<HTMLInputElement>(null);

  /** The $ figure for Log it, asked for the first time the box is used. */
  function price() {
    if (costs !== null) return;
    setCosts({});
    goalCaptureCosts()
      .then(setCosts)
      .catch(() => {});
  }

  function submit() {
    if (pending || !text.trim()) return;
    start(async () => {
      const result = await fileGoalCapture(text, null, goalId);
      if (result.error || !result.captureId) {
        setError(result.error ?? 'Nothing was filed.');
        setMessage(undefined);
        return;
      }
      const entries = result.filed ?? [];
      setError(null);
      setMessage(filedMessage(entries.length));
      if (entries.length > 0) {
        const added = { captureId: result.captureId, entries };
        setFiled((list) => [added, ...list]);
      }
      setText('');
      setOpen(false);
    });
  }

  function changed(captureId: string, entries: FiledEntry[]) {
    setFiled((list) =>
      list.map((item) => (item.captureId === captureId ? { captureId, entries } : item)),
    );
  }

  return (
    <div className={cn('space-y-2', className)}>
      {!open && (
        <AddTrigger
          label={label}
          onClick={() => {
            setOpen(true);
            setMessage(undefined);
            price();
          }}
        />
      )}
      {open && (
        <form
          className="flex items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <Input
            ref={fieldRef}
            value={text}
            onChange={(event) => {
              setText(event.target.value);
              if (message || error) {
                setMessage(undefined);
                setError(null);
              }
            }}
            onKeyDown={(event) => {
              if (event.key === 'Escape' && !text.trim()) setOpen(false);
            }}
            autoFocus={!initialOpen}
            placeholder={placeholder}
            aria-label="What did you do?"
            aria-invalid={error ? true : undefined}
            className="min-w-0 flex-1 max-sm:h-11"
          />
          <Button type="submit" variant="secondary" pending={pending} className="max-sm:h-11">
            {pending ? 'Logging…' : 'Log it'}
          </Button>
          <PaidCostsProvider costs={costs ?? {}}>
            <PaidHint action={PAID} what="Cost of logging it" align="end" />
          </PaidCostsProvider>
        </form>
      )}
      {message && (
        <p role="status" aria-live="polite" className="text-small text-ink-muted">
          {message}
        </p>
      )}
      {error && <FieldError>{error}</FieldError>}
      {filed.map((item) => (
        <LoggedLines key={item.captureId} filed={item} onChanged={changed} />
      ))}
    </div>
  );
}

/** One filing's lines, each with Undo, and the how-far-along chips where asked. */
function LoggedLines({
  filed,
  onChanged,
}: {
  filed: Filed;
  onChanged: (captureId: string, entries: FiledEntry[]) => void;
}) {
  const [busy, setBusy] = useState<number | null>(null);
  const [answering, setAnswering] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, start] = useTransition();

  function undo(index: number) {
    setBusy(index);
    setError(null);
    start(async () => {
      const result = await undoGoalCapture(filed.captureId, index);
      setBusy(null);
      if (result.error || !result.filed) {
        setError(result.error ?? 'That could not be undone.');
        return;
      }
      onChanged(filed.captureId, result.filed);
    });
  }

  function answer(index: number, estimate: ProgressEstimate) {
    setAnswering(index);
    setError(null);
    start(async () => {
      const result = await estimateGoalCapture(filed.captureId, index, estimate);
      setAnswering(null);
      if (result.error || !result.filed) {
        setError(result.error ?? 'That could not be kept.');
        return;
      }
      onChanged(filed.captureId, result.filed);
    });
  }

  if (filed.entries.length === 0) return null;
  return (
    <div>
      <ul className="space-y-1">
        {filed.entries.map((entry, index) => (
          <li key={index} className="text-small">
            <div className="flex items-start gap-2">
              <span
                className={cn(
                  'min-w-0 flex-1 py-1',
                  entry.undone_at ? 'text-ink-muted line-through' : 'text-ink',
                )}
              >
                {describeLogged(entry)}
              </span>
              {entry.undone_at ? (
                <span className="shrink-0 px-2.5 py-1 text-ink-muted">Undone</span>
              ) : (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  pending={busy === index}
                  onClick={() => undo(index)}
                >
                  <Undo2 className="size-3.5" strokeWidth={1.75} aria-hidden />
                  Undo
                </Button>
              )}
            </div>
            {estimateAsked(entry) && (
              <div role="group" aria-label={ESTIMATE_QUESTION} className="pb-1">
                <p className="text-ink-muted">{ESTIMATE_QUESTION}</p>
                <div className="-ml-2.5 flex flex-wrap gap-1">
                  {PROGRESS_ESTIMATES.map((estimate) => (
                    <button
                      key={estimate}
                      type="button"
                      disabled={answering !== null}
                      onClick={() => answer(index, estimate)}
                      className="press rounded-full px-2.5 py-1 text-small font-medium text-ink-muted transition-colors duration-quick hover:bg-accent-tint hover:text-accent disabled:opacity-50"
                    >
                      {ESTIMATE_CHIPS[estimate]}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </li>
        ))}
      </ul>
      {error && <FieldError>{error}</FieldError>}
    </div>
  );
}
