'use client';

import { useState, useTransition } from 'react';
import { MainRail } from '@/components/patterns/main-rail';
import { PageHeader } from '@/components/shell/page-header';
import { PageWide } from '@/components/shell/page-width';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { SectionFold } from '@/components/ui/disclosure';
import { EmptyState } from '@/components/ui/empty-state';
import { FieldError, Label, Textarea } from '@/components/ui/field';
import { LinkedText } from '@/components/ui/linked-text';
import { Stat } from '@/components/ui/stat';
import { sectionSubject } from '@/lib/core/section-path';
import { formatDateInline } from '@/lib/jobs/applications/load';
import {
  ANSWER_HREF,
  ANSWER_MAX,
  type DashQuestion,
  type DashQuestionResult,
} from '@/lib/you/dash-questions';
import { answerQuestion, editAnswer, skipQuestion } from './actions';

/**
 * You's Answer tab (plan #2617.2): the questions Dash has asked about you,
 * the open ones on top in the order it asked them, each with a box to answer
 * it and Skip; then what you answered, latest first, each with Edit; then the
 * skipped ones, folded, each of which can still be answered.
 *
 * The page re-reads after each press (the actions revalidate the tab), so a
 * question answered here moves from the open list to the answers by itself.
 *
 * `ask` is the slot for the press that has Dash write new questions (plan
 * #2617.3): in the header while there is anything on the tab, in the empty
 * state while there is nothing.
 */

export type AnswerActions = {
  answer: (id: string, answer: string) => Promise<DashQuestionResult>;
  skip: (id: string) => Promise<DashQuestionResult>;
  edit: (id: string, answer: string) => Promise<DashQuestionResult>;
};

const REAL_ACTIONS: AnswerActions = {
  answer: answerQuestion,
  skip: skipQuestion,
  edit: editAnswer,
};

/** For the gallery: draw a hidden part open. */
export type AnswerOpen = {
  /** The id of an answered question drawn with its answer being edited. */
  editing?: string;
  /** The skipped fold, open. */
  skipped?: boolean;
  /** The id of a skipped question drawn with its box open. */
  answering?: string;
  /** An error drawn under the question with this id, as a refused save shows it. */
  error?: { id: string; message: string; draft?: string };
};

export function AnswerView({
  open,
  past,
  timezone = 'UTC',
  ask,
  actions = REAL_ACTIONS,
  show = {},
}: {
  /** The open questions, oldest first. */
  open: readonly DashQuestion[];
  /** The answered and skipped ones, latest first. */
  past: readonly DashQuestion[];
  timezone?: string;
  /** The press that asks Dash for new questions (plan #2617.3). */
  ask?: React.ReactNode;
  actions?: AnswerActions;
  show?: AnswerOpen;
}) {
  const answered = past.filter((q) => q.status === 'answered');
  const skipped = past.filter((q) => q.status === 'skipped');
  const nothing = open.length === 0 && past.length === 0;
  const errorFor = (id: string) => (show.error?.id === id ? show.error.message : null);

  const main = (
    <>
      <PageHeader
        subject={sectionSubject(ANSWER_HREF, 'Answer')}
        title="Answer"
        actions={nothing ? undefined : ask}
      />
      {nothing ? (
        <EmptyState
          size="box"
          title="No questions yet"
          description="Dash asks a few questions about you here at a time. It reads what you answer when it answers you or works on your goals, and leaves out any you skip."
        >
          {ask}
        </EmptyState>
      ) : (
        <div className="space-y-8">
          {/* No "(0)" when nothing waits (law 1): the empty box below says it. */}
          <SectionFold
            title="Waiting for you"
            count={open.length || undefined}
            remember="you.answer.open"
          >
            {open.length === 0 ? (
              <EmptyState
                size="box"
                titleAs="h3"
                title="Nothing waiting"
                description="Every question Dash asked has an answer or a skip."
              />
            ) : (
              <Card padding="none">
                <ol className="divide-y divide-border">
                  {open.map((q) => (
                    <li key={q.id} className="px-4 py-4">
                      <OpenQuestion
                        question={q}
                        actions={actions}
                        initialError={errorFor(q.id)}
                        initialDraft={show.error?.id === q.id ? (show.error.draft ?? '') : ''}
                      />
                    </li>
                  ))}
                </ol>
              </Card>
            )}
          </SectionFold>

          {answered.length > 0 ? (
            <SectionFold
              title="Your answers"
              count={answered.length}
              remember="you.answer.answered"
            >
              <Card padding="none">
                <ul className="divide-y divide-border">
                  {answered.map((q) => (
                    <li key={q.id} className="px-4 py-3">
                      <PastAnswer
                        question={q}
                        timezone={timezone}
                        onSave={actions.edit}
                        initialEditing={show.editing === q.id}
                        initialError={errorFor(q.id)}
                      />
                    </li>
                  ))}
                </ul>
              </Card>
            </SectionFold>
          ) : null}

          {skipped.length > 0 ? (
            <SectionFold
              title="Skipped"
              count={skipped.length}
              defaultOpen={show.skipped ?? false}
              remember="you.answer.skipped"
            >
              <Card padding="none">
                <ul className="divide-y divide-border">
                  {skipped.map((q) => (
                    <li key={q.id} className="px-4 py-3">
                      <SkippedQuestion
                        question={q}
                        timezone={timezone}
                        onSave={actions.answer}
                        initialAnswering={show.answering === q.id}
                        initialError={errorFor(q.id)}
                      />
                    </li>
                  ))}
                </ul>
              </Card>
            </SectionFold>
          ) : null}
        </div>
      )}
    </>
  );

  // Before anything is asked the empty state says all of it: a rail saying it
  // again would be the same sentence twice, so the page is one wide column.
  if (nothing) return <PageWide>{main}</PageWide>;

  return (
    <MainRail
      main={main}
      rail={
        <Card padding="standard" className="space-y-3">
          {/* No "0 answered" before the first answer (law 1): the sentence says it alone. */}
          {answered.length > 0 ? (
            <Stat
              value={answered.length}
              label={answered.length === 1 ? 'answer Dash reads' : 'answers Dash reads'}
            />
          ) : null}
          <p className="text-small text-ink-muted">
            Dash reads your answers when it answers you or works on your goals. It does not read a
            question you skip.
          </p>
        </Card>
      }
    />
  );
}

/** Why a question was asked, as Dash wrote it: one muted line under it. */
function Why({ why }: { why: string | null }) {
  if (!why) return null;
  return <p className="text-small text-ink-muted [overflow-wrap:anywhere]">{why}</p>;
}

/** One open question: the question, why Dash asked, a box, Save answer and Skip. */
function OpenQuestion({
  question,
  actions,
  initialError,
  initialDraft = '',
}: {
  question: DashQuestion;
  actions: AnswerActions;
  initialError: string | null;
  initialDraft?: string;
}) {
  const [draft, setDraft] = useState(initialDraft);
  const [error, setError] = useState<string | null>(initialError);
  const [saving, startSaving] = useTransition();
  const [skipping, startSkipping] = useTransition();
  const fieldId = `answer-${question.id}`;
  const errorId = `${fieldId}-error`;
  const settle = (result: DashQuestionResult) => setError(result.ok ? null : result.error);
  return (
    <div className="space-y-3" data-answer-question>
      <div className="space-y-1">
        <Label
          htmlFor={fieldId}
          className="text-body font-medium text-ink [overflow-wrap:anywhere]"
        >
          {question.question}
        </Label>
        <Why why={question.why} />
      </div>
      <Textarea
        id={fieldId}
        value={draft}
        maxLength={ANSWER_MAX}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        onChange={(event) => setDraft(event.target.value)}
      />
      <FieldError id={errorId}>{error}</FieldError>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          pending={saving}
          disabled={!draft.trim() || skipping}
          onClick={() => startSaving(async () => settle(await actions.answer(question.id, draft)))}
        >
          Save answer
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          pending={skipping}
          disabled={saving}
          onClick={() => startSkipping(async () => settle(await actions.skip(question.id)))}
        >
          Skip
        </Button>
      </div>
    </div>
  );
}

/**
 * The box that answers a question or changes an answer, with Save and
 * Cancel. Shared by an answer being edited and a skipped question reopened.
 */
function AnswerBox({
  id,
  label,
  initial,
  saveLabel,
  onSave,
  onCancel,
  initialError,
}: {
  id: string;
  label: string;
  initial: string;
  saveLabel: string;
  onSave: (answer: string) => Promise<DashQuestionResult>;
  onCancel: () => void;
  initialError: string | null;
}) {
  const [draft, setDraft] = useState(initial);
  const [error, setError] = useState<string | null>(initialError);
  const [saving, startSaving] = useTransition();
  const errorId = `${id}-error`;
  return (
    <div className="space-y-2">
      <Textarea
        id={id}
        aria-label={label}
        value={draft}
        maxLength={ANSWER_MAX}
        autoFocus
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        onChange={(event) => setDraft(event.target.value)}
      />
      <FieldError id={errorId}>{error}</FieldError>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          pending={saving}
          disabled={!draft.trim()}
          onClick={() =>
            startSaving(async () => {
              const result = await onSave(draft);
              if (result.ok) onCancel();
              else setError(result.error);
            })
          }
        >
          {saveLabel}
        </Button>
        <Button type="button" size="sm" variant="ghost" disabled={saving} onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

/** One answered question: the question, the answer, when, and Edit. */
function PastAnswer({
  question,
  timezone,
  onSave,
  initialEditing,
  initialError,
}: {
  question: DashQuestion;
  timezone: string;
  onSave: AnswerActions['edit'];
  initialEditing: boolean;
  initialError: string | null;
}) {
  const [editing, setEditing] = useState(initialEditing);
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <p className="min-w-0 text-ui font-medium text-ink [overflow-wrap:anywhere]">
          {question.question}
        </p>
        {editing ? null : (
          <Button
            type="button"
            size="xs"
            variant="ghost"
            className="shrink-0"
            aria-label={`Edit your answer to: ${question.question}`}
            onClick={() => setEditing(true)}
          >
            Edit
          </Button>
        )}
      </div>
      {editing ? (
        <AnswerBox
          id={`edit-${question.id}`}
          label={`Your answer to: ${question.question}`}
          initial={question.answer ?? ''}
          saveLabel="Save answer"
          onSave={(answer) => onSave(question.id, answer)}
          onCancel={() => setEditing(false)}
          initialError={initialError}
        />
      ) : (
        <>
          <p className="whitespace-pre-wrap text-body text-ink [overflow-wrap:anywhere]">
            <LinkedText text={question.answer ?? ''} refs={false} />
          </p>
          <p className="text-small text-ink-muted">
            Answered {formatDateInline(question.answeredAt, timezone)}
          </p>
        </>
      )}
    </div>
  );
}

/** One skipped question: the question, when it was skipped, and Answer, which opens the box. */
function SkippedQuestion({
  question,
  timezone,
  onSave,
  initialAnswering,
  initialError,
}: {
  question: DashQuestion;
  timezone: string;
  onSave: AnswerActions['answer'];
  initialAnswering: boolean;
  initialError: string | null;
}) {
  const [answering, setAnswering] = useState(initialAnswering);
  return (
    <div className="space-y-1.5">
      <p className="text-ui text-ink [overflow-wrap:anywhere]">{question.question}</p>
      {answering ? (
        <AnswerBox
          id={`reopen-${question.id}`}
          label={`Your answer to: ${question.question}`}
          initial=""
          saveLabel="Save answer"
          onSave={(answer) => onSave(question.id, answer)}
          onCancel={() => setAnswering(false)}
          initialError={initialError}
        />
      ) : (
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <p className="text-small text-ink-muted">
            Skipped {formatDateInline(question.skippedAt, timezone)}
          </p>
          <Button
            type="button"
            variant="link"
            aria-label={`Answer: ${question.question}`}
            onClick={() => setAnswering(true)}
          >
            Answer it
          </Button>
        </div>
      )}
    </div>
  );
}
