'use client';

import { useActionState, useId } from 'react';
import { Button } from '@/components/ui/button';
import { DashAction } from '@/components/ui/dash-action';
import { FieldError, FieldHint, Textarea } from '@/components/ui/field';
import { marksLine, type CourseExplain } from '@/lib/learn/evidence/course-explain';
import { answerCourseExplainAction, type CourseExplainState } from './actions';

/**
 * The one explain prompt on a graded course row (plan #2172.4.2), and what
 * the answer showed once it is graded. The course's topics are marked as a
 * band of likely levels until then; the answer replaces the band with the
 * level it showed on each topic it went to.
 */

/** Under the course's name: what the answer showed, or the press that opens the prompt. */
export function CourseExplainLine({
  explain,
  onOpen,
}: {
  explain: CourseExplain;
  onOpen: () => void;
}) {
  if (explain.state === 'tested') {
    return <p className="mt-0.5 text-small text-ink-muted">{marksLine(explain.results)}</p>;
  }
  return (
    <Button type="button" variant="link" className="mt-0.5" onClick={onOpen}>
      Explain this course
    </Button>
  );
}

/** The prompt open on the row: the question, a box for the answer, and send. */
export function CourseExplainForm({
  courseId,
  question,
  onClose,
}: {
  courseId: string;
  question: string;
  onClose: () => void;
}) {
  const id = useId();
  const [state, send, sending] = useActionState<CourseExplainState, FormData>(answerCourseExplainAction, {});

  if (state.results) {
    return (
      <div className="mt-2 space-y-1" role="status">
        <p className="text-ui text-ink">{marksLine(state.results)}</p>
        <Button type="button" size="sm" variant="ghost" onClick={onClose}>
          Done
        </Button>
      </div>
    );
  }

  return (
    <form action={send} className="mt-2 space-y-2">
      <input type="hidden" name="id" value={courseId} />
      <label htmlFor={`${id}-answer`} className="block text-ui text-ink">
        {question}
      </label>
      <div>
        <Textarea
          id={`${id}-answer`}
          name="response"
          rows={5}
          required
          maxLength={8000}
          defaultValue={state.response ?? ''}
          aria-describedby={`${id}-hint`}
        />
        <FieldHint id={`${id}-hint`}>
          Dash grades it once. On each topic your answer reaches, the level it shows replaces the level your
          grade suggested.
        </FieldHint>
        <FieldError>{state.error}</FieldError>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <DashAction
          type="submit"
          size="sm"
          pending={sending}
          paid="app/you/work/actions.ts#answerCourseExplainAction"
          what="Cost of grading your explanation"
        >
          {sending ? 'Grading…' : 'Grade my explanation'}
        </DashAction>
        <Button type="button" size="sm" variant="ghost" onClick={onClose} disabled={sending}>
          Not now
        </Button>
      </div>
    </form>
  );
}
