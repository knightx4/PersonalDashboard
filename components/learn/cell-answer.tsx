'use client';

import { useActionState } from 'react';
import { answerCellQuestion } from '@/app/learn/flow/cell-actions';
import { CellAnswerView, type AskedCellView, type CellAnswerState } from './cell-answer-view';

/**
 * An explain question about one level, wired to its action (plan #2138.5).
 * The screen itself is `CellAnswerView`, which the gallery draws in each
 * state.
 */
export function CellAnswer({
  asked,
  nextHref,
  endHref,
  endLabel,
  endShort,
  holdForward,
}: {
  asked: AskedCellView;
  nextHref: string;
  endHref?: string;
  endLabel?: string;
  endShort?: string;
  holdForward?: boolean;
}) {
  const [state, action] = useActionState<CellAnswerState, FormData>(answerCellQuestion, {
    moved: null,
    error: null,
  });
  return <CellAnswerView asked={asked} state={state} action={action} nextHref={nextHref} endHref={endHref} endLabel={endLabel} endShort={endShort} holdForward={holdForward} />;
}
