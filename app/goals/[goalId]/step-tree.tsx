'use client';

import { createContext, useActionState, useContext, useId, useState } from 'react';
import Link from 'next/link';
import { ChevronRight, CircleHelp, ListTree, Repeat, Sparkles, User } from 'lucide-react';
import { CommentCount } from '@/components/dev/comment-count';
import { AnswerBox, TheAnswered, TheOptions, useAnswerDraft } from '@/components/dev/question';
import { ActionMenu, type ActionMenuItem } from '@/components/ui/action-menu';
import { AddTrigger } from '@/components/ui/add-trigger';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { ComposeTitle, InlineInput, Input, Select, Textarea } from '@/components/ui/field';
import { StateLabel, TONE_TEXT } from '@/components/dev/state-label';
import { StatusGlyph } from '@/components/ui/status-glyph';
import { useToast } from '@/components/ui/toast';
import { cn } from '@/lib/cn';
import type { GoalMap } from '@/lib/goals/steps-store';
import {
  RHYTHM_COUNT_MAX,
  RHYTHM_PERIODS,
  STEP_ACCEPTANCE_MAX,
  STEP_DETAIL_MAX,
  STEP_KINDS,
  STEP_KIND_LABELS,
  STEP_TITLE_MAX,
  countSteps,
  describeRhythm,
  type StepKind,
  type StepNode,
} from '@/lib/goals/steps';
import { awaitsReview } from '@/lib/goals/daily';
import { countAside, countProposed } from '@/lib/goals/shaping';
import { goalProgress, questionsBeneath, stepNeeds, stepState } from '@/lib/goals/status';
import { canShowOnTodo } from '@/lib/goals/todo';
import { progressLine, type RhythmRecord } from '@/lib/goals/rhythms';
import {
  addStep,
  archiveStepAction,
  countRhythmAction,
  editStep,
  linkStepAction,
  moveStepAction,
  setStepOnTodoAction,
  setStepStatusAction,
  unlinkStepAction,
  type StepActionState,
} from './actions';
import { GoalProgress, QuestionMark } from '../goal-progress';
import { GoalThread } from './goal-comments';
import { InformationStep } from './information-step';
import {
  answerQuestionAction,
  reviewResultAction,
  setQuestionAsideAction,
  settleProposalAction,
  type ShapingActionState,
} from './shaping-actions';

/**
 * A goal's full tree (plan #925).
 *
 * Each step is a row: its status as a shape, its title edited in place, and
 * beneath it a line saying whose it is and anything else worth a glance (how
 * often a rhythm runs, when it is due, which other goals it counts towards).
 * A step with sub-steps folds, and the folded row says how many it holds.
 * Everything else a step can have sits in its menu or in the details it
 * opens, so the tree stays readable on a phone at four levels deep.
 */

const initial: StepActionState = {};

const KIND_ICONS: Record<StepKind, typeof User> = {
  mine: User,
  claude: Sparkles,
  decision: CircleHelp,
  rhythm: Repeat,
};

/**
 * Whether the Todo workspace is on, so a step offers Show on Todo only where
 * there is a Todo to show it on. Read once by the page and given to every row.
 */
const TodoOn = createContext(false);

/** Each rhythm step's current period and recent past ones (plan #928). */
const Rhythms = createContext<GoalMap['rhythms']>({});

/**
 * Whether questions put aside with Not now are shown (plan #956). Off, they
 * are left out of the tree until you ask to see them.
 */
const ShowAside = createContext(false);

/** The collections the information steps fill, with their records (plan #954). */
const Information = createContext<GoalMap['information']>({});

/** The comments on each step, keyed by step id (plan #957). */
const Threads = createContext<GoalMap['threads']>({});

type Links = GoalMap['linksOf'];
type OtherGoals = GoalMap['otherGoals'];

/** Wrap a row action for the menu, so a refusal is said in a toast rather than lost. */
function useMenuAction() {
  const toast = useToast();
  return (action: (form: FormData) => Promise<StepActionState>) => async (form: FormData) => {
    const result = await action(form);
    if (result.error) toast({ text: result.error });
  };
}

function commitOnBlur(before: string, { required = false }: { required?: boolean } = {}) {
  return (event: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const value = event.target.value.trim();
    if (required && value === '') {
      event.target.value = before;
      return;
    }
    if (value !== before) event.target.form?.requestSubmit();
  };
}

export function StepTree({ map, todoOn }: { map: GoalMap; todoOn: boolean }) {
  const progress = goalProgress(map.steps);
  const [showAside, setShowAside] = useState(false);
  const aside = countAside(map.steps);
  return (
    <ShowAside.Provider value={showAside}>
      <TodoOn.Provider value={todoOn}>
        <Rhythms.Provider value={map.rhythms}>
          <Information.Provider value={map.information}>
            <Threads.Provider value={map.threads}>
              <div className="space-y-6">
                <section aria-label="Steps" className="space-y-2">
                  <GoalProgress progress={progress} label={map.goal.title} className="px-1" />
                  {map.steps.length === 0 ? (
                    <EmptyState
                      icon={ListTree}
                      title="No steps yet"
                      description="Break the goal into the things that have to happen. Any step can hold sub-steps of its own."
                    />
                  ) : (
                    <Card>
                      <StepList
                        nodes={map.steps}
                        depth={0}
                        links={map.linksOf}
                        otherGoals={map.otherGoals}
                      />
                    </Card>
                  )}
                  {aside > 0 && (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      aria-pressed={showAside}
                      onClick={() => setShowAside(!showAside)}
                    >
                      {showAside
                        ? 'Hide the questions put aside'
                        : `Show ${aside === 1 ? 'the question' : `the ${aside} questions`} put aside`}
                    </Button>
                  )}
                  <StepComposer parentId={map.goal.id} label="New step" />
                </section>

                {map.linked.length > 0 && (
                  <section aria-labelledby="linked-heading" className="space-y-2">
                    <h2 id="linked-heading" className="px-1 text-ui font-semibold text-ink">
                      Also counts towards this goal
                    </h2>
                    <Card>
                      <ul className="divide-y divide-border">
                        {map.linked.map((entry) => (
                          <li key={entry.linkId}>
                            <p className="px-3 pt-2 text-small text-ink-muted">
                              From{' '}
                              <Link href={`/goals/${entry.fromGoal.id}`} className="underline">
                                {entry.fromGoal.title}
                              </Link>
                            </p>
                            <StepList
                              nodes={[entry.step]}
                              depth={0}
                              links={map.linksOf}
                              otherGoals={map.otherGoals}
                              unlinkId={entry.linkId}
                            />
                          </li>
                        ))}
                      </ul>
                    </Card>
                  </section>
                )}
              </div>
            </Threads.Provider>
          </Information.Provider>
        </Rhythms.Provider>
      </TodoOn.Provider>
    </ShowAside.Provider>
  );
}

function StepList({
  nodes,
  depth,
  links,
  otherGoals,
  unlinkId,
}: {
  nodes: StepNode[];
  depth: number;
  links: Links;
  otherGoals: OtherGoals;
  /** Set on a step shown here through a link, so its menu can remove the link. */
  unlinkId?: string;
}) {
  const showAside = useContext(ShowAside);
  const shown = showAside ? nodes : nodes.filter((node) => !node.dismissedAt);
  return (
    <ul className={cn(depth > 0 && 'ml-4 border-l border-border pl-1')}>
      {shown.map((node, index) => (
        <StepItem
          key={node.id}
          node={node}
          depth={depth}
          index={index}
          count={shown.length}
          links={links}
          otherGoals={otherGoals}
          unlinkId={unlinkId}
        />
      ))}
    </ul>
  );
}

function StepItem({
  node,
  depth,
  index,
  count,
  links,
  otherGoals,
  unlinkId,
}: {
  node: StepNode;
  depth: number;
  index: number;
  count: number;
  links: Links;
  otherGoals: OtherGoals;
  unlinkId?: string;
}) {
  const [open, setOpen] = useState(true);
  const [adding, setAdding] = useState(false);
  const [details, setDetails] = useState(false);
  const [editState, edit, editing] = useActionState(editStep, initial);
  const menuAction = useMenuAction();
  const toast = useToast();
  const childrenId = useId();
  const todoOn = useContext(TodoOn);
  const rhythms = useContext(Rhythms);
  const information = useContext(Information);
  const thread = useContext(Threads)[node.id] ?? [];
  const filled = node.collectionId ? information[node.collectionId] : undefined;
  const rhythm: RhythmRecord | undefined = node.kind === 'rhythm' ? rhythms[node.id] : undefined;
  const current = node.status === 'open' ? (rhythm?.current ?? null) : null;

  const closed = node.status === 'done' || node.status === 'dropped';
  const hasChildren = node.children.length > 0;
  const stepLinks = links[node.id] ?? [];
  const KindIcon = KIND_ICONS[node.kind];
  const state = stepState(node);

  async function archive(form: FormData) {
    const result = await archiveStepAction(form);
    if (result.error) {
      toast({ text: result.error });
      return;
    }
    toast({
      text: `Archived ${node.title}.`,
      undo: async () => {
        const restore = new FormData();
        restore.set('id', node.id);
        restore.set('restore', 'true');
        const back = await archiveStepAction(restore);
        if (back.error) throw new Error(back.error);
      },
    });
  }

  const status = menuAction(setStepStatusAction);
  // Show on Todo is offered on your open steps; taking one off is offered on
  // any step still flagged, so nothing can be stranded on Todo.
  const todoItem: ActionMenuItem[] = !todoOn
    ? []
    : node.onTodo
      ? [
          {
            id: 'todo',
            label: 'Take off Todo',
            formAction: menuAction(setStepOnTodoAction),
            formFields: { id: node.id, on: 'false' },
          },
        ]
      : canShowOnTodo(node)
        ? [
            {
              id: 'todo',
              label: 'Show on Todo',
              formAction: menuAction(setStepOnTodoAction),
              formFields: { id: node.id, on: 'true' },
            },
          ]
        : [];
  const countOne = menuAction(countRhythmAction);
  // Counting is offered on a rhythm with a period open now; the period is
  // named in the form, so a press after the week has turned is refused
  // rather than counted towards the new one.
  const rhythmItems: ActionMenuItem[] = current
    ? [
        {
          id: 'count',
          label: 'Count one',
          formAction: countOne,
          formFields: { id: node.id, startsOn: current.startsOn, by: '1' },
        },
        ...(current.count > 0
          ? [
              {
                id: 'uncount',
                label: 'Take one back',
                formAction: countOne,
                formFields: { id: node.id, startsOn: current.startsOn, by: '-1' },
              },
            ]
          : []),
      ]
    : [];
  const move = menuAction(moveStepAction);
  // A proposal's moves are to approve it or turn it down (plan #960), each
  // taking the proposed steps beneath it along. Mark done and Drop are not
  // offered on one: done is not a thing a proposal can be, and turning it
  // down is the drop.
  const proposed = node.status === 'proposed';
  const beneath = proposed ? countProposed(node.children) : 0;
  const settle = menuAction((form) => settleProposalAction({}, form));
  const statusItems: ActionMenuItem[] = proposed
    ? [
        {
          id: 'approve',
          label: beneath > 0 ? `Approve, with ${beneath} beneath` : 'Approve',
          formAction: settle,
          formFields: { id: node.id, approve: '1' },
        },
        {
          id: 'reject',
          label: beneath > 0 ? `Turn down, with ${beneath} beneath` : 'Turn down',
          formAction: settle,
          formFields: { id: node.id, approve: '0' },
        },
      ]
    : [
        closed
          ? {
              id: 'reopen',
              label: 'Reopen',
              formAction: status,
              formFields: { id: node.id, status: 'open' },
            }
          : {
              id: 'done',
              label: 'Mark done',
              formAction: status,
              formFields: { id: node.id, status: 'done' },
            },
      ];
  const items: ActionMenuItem[] = [
    ...rhythmItems,
    ...statusItems,
    ...todoItem,
    ...(closed || proposed
      ? []
      : [
          {
            id: 'drop',
            label: 'Drop',
            formAction: status,
            formFields: { id: node.id, status: 'dropped' },
          },
        ]),
    {
      id: 'sub',
      label: 'Add a sub-step',
      onSelect: () => {
        setAdding(true);
        setOpen(true);
      },
    },
    {
      id: 'details',
      label: details ? 'Hide details and comments' : 'Details and comments',
      onSelect: () => setDetails(!details),
    },
    ...(unlinkId
      ? []
      : [
          {
            id: 'up',
            label: 'Move up',
            disabled: index === 0,
            formAction: move,
            formFields: { id: node.id, direction: 'up' },
          },
          {
            id: 'down',
            label: 'Move down',
            disabled: index === count - 1,
            formAction: move,
            formFields: { id: node.id, direction: 'down' },
          },
        ]),
    ...(unlinkId
      ? [
          {
            id: 'unlink',
            label: 'Stop counting towards this goal',
            formAction: menuAction(unlinkStepAction),
            formFields: { linkId: unlinkId },
          },
        ]
      : []),
    {
      id: 'archive',
      label: 'Archive step',
      destructive: true,
      formAction: archive,
      formFields: { id: node.id },
      confirm: hasChildren
        ? `Archive ${node.title} and the ${countSteps(node.children).total} under it?`
        : undefined,
    },
  ];

  const meta = [
    node.kind === 'rhythm' && node.rhythmCount && node.rhythmPeriod
      ? describeRhythm(node.rhythmCount, node.rhythmPeriod)
      : null,
    current && node.rhythmPeriod ? progressLine(node.rhythmPeriod, current) : null,
    node.dueOn ? `Due ${formatDate(node.dueOn)}` : null,
    todoOn && node.onTodo && canShowOnTodo(node) ? 'On Todo' : null,
    !open && hasChildren ? `${countSteps(node.children).total} under it` : null,
  ].filter(Boolean);

  return (
    <li id={`step-${node.id}`} className="scroll-mt-4 py-1">
      <div className="flex items-start gap-1 px-2">
        {hasChildren ? (
          <button
            type="button"
            onClick={() => setOpen(!open)}
            aria-expanded={open}
            aria-controls={childrenId}
            aria-label={open ? `Fold ${node.title}` : `Unfold ${node.title}`}
            className="press mt-1 flex size-6 shrink-0 items-center justify-center rounded-control text-ink-muted hover:bg-sunken"
          >
            <ChevronRight
              className={cn('size-3.5 transition-transform duration-150', open && 'rotate-90')}
              strokeWidth={1.75}
              aria-hidden
            />
          </button>
        ) : (
          <span className="size-6 shrink-0" aria-hidden />
        )}
        <span className={cn('mt-2', TONE_TEXT[state.tone])} title={state.title}>
          <StatusGlyph glyph={state.glyph} label={state.word} />
        </span>
        <div className="min-w-0 flex-1">
          <form action={edit}>
            <input type="hidden" name="id" value={node.id} />
            <InlineInput
              name="title"
              required
              maxLength={STEP_TITLE_MAX}
              defaultValue={node.title}
              key={`title-${node.title}`}
              aria-label={`Rename ${node.title}`}
              disabled={editing}
              onBlur={commitOnBlur(node.title, { required: true })}
              className={cn(closed && 'text-ink-muted line-through')}
            />
          </form>
          <p className="flex flex-wrap items-center gap-x-2 px-1 text-small text-ink-muted">
            <StateLabel glyph={null} word={state.word} tone={state.tone} title={state.title} />
            {/* Questions waiting on you under a folded step, where they
                cannot be seen. Unfolded, they are on their own rows. */}
            {!open && <QuestionMark count={questionsBeneath(node)} />}
            <span className="inline-flex items-center gap-1">
              <KindIcon className="size-3" strokeWidth={1.75} aria-hidden />
              {STEP_KIND_LABELS[node.kind]}
            </span>
            {meta.map((line) => (
              <span key={line as string}>{line}</span>
            ))}
            {/* How many comments the step carries, while they are out of
                sight. Opens the details, where the thread is. */}
            {!details && thread.length > 0 && (
              <button
                type="button"
                onClick={() => setDetails(true)}
                className="press rounded-control hover:text-ink"
              >
                <CommentCount count={thread.length} />
              </button>
            )}
            {stepLinks.map((link) => (
              <Link key={link.linkId} href={`/goals/${link.goalId}`} className="underline">
                Also {link.title}
              </Link>
            ))}
          </p>
          {rhythm && rhythm.past.length > 0 && node.rhythmPeriod && (
            <PastPeriods past={rhythm.past} period={node.rhythmPeriod} />
          )}
          {node.kind === 'decision' &&
            node.status !== 'dropped' &&
            (node.status === 'open' || node.resolution !== null) && <Question node={node} />}
          {awaitsReview(node) && <ClaudeResult node={node} />}
          {filled && (
            <InformationStep node={node} collection={filled.collection} records={filled.records} />
          )}
          {editState.error && <p className="px-1 text-small text-danger">{editState.error}</p>}
          {details && (
            <StepDetails node={node} links={stepLinks} otherGoals={otherGoals} />
          )}
          {details && (
            <div className="px-1 pt-2">
              <GoalThread
                itemId={node.id}
                thread={thread}
                label="Comment"
                placeholder="A note on this step. Tag @dash to ask about it, or to give it figures to file."
              />
            </div>
          )}
        </div>
        <ActionMenu label={`${node.title} actions`} items={items} />
      </div>

      {(hasChildren || adding) && (
        <div id={childrenId} hidden={!open} className={cn(depth === 0 && 'pl-2')}>
          {hasChildren && (
            <StepList
              nodes={node.children}
              depth={depth + 1}
              links={links}
              otherGoals={otherGoals}
            />
          )}
          {adding && (
            <div className="ml-4 pl-1">
              <StepComposer
                parentId={node.id}
                label={`Sub-step of ${node.title}`}
                startOpen
                onClose={() => setAdding(false)}
              />
            </div>
          )}
        </div>
      )}
    </li>
  );
}

const answerInitial: ShapingActionState = {};

/**
 * A question Claude asked (plan #932), answered with its options (plan #956).
 *
 * The lettered options in its detail are buttons, with the one Claude
 * recommends marked; pressing one writes it into the box, where it can be
 * sent as it is or said differently. Answering closes the step and the next
 * run reads the answer. Not now puts an unanswered question out of sight
 * until it is brought back. An answered question shows its answer and can be
 * given a new one, which is kept in the goal's history with the one it
 * replaced. The pieces are the dev plan's, from components/dev/question.tsx.
 */
function Question({ node }: { node: StepNode }) {
  const [state, answerAction, answering] = useActionState(answerQuestionAction, answerInitial);
  const [asideState, asideAction, putting] = useActionState(setQuestionAsideAction, answerInitial);
  // The box is open when it was opened since the last answer was saved, so a
  // save closes it without an effect.
  const [openedAt, setOpenedAt] = useState<number | null>(null);
  const saved = state.done ?? 0;
  const { answer, setAnswer, choose } = useAnswerDraft(() => setOpenedAt(saved));
  const unanswered = node.resolution === null;
  const aside = Boolean(node.dismissedAt);
  const changing = openedAt === saved;
  const answerable = unanswered || changing;

  return (
    <div className="mt-1 space-y-2 px-1">
      {node.resolution !== null && <TheAnswered resolution={node.resolution} />}
      {answerable && <TheOptions detail={node.detail} onChoose={choose} />}
      {answerable ? (
        <AnswerBox
          id={node.id}
          detail={node.detail}
          resolution={node.resolution}
          action={answerAction}
          pending={answering}
          answer={answer}
          onAnswer={setAnswer}
          autoFocus={!unanswered}
          onCancel={
            unanswered
              ? undefined
              : () => {
                  setAnswer('');
                  setOpenedAt(null);
                }
          }
          error={state.error ?? asideState.error}
          extra={
            unanswered && !aside ? (
              <Button
                type="submit"
                size="sm"
                variant="ghost"
                formAction={asideAction}
                pending={putting}
              >
                Not now
              </Button>
            ) : undefined
          }
        />
      ) : (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => {
            setAnswer('');
            setOpenedAt(saved);
          }}
        >
          Change the answer
        </Button>
      )}
      {unanswered && aside && (
        <form action={asideAction}>
          <input type="hidden" name="id" value={node.id} />
          <input type="hidden" name="aside" value="0" />
          <Button type="submit" size="sm" variant="secondary" pending={putting}>
            Bring back
          </Button>
        </form>
      )}
    </div>
  );
}

/**
 * What the morning run produced for a Claude step (plan #933): the note or
 * draft, its link when it has one, and while it is unread a button to mark it
 * read, which takes it off the home. Once read it moves into the details.
 */
function ClaudeResult({ node }: { node: StepNode }) {
  const [state, review, reviewing] = useActionState(reviewResultAction, answerInitial);
  const unread = node.reviewedAt === null;
  return (
    <div className="mt-1 space-y-1 px-1">
      <p className="text-small text-ink-muted">
        {unread ? 'Claude’s result, to read' : 'Claude’s result'}
      </p>
      {node.result && (
        <p className="text-small break-words whitespace-pre-wrap text-ink">{node.result}</p>
      )}
      {node.resultUrl && (
        <a
          href={node.resultUrl}
          target="_blank"
          rel="noreferrer"
          className="block text-small break-all text-ink underline"
        >
          {node.resultUrl}
        </a>
      )}
      {unread && (
        <form action={review} className="flex items-center gap-2">
          <input type="hidden" name="id" value={node.id} />
          <Button type="submit" size="sm" variant="secondary" pending={reviewing}>
            Mark read
          </Button>
          {state.error && <span className="text-small text-danger">{state.error}</span>}
        </form>
      )}
    </div>
  );
}

const PERIOD_PLURAL = { day: 'days', week: 'weeks', month: 'months' } as const;

/**
 * The closed periods behind a rhythm's current one, oldest first: a tick for
 * each one kept and a cross for each one missed, read from the stored rows.
 */
function PastPeriods({
  past,
  period,
}: {
  past: RhythmRecord['past'];
  period: keyof typeof PERIOD_PLURAL;
}) {
  const kept = past.filter((row) => row.kept).length;
  const summary =
    past.length === 1
      ? `${kept === 1 ? 'Kept' : 'Missed'} last ${period}`
      : `Kept ${kept} of the last ${past.length} ${PERIOD_PLURAL[period]}`;
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 px-1 text-small text-ink-muted">
      <span>{summary}</span>
      <span className="inline-flex items-center gap-0.5">
        {past.map((row) => (
          <StatusGlyph
            key={row.id}
            glyph={row.kept ? 'check' : 'cross'}
            label={`${period === 'day' ? formatDate(row.startsOn) : `From ${formatDate(row.startsOn)}`}: ${row.kept ? 'kept' : 'missed'}, ${row.count} of ${row.target}`}
            size={14}
            className={row.kept ? 'text-ink' : 'text-ink-muted'}
          />
        ))}
      </span>
    </div>
  );
}

function formatDate(isoDate: string): string {
  return new Date(`${isoDate}T00:00:00`).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
  });
}

/**
 * The rest of a step, opened from its menu or its comment count (plan #959).
 *
 * It reads as text first, as an opened step on the plan does: what it
 * involves, when it is done, and what it needs. Edit swaps the text for the
 * form, and saving puts the text back. Which other goals it counts towards is
 * on the row already, so it is changed in the form rather than repeated here.
 */
function StepDetails({
  node,
  links,
  otherGoals,
}: {
  node: StepNode;
  links: { linkId: string; goalId: string; title: string }[];
  otherGoals: OtherGoals;
}) {
  const [editing, setEditing] = useState(false);
  const needs = stepNeeds(node);
  const readResult =
    node.kind === 'claude' && !awaitsReview(node) && (node.result || node.resultUrl);

  if (editing) {
    return (
      <StepEditForm
        node={node}
        links={links}
        otherGoals={otherGoals}
        onDone={() => setEditing(false)}
      />
    );
  }

  return (
    <div className="mt-2 space-y-2 rounded-control bg-sunken px-3 py-2">
      {node.detail && (
        <p className="whitespace-pre-wrap text-ui text-ink-muted">{node.detail}</p>
      )}
      {node.acceptance && (
        <div>
          <p className="text-small font-semibold uppercase tracking-wide text-ink-muted">
            Done when
          </p>
          <p className="whitespace-pre-wrap text-ui text-ink">{node.acceptance}</p>
        </div>
      )}
      {needs && (
        <div>
          <p className="text-small font-semibold uppercase tracking-wide text-ink-muted">Needs</p>
          <p className="whitespace-pre-wrap text-ui text-ink">{needs}</p>
          {node.status === 'proposed' && <ProposalButtons node={node} />}
        </div>
      )}
      {!node.detail && !node.acceptance && (
        <p className="text-small text-ink-muted">
          Nothing written yet on what it involves or when it is done.
        </p>
      )}
      {readResult && <ClaudeResult node={node} />}
      <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(true)}>
        Edit
      </Button>
    </div>
  );
}

/**
 * Approve and Turn down beside a proposal's Needs line (plan #960), the same
 * two moves its menu offers.
 */
function ProposalButtons({ node }: { node: StepNode }) {
  const [state, settle, settling] = useActionState(settleProposalAction, answerInitial);
  const beneath = countProposed(node.children);
  const with_ = beneath > 0 ? `, with ${beneath} beneath` : '';
  return (
    <form action={settle} className="mt-1.5 flex flex-wrap items-center gap-2">
      <input type="hidden" name="id" value={node.id} />
      <Button type="submit" size="sm" name="approve" value="1" pending={settling}>
        Approve{with_}
      </Button>
      <Button type="submit" size="sm" variant="ghost" name="approve" value="0" disabled={settling}>
        Turn down{with_}
      </Button>
      {state.error && (
        <p role="alert" className="text-small text-danger">
          {state.error}
        </p>
      )}
    </form>
  );
}

/** Drop the fields a save would leave as they were, so an edit sends only what changed. */
function onlyChanged(form: FormData, node: StepNode): FormData {
  const before: Record<string, string> = {
    detail: node.detail ?? '',
    acceptance: node.acceptance ?? '',
    dueOn: node.dueOn ?? '',
  };
  for (const [key, value] of Object.entries(before)) {
    if (String(form.get(key) ?? '').trim() === value) form.delete(key);
  }
  if (form.get('kind') === node.kind) {
    form.delete('kind');
    if (
      String(form.get('rhythmCount') ?? '') === String(node.rhythmCount ?? '') &&
      form.get('rhythmPeriod') === node.rhythmPeriod
    ) {
      form.delete('rhythmCount');
      form.delete('rhythmPeriod');
    }
  }
  return form;
}

/** The step's fields as one form. Save puts the text view back; Cancel leaves it as it was. */
function StepEditForm({
  node,
  links,
  otherGoals,
  onDone,
}: {
  node: StepNode;
  links: { linkId: string; goalId: string; title: string }[];
  otherGoals: OtherGoals;
  onDone: () => void;
}) {
  const menuAction = useMenuAction();
  const linkable = otherGoals.filter((goal) => !links.some((link) => link.goalId === goal.id));
  const [kind, setKind] = useState<StepKind>(node.kind);
  const [state, save, saving] = useActionState(
    async (prev: StepActionState, form: FormData) => {
      const result = await editStep(prev, onlyChanged(form, node));
      if (!result.error) onDone();
      return result;
    },
    initial,
  );

  return (
    <div className="mt-2 space-y-2 rounded-control bg-sunken px-2 py-2">
      <form action={save} className="space-y-2">
        <input type="hidden" name="id" value={node.id} />
        {/* ui-ok: composer-always-open -- this form only renders once Edit is pressed */}
        <Textarea
          name="detail"
          rows={3}
          maxLength={STEP_DETAIL_MAX}
          defaultValue={node.detail ?? ''}
          placeholder="What it involves"
          aria-label={`What ${node.title} involves`}
          autoFocus
        />
        <InlineInput
          name="acceptance"
          maxLength={STEP_ACCEPTANCE_MAX}
          defaultValue={node.acceptance ?? ''}
          placeholder="Done when…"
          aria-label={`When ${node.title} is done`}
        />
        <div className="flex flex-wrap items-center gap-2">
          <Input
            type="date"
            name="dueOn"
            defaultValue={node.dueOn ?? ''}
            aria-label={`When ${node.title} is due`}
            className="w-auto"
          />
          <Select
            name="kind"
            value={kind}
            aria-label={`What kind of step ${node.title} is`}
            onChange={(event) => setKind(event.target.value as StepKind)}
            className="w-auto"
          >
            {STEP_KINDS.map((option) => (
              <option key={option} value={option}>
                {STEP_KIND_LABELS[option]}
              </option>
            ))}
          </Select>
          {kind === 'rhythm' && (
            <RhythmFields count={node.rhythmCount} period={node.rhythmPeriod} />
          )}
        </div>
        {state.error && <p className="px-1 text-small text-danger">{state.error}</p>}
        <div className="flex items-center gap-2">
          <Button type="submit" size="sm" pending={saving}>
            Save
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={onDone}>
            Cancel
          </Button>
        </div>
      </form>
      {(links.length > 0 || linkable.length > 0) && (
        <div className="space-y-1 px-1 text-small">
          {links.map((link) => (
            <form
              key={link.linkId}
              action={menuAction(unlinkStepAction)}
              className="flex items-center gap-2"
            >
              <input type="hidden" name="linkId" value={link.linkId} />
              <span className="text-ink-muted">Also counts towards</span>
              <span className="min-w-0 truncate text-ink">{link.title}</span>
              <Button type="submit" size="sm" variant="ghost">
                Remove
              </Button>
            </form>
          ))}
          {linkable.length > 0 && (
            <form action={menuAction(linkStepAction)} className="flex flex-wrap items-center gap-2">
              <input type="hidden" name="id" value={node.id} />
              <Select
                name="goalId"
                aria-label="Another goal this counts towards"
                className="w-auto"
              >
                {linkable.map((goal) => (
                  <option key={goal.id} value={goal.id}>
                    {goal.title}
                  </option>
                ))}
              </Select>
              <Button type="submit" size="sm" variant="ghost">
                Count towards it too
              </Button>
            </form>
          )}
        </div>
      )}
    </div>
  );
}

function RhythmFields({
  count,
  period,
  submitLabel,
}: {
  count: number | null;
  period: string | null;
  submitLabel?: string;
}) {
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <Input
        type="number"
        name="rhythmCount"
        min={1}
        max={RHYTHM_COUNT_MAX}
        required
        defaultValue={count ?? 1}
        aria-label="How many times"
        className="w-16"
      />
      <span className="text-small text-ink-muted">a</span>
      <Select
        name="rhythmPeriod"
        defaultValue={period ?? 'week'}
        aria-label="Per"
        className="w-auto"
      >
        {RHYTHM_PERIODS.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </Select>
      {submitLabel && (
        <Button type="submit" size="sm" variant="ghost">
          {submitLabel}
        </Button>
      )}
    </span>
  );
}

/** A new step or sub-step: a title and its kind, with how often for a rhythm. */
function StepComposer({
  parentId,
  label,
  startOpen = false,
  onClose,
}: {
  parentId: string;
  label: string;
  startOpen?: boolean;
  onClose?: () => void;
}) {
  const [open, setOpenState] = useState(startOpen);
  const [kind, setKind] = useState<StepKind>('mine');
  const setOpen = (next: boolean) => {
    setOpenState(next);
    if (!next) onClose?.();
  };
  const [state, add, adding] = useActionState(async (prev: StepActionState, form: FormData) => {
    const next = await addStep(prev, form);
    if (next.done) {
      setOpen(false);
      setKind('mine');
    }
    return next;
  }, initial);

  if (!open) return <AddTrigger label={label} onClick={() => setOpen(true)} />;

  return (
    <Card>
      <form
        action={add}
        onKeyDown={(event) => {
          if (event.key === 'Escape') setOpen(false);
        }}
      >
        <input type="hidden" name="parentId" value={parentId} />
        <div className="px-3 py-3">
          <ComposeTitle
            name="title"
            required
            autoFocus
            maxLength={STEP_TITLE_MAX}
            placeholder="A step, such as list every balance"
            aria-label={label}
          />
        </div>
        <div className="flex flex-wrap items-center gap-2 border-t border-border px-3 py-2">
          <Select
            name="kind"
            value={kind}
            onChange={(event) => setKind(event.target.value as StepKind)}
            aria-label="What kind of step"
            className="w-auto"
          >
            {STEP_KINDS.map((option) => (
              <option key={option} value={option}>
                {STEP_KIND_LABELS[option]}
              </option>
            ))}
          </Select>
          {kind === 'rhythm' && <RhythmFields count={null} period={null} />}
          {state.error && <span className="text-small text-danger">{state.error}</span>}
          <span className="ml-auto flex items-center gap-1">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setOpen(false)}
              disabled={adding}
            >
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={adding}>
              {adding ? 'Adding…' : 'Add step'}
            </Button>
          </span>
        </div>
      </form>
    </Card>
  );
}
