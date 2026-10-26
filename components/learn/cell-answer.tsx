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
  onNext,
  endHref,
  onEnd,
  endLabel,
  endShort,
  holdForward,
  pinForward,
}: {
  asked: AskedCellView;
  nextHref?: string;
  /** Next and End pressed in place, for a session drawn on one screen (plan #2546.3). */
  onNext?: () => void;
  endHref?: string;
  onEnd?: () => void;
  endLabel?: string;
  endShort?: string;
  holdForward?: boolean;
  pinForward?: boolean;
}) {
  // A question left with its hint up opens on the hint (plan #2522.7).
  const [state, action] = useActionState<CellAnswerState, FormData>(answerCellQuestion, {
    moved: null,
    error: null,
    ...(asked.resume ? { hint: asked.resume.hint, response: asked.resume.hint.response, howSure: asked.resume.howSure } : {}),
  });
  return <CellAnswerView asked={asked} state={state} action={action} nextHref={nextHref} onNext={onNext} endHref={endHref} onEnd={onEnd} endLabel={endLabel} endShort={endShort} holdForward={holdForward} pinForward={pinForward} />;
}
