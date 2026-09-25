'use client';

import { useActionState, useState } from 'react';
import { Check } from 'lucide-react';
import { AddTrigger } from '@/components/ui/add-trigger';
import { Button } from '@/components/ui/button';
import { ComposeTitle, FieldError } from '@/components/ui/field';
import { CommentThread } from '@/components/dev/comment-thread';
import {
  AnswerBox,
  TheAnswered,
  TheOptions,
  TheQuestion,
  useAnswerDraft,
} from '@/components/dev/question';
import type { PlanRefTitles } from '@/lib/comments/refs';
import { isClosed, isDismissed } from '@/lib/plan/load';
import { cn } from '@/lib/cn';
import {
  PLAN_COMMENTS,
  type TreeAction,
  type TreeActionState,
  type TreeActions,
  type TreeComments,
  type TreeQuestion,
  type TreeQuestionHolder,
} from './types';
import { useSettled } from './use-settled';

/**
 * Raise a question against a step, from the step.
 *
 * One field, because a question is one sentence. It becomes a decision beneath
 * the step -- the same row kind the shaping sessions write -- so a question
 * asked here and a question proposed by a session are the same object, answered
 * the same way and carried into the same briefs. The options, if there turn out
 * to be options worth writing down, go in through Edit like any other detail.
 */
function AskQuestion({
  node,
  ask,
  onDone,
}: {
  node: TreeQuestionHolder;
  ask: TreeAction;
  onDone: () => void;
}) {
  const [state, action, pending] = useActionState(ask, {} as TreeActionState);
  useSettled(state, onDone);

  return (
    <form action={action} className="space-y-2 rounded-lg bg-surface px-3 py-2.5">
      <input type="hidden" name="module" value={node.module ?? ''} />
      <input type="hidden" name="parent" value={node.id} />
      <input type="hidden" name="kind" value="decision" />
      <ComposeTitle
        name="title"
        autoFocus
        aria-label="The question"
        placeholder="What has to be decided before this can be built?"
      />
      <div className="flex flex-wrap items-center gap-2">
        <FieldError>{state.error}</FieldError>
        <div className="ml-auto flex items-center gap-1">
          <Button type="button" size="sm" variant="ghost" onClick={onDone}>
            Cancel
          </Button>
          <Button type="submit" size="sm" pending={pending}>
            {pending ? 'Asking…' : 'Ask'}
          </Button>
        </div>
      </div>
    </form>
  );
}

/**
 * One question in a step's questions section.
 *
 * Open, it is the question with a box to close it in. Answered, it is the
 * question with the answer under it, and changing your mind is a fresh answer
 * rather than an edit -- the same rule `AnswerDecision` keeps, for the same
 * reason: the record should show that a decision changed.
 *
 * Withdrawn is the other way out, and it is the "or close them" half of the
 * ask. A question that stopped mattering is dropped rather than answered with
 * something untrue, because a decision carrying an invented answer would be
 * repeated to every session that reads the feature from then on.
 */
export function QuestionRow({
  node,
  titles,
  actions,
  comments = PLAN_COMMENTS,
}: {
  node: TreeQuestion;
  titles?: PlanRefTitles;
  actions: Pick<TreeActions, 'answer' | 'setStatus' | 'dismissQuestion'>;
  comments?: TreeComments;
}) {
  const [answerState, answerAction, answerPending] = useActionState(
    actions.answer,
    {} as TreeActionState,
  );
  const [dropState, dropAction, dropPending] = useActionState(
    actions.setStatus,
    {} as TreeActionState,
  );
  const [dismissState, dismissAction, dismissPending] = useActionState(
    actions.dismissQuestion,
    {} as TreeActionState,
  );
  const [answering, setAnswering] = useState(false);
  useSettled(answerState, () => setAnswering(false));

  const settled = isClosed(node.status);
  // Only ever rendered under the Dismissed view: everywhere else the row is
  // pruned before it gets here.
  const aside = isDismissed(node);
  /**
   * Pressing an option opens the box with that option in it.
   *
   * The options were only clickable once you had already pressed Answer, so
   * from the outside they were three things that looked like buttons and did
   * nothing. `useAnswerDraft` writes the option into the box rather than
   * recording it; the callback is what opens the box, which does not exist yet
   * at the moment the option is pressed.
   */
  const { answer, setAnswer, choose } = useAnswerDraft(() => setAnswering(true));

  return (
    <li
      className={cn(
        'rounded-lg px-3 py-2.5',
        node.status === 'dropped'
          ? 'bg-sunken'
          : settled
            ? 'bg-positive-tint/40'
            : 'bg-caution-tint/40',
      )}
    >
      <div className="flex items-start gap-2">
        <span
          aria-hidden
          className={cn(
            'mt-0.5 shrink-0 text-small font-semibold',
            node.status === 'dropped'
              ? 'text-ink-ghost'
              : settled
                ? 'text-positive'
                : 'text-caution',
          )}
        >
          {settled && node.status !== 'dropped' ? (
            <Check className="size-3.5" strokeWidth={2} />
          ) : (
            '?'
          )}
        </span>
        <div className="min-w-0 flex-1 space-y-2">
          {/* Withdrawn, it is a record rather than a question: struck through,
              and none of the apparatus for answering it applies. */}
          {node.status === 'dropped' ? (
            <p className="text-ui text-ink-muted line-through">
              <span className="tabular mr-1.5 text-small text-ink-ghost">#{node.outline}</span>
              {node.title}
            </p>
          ) : (
            <>
              <TheQuestion outline={node.outline} title={node.title} />
              <TheOptions detail={node.detail} onChoose={settled ? undefined : choose} />
            </>
          )}

          {node.resolution && <TheAnswered resolution={node.resolution} />}

          {answering ? (
            <AnswerBox
              id={node.id}
              detail={node.detail}
              resolution={node.resolution}
              action={answerAction}
              pending={answerPending}
              answer={answer}
              onAnswer={setAnswer}
              autoFocus
              onCancel={() => {
                setAnswer('');
                setAnswering(false);
              }}
            />
          ) : (
            <div className="flex flex-wrap items-center gap-1">
              <Button type="button" size="sm" variant="ghost" onClick={() => setAnswering(true)}>
                {node.resolution ? 'Change the answer' : 'Answer'}
              </Button>
              {!settled && (
                <form action={dropAction}>
                  <input type="hidden" name="id" value={node.id} />
                  <input type="hidden" name="status" value="dropped" />
                  <Button type="submit" size="sm" variant="ghost" pending={dropPending}>
                    Withdraw
                  </Button>
                </form>
              )}
              {/* The third way out, and the one that says nothing about the
                  question: it is still open, still unanswered, and out of
                  sight until you come and get it. */}
              {!settled && (
                <form action={dismissAction}>
                  <input type="hidden" name="id" value={node.id} />
                  <input type="hidden" name="dismissed" value={aside ? '0' : '1'} />
                  <Button
                    type="submit"
                    size="sm"
                    variant={aside ? 'secondary' : 'ghost'}
                    pending={dismissPending}
                  >
                    {aside ? 'Bring back' : 'Not now'}
                  </Button>
                </form>
              )}
            </div>
          )}

          {/* A question is commented on where it is read, which is here: a
              decision beneath a step is deliberately not a row of its own in
              the tree, so this is the only place to say anything about it. */}
          {node.status !== 'dropped' && (
            <CommentThread
              target={comments.target}
              store={comments.store}
              id={node.id}
              thread={node.thread}
              label="Comment"
              titles={titles}
              placeholder="What is unclear about the question, or what you are weighing. Tag @dash to ask; either way it does not answer it."
            />
          )}

          <FieldError>{answerState.error ?? dropState.error ?? dismissState.error}</FieldError>
        </div>
      </div>
    </li>
  );
}

/**
 * The questions hanging off a step.
 *
 * A question raised while a feature was being shaped used to end up as a
 * sentence inside the detail paragraph, where it could be read and nothing
 * else: there was no way to answer it, nothing recorded that it had been
 * settled, and the next session read the same open question as though it were
 * part of the description of the work. Decisions already are the app's answer
 * to that -- a question closed by an answer rather than a commit -- but they
 * could only be reached as rows of their own, several levels into the tree,
 * which is not where you are standing when you read the step they are about.
 *
 * So this is that list, gathered on the step that raised them, with the box
 * that closes each one. Answered questions stay, because "we already decided
 * this" is the most useful thing a step can tell you; withdrawn ones stay too,
 * quietly, so a question does not simply vanish.
 */
export function Questions({
  node,
  titles,
  actions,
  comments = PLAN_COMMENTS,
}: {
  node: TreeQuestionHolder;
  titles?: PlanRefTitles;
  actions: Pick<TreeActions, 'answer' | 'setStatus' | 'dismissQuestion' | 'ask'>;
  comments?: TreeComments;
}) {
  const [asking, setAsking] = useState(false);
  const questions = node.children.filter((child) => child.kind === 'decision');
  const unanswered = questions.filter(
    (question) => !isClosed(question.status) && !isDismissed(question),
  ).length;

  if (questions.length === 0 && isClosed(node.status)) return null;

  return (
    <div className="space-y-2">
      <p className="text-small font-semibold uppercase tracking-wide text-ink-muted">
        Questions
        {unanswered > 0 && (
          <span className="ml-1.5 font-normal normal-case tracking-normal text-caution">
            {unanswered} unanswered
          </span>
        )}
      </p>

      {questions.length > 0 && (
        <ul className="space-y-1.5">
          {questions.map((question) => (
            <QuestionRow
              key={question.id}
              node={question}
              titles={titles}
              actions={actions}
              comments={comments}
            />
          ))}
        </ul>
      )}

      {asking ? (
        <AskQuestion node={node} ask={actions.ask} onDone={() => setAsking(false)} />
      ) : (
        !isClosed(node.status) && (
          // The same add line as "Wait on a step" below it, so the two offers
          // in an opened row share one glyph, one height and one indent.
          <AddTrigger
            label={questions.length === 0 ? 'Ask a question' : 'Ask another'}
            onClick={() => setAsking(true)}
          />
        )
      )}
    </div>
  );
}
