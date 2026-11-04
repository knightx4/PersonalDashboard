'use client';

import { useState, useTransition } from 'react';
import { PageHeader } from '@/components/shell/page-header';
import { PageWide } from '@/components/shell/page-width';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { SectionFold } from '@/components/ui/disclosure';
import { EmptyState } from '@/components/ui/empty-state';
import { FieldError, Textarea } from '@/components/ui/field';
import { LinkedText } from '@/components/ui/linked-text';
import { SectionLabel } from '@/components/ui/section-heading';
import { cn } from '@/lib/cn';
import { sectionSubject } from '@/lib/core/section-path';
import { formatDateInline } from '@/lib/jobs/applications/load';
import {
  ANSWER_HREF,
  ANSWER_MAX,
  groupByArea,
  type DashQuestion,
  type DashQuestionResult,
} from '@/lib/you/dash-questions';
import { answerQuestion, editAnswer, skipQuestion, unskipQuestion } from './actions';

/**
 * You's Ask tab (plans #2617.2 and #2635.3): the questions Dash has asked
 * about you. The open ones come first, under the life area each is about in
 * the order Dash asked them, with the ones about no area under Other. Each has
 * Answer, which opens its box (one at a time), and Skip, which a laptop shows
 * on hover and a phone always shows. Then what you answered, latest first,
 * each with Edit; then the skipped ones, folded, each of which can still be
 * answered or asked again.
 *
 * The page re-reads after each press (the actions revalidate the tab), so a
 * question answered here moves from the open list to the answers by itself.
 *
 * `ask` is the slot for the press that has Dash write new questions (plan
 * #2617.3): in the header while questions wait, and in the empty line when
 * none do, beside when Dash will next ask by itself. `notice` says how a run
 * is going, under the header.
 */

export type AnswerActions = {
  answer: (id: string, answer: string) => Promise<DashQuestionResult>;
  skip: (id: string) => Promise<DashQuestionResult>;
  unskip: (id: string) => Promise<DashQuestionResult>;
  edit: (id: string, answer: string) => Promise<DashQuestionResult>;
};

const REAL_ACTIONS: AnswerActions = {
  answer: answerQuestion,
  skip: skipQuestion,
  unskip: unskipQuestion,
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
  /** The id of a question drawn hovered, with its hover controls showing. */
  hover?: string;
  /** An error drawn under the question with this id, as a refused save shows it. */
  error?: { id: string; message: string; draft?: string };
};

/**
 * Shown on a phone or any touch screen; on a laptop only while its row is
 * hovered or holds the focus, or when the gallery draws the row hovered.
 */
function hoverOnly(held: boolean): string {
  return cn(
    'transition-opacity duration-quick focus-visible:opacity-100',
    !held &&
      'sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100 pointer-coarse:opacity-100',
  );
}

export function AskView({
  open,
  past,
  timezone = 'UTC',
  nextAsk = null,
  weekly = true,
  ask,
  notice,
  actions = REAL_ACTIONS,
  show = {},
}: {
  /** The open questions, oldest first. */
  open: readonly DashQuestion[];
  /** The answered and skipped ones, latest first. */
  past: readonly DashQuestion[];
  timezone?: string;
  /** The day Dash will next ask by itself, as a date in a sentence ("5 Nov"); null when unknown. */
  nextAsk?: string | null;
  /** Whether Dash asks by itself each week: the weekly check runs for the owner alone. */
  weekly?: boolean;
  /** The press that asks Dash for new questions (plan #2617.3). */
  ask?: React.ReactNode;
  /** How Dash's run for new questions is going, under the header (plan #2617.3). */
  notice?: React.ReactNode;
  actions?: AnswerActions;
  show?: AnswerOpen;
}) {
  const answered = past.filter((q) => q.status === 'answered');
  const skipped = past.filter((q) => q.status === 'skipped');
  const nothing = open.length === 0 && past.length === 0;
  const errorFor = (id: string) => (show.error?.id === id ? show.error.message : null);
  // One open question's box at a time; the rest stay a line or two each.
  const [answeringId, setAnsweringId] = useState<string | null>(
    show.error && open.some((q) => q.id === show.error?.id) ? show.error.id : null,
  );
  const groups = groupByArea(open);
  // A lone Other heading says nothing, so one group with no area goes unheaded.
  const headed = groups.length > 1 || (groups.length === 1 && groups[0].areaId !== null);
  const when = !weekly
    ? 'Ask Dash for more whenever you like.'
    : nextAsk
      ? `Dash asks a few more by itself on ${nextAsk}, or ask now.`
      : 'Dash asks a few more by itself once a week, after you answer or skip one.';

  const main = (
    <>
      <PageHeader
        subject={sectionSubject(ANSWER_HREF, 'Ask')}
        title="Ask"
        actions={open.length > 0 ? ask : undefined}
      />
      {notice ? <div className="mb-5 empty:hidden">{notice}</div> : null}
      {nothing ? (
        <EmptyState
          size="box"
          title="No questions yet"
          description={`Dash asks a few questions about you here at a time${weekly ? ', once a week after you answer' : ''}. It reads what you answer when it answers you or works on your goals, and leaves out any you skip.`}
        >
          {ask}
        </EmptyState>
      ) : (
        <div className="space-y-8">
          {open.length > 0 ? (
            <SectionFold title="Waiting for you" count={open.length} remember="you.answer.open">
              {/* One surface of rows; an area is a small heading inside it, above its questions. */}
              <Card padding="none">
                <ol>
                  {groups.flatMap((group, g) => [
                    ...(headed
                      ? [
                          <li
                            key={`area-${group.areaId ?? 'other'}`}
                            className={cn('px-4 pt-4', g > 0 && 'border-t border-border pt-5')}
                            data-ask-area={group.areaId ?? 'other'}
                          >
                            <SectionLabel as="h3">{group.name}</SectionLabel>
                          </li>,
                        ]
                      : []),
                    ...group.questions.map((q, i) => (
                      <li
                        key={q.id}
                        className={cn(
                          'group px-4 py-4',
                          // A hairline between questions; none under an area's heading.
                          headed ? i > 0 && 'border-t border-border' : (g > 0 || i > 0) && 'border-t border-border',
                          headed && i === 0 && 'pt-2',
                        )}
                      >
                        <OpenQuestion
                          question={q}
                          actions={actions}
                          answering={answeringId === q.id}
                          onAnswering={setAnsweringId}
                          hovered={show.hover === q.id}
                          initialError={errorFor(q.id)}
                          initialDraft={show.error?.id === q.id ? (show.error.draft ?? '') : ''}
                        />
                      </li>
                    )),
                  ])}
                </ol>
              </Card>
            </SectionFold>
          ) : (
            <EmptyState size="box" title="Nothing waiting for you" description={when}>
              {ask}
            </EmptyState>
          )}

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
                    <li key={q.id} className="group px-4 py-3">
                      <SkippedQuestion
                        question={q}
                        timezone={timezone}
                        actions={actions}
                        hovered={show.hover === q.id}
                        initialAnswering={show.answering === q.id}
                        initialError={errorFor(q.id)}
                      />
                    </li>
                  ))}
                </ul>
              </Card>
            </SectionFold>
          ) : null}

          {/* The count after the rows (the list pattern), on a quiet panel of its own. */}
          <Card padding="standard">
            <p className="text-small text-ink-muted">
              {answered.length > 0
                ? `Dash reads your ${answered.length === 1 ? 'answer' : `${answered.length} answers`} when it answers you or works on your goals. It does not read a question you skip.`
                : 'Dash reads your answers when it answers you or works on your goals. It does not read a question you skip.'}
            </p>
          </Card>
        </div>
      )}
    </>
  );

  return <PageWide>{main}</PageWide>;
}

/** Why a question was asked, as Dash wrote it: one muted line under it. */
function Why({ why }: { why: string | null }) {
  if (!why) return null;
  return <p className="text-small text-ink-muted [overflow-wrap:anywhere]">{why}</p>;
}

/** One open question: the question, why Dash asked, Answer, which opens a box, and Skip. */
function OpenQuestion({
  question,
  actions,
  answering,
  onAnswering,
  hovered,
  initialError,
  initialDraft = '',
}: {
  question: DashQuestion;
  actions: AnswerActions;
  /** Whether this question's box is the one open. */
  answering: boolean;
  /** Opens this question's box, closing any other, or closes it with null. */
  onAnswering: (id: string | null) => void;
  /** Drawn hovered, for the gallery. */
  hovered: boolean;
  initialError: string | null;
  initialDraft?: string;
}) {
  const [error, setError] = useState<string | null>(null);
  const [skipping, startSkipping] = useTransition();
  return (
    <div className="space-y-2" data-answer-question>
      <div className="space-y-1">
        <p className="text-body font-medium text-ink [overflow-wrap:anywhere]">{question.question}</p>
        <Why why={question.why} />
      </div>
      {answering ? (
        <AnswerBox
          id={`answer-${question.id}`}
          label={`Your answer to: ${question.question}`}
          initial={initialDraft}
          saveLabel="Save answer"
          onSave={(answer) => actions.answer(question.id, answer)}
          onCancel={() => onAnswering(null)}
          initialError={initialError}
        />
      ) : (
        <>
          <FieldError>{error}</FieldError>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={skipping}
              aria-label={`Answer: ${question.question}`}
              onClick={() => onAnswering(question.id)}
            >
              Answer
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              pending={skipping}
              className={hoverOnly(hovered || skipping)}
              aria-label={`Skip: ${question.question}`}
              onClick={() =>
                startSkipping(async () => {
                  const result = await actions.skip(question.id);
                  setError(result.ok ? null : result.error);
                })
              }
            >
              Skip
            </Button>
          </div>
        </>
      )}
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

/**
 * One skipped question: the question, when it was skipped, Answer it, which
 * opens the box, and Ask again, which puts it back with the open ones (shown
 * on hover on a laptop, always on a phone).
 */
function SkippedQuestion({
  question,
  timezone,
  actions,
  hovered,
  initialAnswering,
  initialError,
}: {
  question: DashQuestion;
  timezone: string;
  actions: AnswerActions;
  hovered: boolean;
  initialAnswering: boolean;
  initialError: string | null;
}) {
  const [answering, setAnswering] = useState(initialAnswering);
  const [error, setError] = useState<string | null>(null);
  const [unskipping, startUnskipping] = useTransition();
  return (
    <div className="space-y-1.5">
      <p className="text-ui text-ink [overflow-wrap:anywhere]">{question.question}</p>
      {answering ? (
        <AnswerBox
          id={`reopen-${question.id}`}
          label={`Your answer to: ${question.question}`}
          initial=""
          saveLabel="Save answer"
          onSave={(answer) => actions.answer(question.id, answer)}
          onCancel={() => setAnswering(false)}
          initialError={initialError}
        />
      ) : (
        <>
          <FieldError>{error}</FieldError>
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
            <Button
              type="button"
              variant="link"
              className={hoverOnly(hovered || unskipping)}
              disabled={unskipping}
              aria-label={`Ask again: ${question.question}`}
              onClick={() =>
                startUnskipping(async () => {
                  const result = await actions.unskip(question.id);
                  setError(result.ok ? null : result.error);
                })
              }
            >
              Ask again
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
