'use client';

import { useActionState, useState } from 'react';
import Link from 'next/link';
import { ClipboardList, Play, Repeat, Sparkles } from 'lucide-react';
import { RowIconButton } from '@/app/dev/plan/plan-run-status';
import { TreeRow, rowInset, useTreeRow } from '@/components/plan-tree/tree-row';
import type { TreeActionState, TreeActions, TreeCatalogEntry } from '@/components/plan-tree/types';
import type { ActionMenuItem } from '@/components/ui/action-menu';
import { Button } from '@/components/ui/button';
import { FieldError, InlineInput } from '@/components/ui/field';
import { useToast } from '@/components/ui/toast';
import { awaitsReview } from '@/lib/goals/daily';
import { offersPrepare, offersSend, sendJob } from '@/lib/goals/handover';
import { REVIEW_ASK, type GoalRowNode } from '@/lib/goals/plan-rows';
import { progressLine } from '@/lib/goals/rhythms';
import { countProposed, type StepRunView } from '@/lib/goals/shaping';
import { STEP_KIND_LABELS, countSteps, describeRhythm } from '@/lib/goals/steps';
import type { GoalMap } from '@/lib/goals/steps-store';
import { canShowOnTodo } from '@/lib/goals/todo';
import {
  archiveStepAction,
  countRhythmAction,
  moveStepAction,
  setStepOnTodoAction,
  unlinkStepAction,
} from './actions';
import {
  addGoalStepDependency,
  blockGoalStep,
  removeGoalStepDependency,
  setGoalStepStatus,
} from './block-actions';
import { GOALS_STORE } from './goal-comments';
import { InformationStep, type InformationSeam } from './information-step';
import {
  prepareStepAction,
  sendStepAction,
  setFogAsideAction,
  settleProposalAction,
  type ShapingActionState,
} from './shaping-actions';
import {
  ClaudeResult,
  PastPeriods,
  ProposalButtons,
  Question,
  StepComposer,
  StepEditForm,
  formatDate,
  useMenuAction,
} from './step-parts';
import { answerGoalQuestion, askGoalQuestion, dismissGoalQuestion } from './tree-actions';

/**
 * One goal step, drawn through the dev plan's shared row (plan #982).
 *
 * The same row, fold, guides, health word, status column and opened panel as
 * /dev/plan, with a goal's writes behind them. What only a goal has goes in
 * the row's slots: a question's answer box, Claude's result, a rhythm's
 * periods and an information step's form in the panel body; how often a
 * rhythm runs and when a step is due in the fourth column; whose kind of
 * step it is as a mark after the title. Commits, checks, priority and size
 * are the plan's and are left out.
 */

/** The goal's writes, for the shared tree components. */
const GOAL_TREE_ACTIONS: TreeActions = {
  answer: answerGoalQuestion,
  setStatus: setGoalStepStatus,
  dismissQuestion: dismissGoalQuestion,
  ask: askGoalQuestion,
  addDependency: addGoalStepDependency,
  removeDependency: removeGoalStepDependency,
  // Steps carry no fog; only the goal does, and it has its own note above
  // the tree. Here for the shape, never pressed.
  dismissFog: setFogAsideAction,
};

const GOAL_COMMENTS = { target: 'goal' as const, store: GOALS_STORE };

/** What every row on one goal page shares. */
export type GoalRowContext = {
  goalTitle: string;
  todoOn: boolean;
  rhythms: GoalMap['rhythms'];
  information: GoalMap['information'];
  answers: GoalMap['answers'];
  linksOf: GoalMap['linksOf'];
  otherGoals: GoalMap['otherGoals'];
  catalog: readonly TreeCatalogEntry[];
  /** Start with sub-steps showing. The goal page does; its trees are small. */
  unfolded: boolean;
  /** Start with every panel open. A seam for the gallery; nothing in the app passes it. */
  opened: boolean;
  /** An information step's list as the gallery wants it. Nothing in the app passes it. */
  informationSeam?: InformationSeam;
  /** The latest run on each step sent or prepared from its row, by step id (plan #1044). */
  runs: Record<string, StepRunView>;
};

/**
 * A sent or prepared step's latest run on its row (plan #1044): what it is on
 * now while it goes, then why it failed or what it said it did, with the run's
 * own page one press away. The wording follows an area's Plan this area line.
 */
function StepRunLine({ run, inset }: { run: StepRunView; inset: React.CSSProperties }) {
  const details = (
    <Link href={`/goals/runs/${run.runId}`} className="underline underline-offset-2">
      Details
    </Link>
  );
  if (run.running) {
    return (
      <li
        style={inset}
        role="status"
        className="flex items-center gap-1.5 pb-1.5 pr-3 text-small text-accent"
      >
        <span className="size-1.5 shrink-0 animate-pulse rounded-full bg-accent" aria-hidden />
        <span>
          Claude is on this · {run.running} · {details}
        </span>
      </li>
    );
  }
  if (run.error) {
    return (
      <li style={inset} className="pb-1.5 pr-3 text-small text-danger">
        The last run did not finish: {run.error} {details}
      </li>
    );
  }
  if (!run.summary) return null;
  return (
    <li style={inset} className="pb-1.5 pr-3 text-small text-ink-muted">
      <Link href={`/goals/runs/${run.runId}`} className="underline-offset-2 hover:underline">
        Last run
      </Link>
      : {run.summary}
    </li>
  );
}

/**
 * What a blocked step needs, asked for when Blocked is chosen from the health
 * menu. The sentence is its Needs line, and what the health word's tooltip says.
 */
function BlockForm({
  node,
  inset,
  onDone,
}: {
  node: GoalRowNode;
  inset: React.CSSProperties;
  onDone: () => void;
}) {
  const [state, action, pending] = useActionState(
    async (prev: TreeActionState, form: FormData) => {
      const result = await blockGoalStep(prev, form);
      if (!result.error) onDone();
      return result;
    },
    {} as TreeActionState,
  );
  return (
    <li style={inset} className="pb-2 pr-3">
      <form action={action} className="space-y-2 rounded-lg bg-sunken px-3 py-2.5">
        <input type="hidden" name="id" value={node.id} />
        <InlineInput
          name="ask"
          required
          maxLength={4000}
          autoFocus
          defaultValue={node.blockAsk ?? ''}
          placeholder="What it needs before it can go on"
          aria-label={`What ${node.title} needs`}
        />
        <div className="flex flex-wrap items-center gap-2">
          <FieldError>{state.error}</FieldError>
          <div className="ml-auto flex items-center gap-1">
            <Button type="button" size="sm" variant="ghost" onClick={onDone}>
              Cancel
            </Button>
            <Button type="submit" size="sm" pending={pending}>
              {node.status === 'blocked' ? 'Save' : 'Block'}
            </Button>
          </div>
        </div>
      </form>
    </li>
  );
}

const STATUS_WORDS = [
  ['not_started', 'Open'],
  ['blocked', 'Blocked'],
  ['done', 'Done'],
  ['dropped', 'Dropped'],
] as const;

export function GoalRow({
  node,
  trail,
  context,
  index,
  count,
  unlinkId,
  fromGoal,
}: {
  node: GoalRowNode;
  trail: readonly boolean[];
  context: GoalRowContext;
  /** Where it sits among its siblings, for Move up and Move down. */
  index: number;
  count: number;
  /** Set on a step shown here through a link, so its menu can remove the link. */
  unlinkId?: string;
  /** The goal a linked step lives under, said on the row and linked in the opened panel. */
  fromGoal?: { id: string; title: string };
}) {
  const { step } = node;
  const row = useTreeRow(node, {
    searching: false,
    unfolded: context.unfolded,
    opened: context.opened,
  });
  const [blocking, setBlocking] = useState(false);
  // Send to Claude (plan #1000). Held by the row rather than by a button,
  // because there are three ways to press it -- the quick icon, the button in
  // the opened row and the menu -- and what came back is said once, on the
  // row, as the dev plan does.
  const [sendState, sendAction, sendPending] = useActionState(
    sendStepAction,
    {} as ShapingActionState,
  );
  // Prepare (plan #1001): Claude writes what you need to do one of your own
  // steps into its result. Its answer is said on the row the same way.
  const [prepareState, prepareAction, preparePending] = useActionState(
    prepareStepAction,
    {} as ShapingActionState,
  );
  const toast = useToast();
  const menuAction = useMenuAction();
  const tree = (action: (prev: TreeActionState, form: FormData) => Promise<TreeActionState>) =>
    menuAction((form) => action({}, form));

  const closed = step.status === 'done' || step.status === 'dropped';
  const proposed = step.status === 'proposed';
  const isDecision = step.kind === 'decision';
  const rhythm = step.kind === 'rhythm' ? context.rhythms[step.id] : undefined;
  const current = step.status === 'open' ? (rhythm?.current ?? null) : null;
  const filled = step.collectionId ? context.information[step.collectionId] : undefined;
  const links = context.linksOf[step.id] ?? [];

  async function archive(form: FormData) {
    const result = await archiveStepAction(form);
    if (result.error) {
      toast({ text: result.error });
      return;
    }
    toast({
      text: `Archived ${step.title}.`,
      undo: async () => {
        const restore = new FormData();
        restore.set('id', step.id);
        restore.set('restore', 'true');
        const back = await archiveStepAction(restore);
        if (back.error) throw new Error(back.error);
      },
    });
  }

  // The health word is the status control, as on the plan. A proposal's
  // moves are to approve it or turn it down, each taking the proposed steps
  // beneath it along; a question's first move is to answer it, and Done is
  // not offered on one. Blocked asks what the step needs before it blocks.
  const beneath = proposed ? countProposed(step.children) : 0;
  const settle = tree(settleProposalAction);
  const statusMenu: ActionMenuItem[] = proposed
    ? [
        {
          id: 'approve',
          label: beneath > 0 ? `Approve, with ${beneath} beneath` : 'Approve',
          formAction: settle,
          formFields: { id: step.id, approve: '1' },
        },
        {
          id: 'reject',
          label: beneath > 0 ? `Turn down, with ${beneath} beneath` : 'Turn down',
          formAction: settle,
          formFields: { id: step.id, approve: '0' },
        },
      ]
    : [
        ...(isDecision
          ? [
              {
                id: 'answer',
                label: step.resolution ? 'Change the answer' : 'Answer',
                onSelect: () => row.setOpen(true),
              },
            ]
          : []),
        ...STATUS_WORDS.filter(([status]) => !(isDecision && status === 'done')).map(
          ([status, label]): ActionMenuItem =>
            status === 'blocked'
              ? {
                  id: status,
                  label: node.status === 'blocked' ? 'Change what it needs' : label,
                  disabled: closed,
                  onSelect: () => setBlocking(true),
                }
              : {
                  id: status,
                  label,
                  disabled: status === node.status,
                  formAction: tree(setGoalStepStatus),
                  formFields: { id: step.id, status },
                },
        ),
      ];

  // Show on Todo is offered on your open steps; taking one off is offered on
  // any step still flagged, so nothing can be stranded on Todo.
  const todoItems: ActionMenuItem[] = !context.todoOn
    ? []
    : step.onTodo
      ? [
          {
            id: 'todo',
            label: 'Take off Todo',
            formAction: menuAction(setStepOnTodoAction),
            formFields: { id: step.id, on: 'false' },
          },
        ]
      : canShowOnTodo(step)
        ? [
            {
              id: 'todo',
              label: 'Show on Todo',
              formAction: menuAction(setStepOnTodoAction),
              formFields: { id: step.id, on: 'true' },
            },
          ]
        : [];
  // Counting is offered on a rhythm with a period open now; the period is
  // named in the form, so a press after the week has turned is refused
  // rather than counted towards the new one.
  const countOne = menuAction(countRhythmAction);
  const rhythmItems: ActionMenuItem[] = current
    ? [
        {
          id: 'count',
          label: 'Count one',
          formAction: countOne,
          formFields: { id: step.id, startsOn: current.startsOn, by: '1' },
        },
        ...(current.count > 0
          ? [
              {
                id: 'uncount',
                label: 'Take one back',
                formAction: countOne,
                formFields: { id: step.id, startsOn: current.startsOn, by: '-1' },
              },
            ]
          : []),
      ]
    : [];
  const sendable = offersSend(step);
  const sendLabel = sendJob(step) === 'phase' ? 'Send this phase to Claude' : 'Send to Claude';
  const sendItems: ActionMenuItem[] = sendable
    ? [{ id: 'send', label: sendLabel, formAction: sendAction, formFields: { id: step.id } }]
    : [];
  const preparable = offersPrepare(step);
  const prepareLabel = step.result || step.resultUrl ? 'Prepare it again' : 'Ask Claude to prepare this';
  const prepareItems: ActionMenuItem[] = preparable
    ? [{ id: 'prepare', label: prepareLabel, formAction: prepareAction, formFields: { id: step.id } }]
    : [];
  const handedOver = (sendState.error ?? sendState.message) ? sendState : prepareState;
  const run = context.runs[step.id];
  // Once the page holds the run a press started, its line says what the
  // press's message said and more, so the message gives way to it. A refusal
  // is still said: it started nothing.
  const pressNote = handedOver.error ?? (run?.running ? undefined : handedOver.message);
  const move = menuAction(moveStepAction);
  const menu: ActionMenuItem[] = [
    ...sendItems,
    ...prepareItems,
    ...rhythmItems,
    ...todoItems,
    { id: 'add-child', label: 'Add a sub-step', onSelect: row.addChild },
    { id: 'edit', label: 'Edit', onSelect: () => row.setEditing(true) },
    ...(unlinkId
      ? [
          {
            id: 'unlink',
            label: 'Stop counting towards this goal',
            formAction: menuAction(unlinkStepAction),
            formFields: { linkId: unlinkId },
          },
        ]
      : [
          {
            id: 'up',
            label: 'Move up',
            disabled: index === 0,
            formAction: move,
            formFields: { id: step.id, direction: 'up' },
          },
          {
            id: 'down',
            label: 'Move down',
            disabled: index === count - 1,
            formAction: move,
            formFields: { id: step.id, direction: 'down' },
          },
        ]),
    {
      id: 'archive',
      label: 'Archive step',
      destructive: true,
      formAction: archive,
      formFields: { id: step.id },
      confirm:
        step.children.length > 0
          ? `Archive ${step.title} and the ${countSteps(step.children).total} under it?`
          : undefined,
    },
  ];

  const KindIcon = step.kind === 'claude' ? Sparkles : step.kind === 'rhythm' ? Repeat : null;
  const onTodo = context.todoOn && step.onTodo && canShowOnTodo(step);
  const substeps = node.children.filter((child) => child.kind !== 'decision');

  return (
    <TreeRow
      node={node}
      trail={trail}
      row={row}
      health={node.health}
      move={node.move}
      statusMenu={statusMenu}
      menu={menu}
      actions={GOAL_TREE_ACTIONS}
      anchorId={`step-${step.id}`}
      source={fromGoal ? `From ${fromGoal.title}` : undefined}
      // What a step waiting on you is waiting for (note 5aa7216c), as the dev
      // plan's Needs line says it: the block's ask, or the read a finished
      // Claude step is waiting on.
      need={
        awaitsReview(step)
          ? REVIEW_ASK
          : step.status === 'blocked' && step.blockKind !== 'steps'
            ? (step.blockAsk ?? null)
            : null
      }
      comments={GOAL_COMMENTS}
      threadPlaceholder="A note on this step. Tag @dash to ask about it, or to give it figures to file."
      dependencies={{ catalog: context.catalog, groupOf: () => context.goalTitle }}
      marks={
        KindIcon && (
          <span title={STEP_KIND_LABELS[step.kind]} className="inline-flex shrink-0 text-ink-muted">
            <KindIcon className="size-3" strokeWidth={1.75} aria-hidden />
            <span className="sr-only">{STEP_KIND_LABELS[step.kind]}</span>
          </span>
        )
      }
      priority={
        /* The shared cell truncates, which suits the plan's one word and
           size. A rhythm's count runs to three or four words ("0 of 1 this
           week"), so it wraps onto a second line the way the plan's "Next ·
           L" does rather than being cut off (plan #983). */
        current && step.rhythmPeriod ? (
          <span className="whitespace-normal text-ink-muted">
            {progressLine(step.rhythmPeriod, current)}
          </span>
        ) : step.dueOn ? (
          <span className="text-ink-muted">Due {formatDate(step.dueOn)}</span>
        ) : null
      }
      quickActions={
        sendable ? (
          <form action={sendAction}>
            <input type="hidden" name="id" value={step.id} />
            <RowIconButton type="submit" label={sendLabel} pending={sendPending}>
              <Play className="size-3.5" strokeWidth={1.75} aria-hidden />
            </RowIconButton>
          </form>
        ) : (
          preparable && (
            <form action={prepareAction}>
              <input type="hidden" name="id" value={step.id} />
              <RowIconButton type="submit" label={prepareLabel} pending={preparePending}>
                <ClipboardList className="size-3.5" strokeWidth={1.75} aria-hidden />
              </RowIconButton>
            </form>
          )
        )
      }
      notices={
        <>
          {blocking && (
            <BlockForm node={node} inset={rowInset(trail)} onDone={() => setBlocking(false)} />
          )}
          {/* What the last send or prepare did, or why it was refused, wherever it was pressed. */}
          {pressNote && (
            <li style={rowInset(trail)} className="pb-1.5 pr-3 text-small">
              <FieldError>{handedOver.error}</FieldError>
              {!handedOver.error && <span className="text-ink-muted">{handedOver.message}</span>}
            </li>
          )}
          {/* The step's own latest run, read with the page (plan #1044). */}
          {run && <StepRunLine run={run} inset={rowInset(trail)} />}
        </>
      }
      edit={
        <StepEditForm
          node={step}
          links={links}
          otherGoals={context.otherGoals}
          onDone={() => row.setEditing(false)}
        />
      }
      body={
        <>
          {isDecision &&
            step.status !== 'dropped' &&
            (step.status === 'open' || step.resolution !== null) && <Question node={step} />}
          {step.kind === 'claude' && (awaitsReview(step) || step.result || step.resultUrl) && (
            <ClaudeResult node={step} />
          )}
          {step.kind === 'mine' && (step.result || step.resultUrl) && <ClaudeResult node={step} />}
          {rhythm && rhythm.past.length > 0 && step.rhythmPeriod && (
            <PastPeriods past={rhythm.past} period={step.rhythmPeriod} />
          )}
          {filled && (
            <InformationStep
              node={step}
              collection={filled.collection}
              records={filled.records}
              answers={context.answers[step.id] ?? []}
              seam={context.informationSeam}
            />
          )}
        </>
      }
      meta={
        <p className="flex flex-wrap gap-x-3 text-small text-ink-muted">
          <span>{STEP_KIND_LABELS[step.kind]}</span>
          {fromGoal && (
            <Link href={`/goals/${fromGoal.id}`} className="underline">
              From {fromGoal.title}
            </Link>
          )}
          {step.kind === 'rhythm' && step.rhythmCount && step.rhythmPeriod && (
            <span>{describeRhythm(step.rhythmCount, step.rhythmPeriod)}</span>
          )}
          {current && step.rhythmPeriod && (
            <span>{progressLine(step.rhythmPeriod, current)}</span>
          )}
          {step.dueOn && <span>Due {formatDate(step.dueOn)}</span>}
          {onTodo && <span>On Todo</span>}
          {links.map((link) => (
            <Link key={link.linkId} href={`/goals/${link.goalId}`} className="underline">
              Also {link.title}
            </Link>
          ))}
        </p>
      }
      panelActions={
        <>
          {proposed && <ProposalButtons node={step} />}
          {sendable && (
            <form action={sendAction}>
              <input type="hidden" name="id" value={step.id} />
              <Button type="submit" size="sm" variant="secondary" pending={sendPending}>
                <Play className="size-3.5" aria-hidden />
                {sendPending ? 'Sending…' : sendLabel}
              </Button>
            </form>
          )}
          {preparable && (
            <form action={prepareAction}>
              <input type="hidden" name="id" value={step.id} />
              <Button type="submit" size="sm" variant="secondary" pending={preparePending}>
                <ClipboardList className="size-3.5" aria-hidden />
                {preparePending ? 'Asking…' : 'Prepare'}
              </Button>
            </form>
          )}
        </>
      }
      addChild={
        <StepComposer
          parentId={step.id}
          label={`Sub-step of ${step.title}`}
          bare
          startOpen
          onClose={() => row.setAddingChild(false)}
        />
      }
      renderChild={(child, childTrail) => {
        const at = substeps.indexOf(child as GoalRowNode);
        return (
          <GoalRow
            node={child as GoalRowNode}
            trail={childTrail}
            context={context}
            index={at}
            count={substeps.length}
          />
        );
      }}
    />
  );
}
