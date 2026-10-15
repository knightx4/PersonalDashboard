'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { Layers } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ChipSelect } from '@/components/ui/field';
import type { MoveReview } from '@/lib/learn/levels/move-store';
import { answerMoveReview, type AnswerState } from './actions';

/**
 * One thing the move left for the person to answer (plan #2138.4), as a row
 * with its answer at its foot.
 *
 * A placement Dash was unsure of: the idea, the topic and level it was put
 * on, why Dash was unsure, and a level to keep or move it to. The one button
 * reads Keep while the level is the one it sits at, and Move once another is
 * picked.
 *
 * An edge that runs downwards inside one topic: what needs what, and two
 * answers. The levels are right (the edge is not carried, the chain covers
 * the rest), or the prerequisite moves down to the level of the idea that
 * needs it.
 */

function Press({ children, label }: { children: React.ReactNode; label?: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" variant="secondary" pending={pending} aria-label={label}>
      {children}
    </Button>
  );
}

function Failure({ error }: { error?: string }) {
  if (!error) return null;
  return (
    <p role="alert" className="text-small text-danger">
      {error}
    </p>
  );
}

export function AssignmentRow({ review }: { review: MoveReview }) {
  const [state, answer] = useActionState<AnswerState, FormData>(answerMoveReview, {});
  const at = review.level ?? 1;
  const [level, setLevel] = useState(at);
  const ceiling = review.ceiling ?? 10;
  const moving = level !== at;

  return (
    <li className="card-pad-x row-pad space-y-1.5">
      <div className="min-w-0">
        <p className="text-ui font-medium text-ink [overflow-wrap:anywhere]">{review.conceptName}</p>
        {review.claim && <p className="line-clamp-2 text-small text-ink-muted">{review.claim}</p>}
        <p className="mt-1 text-small text-ink">{review.why}</p>
      </div>
      <form action={answer} className="flex flex-wrap items-center gap-2">
        <input type="hidden" name="id" value={review.id} />
        <input type="hidden" name="decision" value={moving ? 'moved' : 'kept'} />
        <span className="text-small text-ink-muted">{review.topicName ?? 'No topic'}</span>
        <ChipSelect
          name="level"
          value={String(level)}
          onChange={(e) => setLevel(Number(e.target.value))}
          aria-label={`Level of ${review.topicName ?? 'the topic'}`}
          className="[&_select]:min-h-11"
          icon={<Layers className="size-3.5" strokeWidth={1.75} />}
        >
          {Array.from({ length: ceiling }, (_, i) => i + 1).map((n) => (
            <option key={n} value={n}>
              Level {n}
            </option>
          ))}
        </ChipSelect>
        <span className="ml-auto">
          <Press>{moving ? `Move to level ${level}` : `Keep at level ${at}`}</Press>
        </span>
      </form>
      <Failure error={state.error} />
    </li>
  );
}

export function EdgeRow({ review }: { review: MoveReview }) {
  const [state, answer] = useActionState<AnswerState, FormData>(answerMoveReview, {});
  return (
    <li className="card-pad-x row-pad space-y-1.5">
      <div className="min-w-0">
        <p className="text-ui font-medium text-ink [overflow-wrap:anywhere]">
          {review.conceptName} needs {review.prerequisiteName ?? 'an idea'}
        </p>
        <p className="text-small text-ink-muted">{review.why}</p>
      </div>
      <div className="flex flex-wrap items-center justify-end gap-2">
        <form action={answer}>
          <input type="hidden" name="id" value={review.id} />
          <input type="hidden" name="decision" value="kept" />
          <Press>Levels are right</Press>
        </form>
        <form action={answer}>
          <input type="hidden" name="id" value={review.id} />
          <input type="hidden" name="decision" value="moved" />
          <Press label={`Move ${review.prerequisiteName ?? 'the prerequisite'} to level ${review.level ?? 1}`}>
            Move it to level {review.level ?? 1}
          </Press>
        </form>
      </div>
      <Failure error={state.error} />
    </li>
  );
}
