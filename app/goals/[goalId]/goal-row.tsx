'use client';

import { useActionState, useState } from 'react';
import Link from 'next/link';
import { CircleUser, Repeat } from 'lucide-react';
import { RowIconButton } from '@/components/plan-tree/row-icon-button';
import { StateLabel } from '@/components/dev/state-label';
import { TreeRow, rowInset, useTreeRow } from '@/components/plan-tree/tree-row';
import type { TreeActionState, TreeActions, TreeCatalogEntry } from '@/components/plan-tree/types';
import type { ActionMenuItem } from '@/components/ui/action-menu';
import { Button } from '@/components/ui/button';
import { FieldError, InlineInput } from '@/components/ui/field';
import { useToast } from '@/components/ui/toast';
import { awaitsSeenIt } from '@/lib/goals/answer-change';
import { useDashArrival } from './dash-arrival';
import type { LinkedFile } from '@/lib/files/files';
import { awaitsReview } from '@/lib/goals/daily';
import type { PrepTarget, StepPrep } from '@/lib/goals/goal-page';
import { askDash, offersAsk } from '@/lib/goals/handover';
import type { GoalRowNode } from '@/lib/goals/plan-rows';
import {
  PROGRESS_ESTIMATE_WORDS,
  amountWords,
  talliesBesideTotal,
  tallyWords,
  towardsTotal,
  towardsTotalWords,
  type ItemProgress,
  type LatestBeneath,
} from '@/lib/goals/progress';
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
import { InformationStep, type InformationSeam } from './information-step';
import {
  askDashStepAction,
  setFogAsideAction,
  settleProposalAction,
  type ShapingActionState,
} from './shaping-actions';
import {
  ClaudeResult,
  PrepNote,
  PastPeriods,
  ProposalButtons,
  Question,
  StepComposer,
  StepFacts,
  StepText,
  StepTitleEditor,
  formatDate,
  useMenuAction,
} from './step-parts';
import { answerGoalQuestion, askGoalQuestion, dismissGoalQuestion } from './tree-actions';
import { DashMark } from '@/components/ui/dash-mark';
import { MoveLabel } from '@/components/ui/move-label';

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

const GOAL_COMMENTS = { target: 'goal' as const };

/** What every row on one goal page shares. */
const NO_FILES: LinkedFile[] = [];

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
  /** The files each step links to, by step id (core.files through goals.links). */
  files?: Record<string, LinkedFile[]>;
  /** Each step's live Dash prep step, by the id of the step it serves (plan #1218). */
  prepFor?: Record<string, StepPrep>;
  /** The step each prep step is for, by the prep step's id. */
  targetOf?: Record<string, PrepTarget>;
  /** The progress logged on each step, by step id (plan #1276). */
  progress?: Record<string, ItemProgress>;
  /** The newest progress beneath each step with sub-steps, by step id. */
  progressBeneath?: Record<string, LatestBeneath>;
  /** The finished steps Dash closed lately, which arrive with its mark (plan #1561). */
  arrivals?: ReadonlySet<string>;
  /** Whether this account can start a goals run. Ask Dash shows only when it can. */
  canRun: boolean;
};

/**
 * An open step with progress on it (plan #1276): under way, its running
 * tally and the day it was last touched. With an estimated total the tally
 * says roughly how much is left (plan #1277): "7 of about 100 bags, about 93
 * to go". Without a total it says the rough answer to how far along, when
 * one was given (plan #1280): "Under way · about half done". A parent with
 * progress only beneath it says when and on which step instead.
 */
function ProgressLine({
  progress,
  beneath,
  total,
  inset,
}: {
  progress: ItemProgress | undefined;
  beneath: LatestBeneath | undefined;
  total: { quantity: number | null | undefined; unit: string | null | undefined };
  inset: React.CSSProperties;
}) {
  if (progress) {
    const towards = towardsTotal(total.quantity, total.unit, progress.tallies);
    const tally = towards
      ? [towardsTotalWords(towards), tallyWords(talliesBesideTotal(progress.tallies, total.unit))]
          .filter(Boolean)
          .join(' · ')
      : [
          tallyWords(progress.tallies),
          progress.estimate ? PROGRESS_ESTIMATE_WORDS[progress.estimate] : null,
        ]
          .filter(Boolean)
          .join(' · ');
    return (
      <li style={inset} className="flex items-center gap-1.5 pb-1.5 pr-3 text-small text-ink-muted">
        <span className="size-1.5 shrink-0 rounded-full bg-accent" aria-hidden />
        <span>
          <span className="font-medium text-ink">Under way</span>
          {tally && <span className="tabular"> · {tally}</span>}
          <span className="tabular"> · last {formatDate(progress.lastOn)}</span>
        </span>
      </li>
    );
  }
  if (!beneath) return null;
  return (
    <li style={inset} className="pb-1.5 pr-3 text-small text-ink-muted">
      Last progress {formatDate(beneath.on)} on{' '}
      <a href={`#step-${beneath.stepId}`} className="underline-offset-2 hover:underline">
        {beneath.title}
      </a>
    </li>
  );
}

/** A step's progress entries, newest first, in the opened panel. */
function ProgressList({ progress }: { progress: ItemProgress }) {
  return (
    <section aria-label="Progress" className="space-y-1 px-1">
      <h3 className="text-small font-semibold text-ink-muted">Progress</h3>
      <ul className="space-y-0.5 text-small">
        {progress.entries.map((entry) => (
          <li key={entry.id} className="flex gap-3">
            <span className="tabular w-14 shrink-0 text-ink-muted">
              {formatDate(entry.happenedOn)}
            </span>
            <span className="min-w-0 text-ink">
              {entry.text}
              {entry.quantity !== null && (
                <span className="tabular text-ink-muted">
                  {' '}
                  · {amountWords(entry.quantity, entry.unit)}
                </span>
              )}
              {entry.estimate && (
                <span className="text-ink-muted"> · {PROGRESS_ESTIMATE_WORDS[entry.estimate]}</span>
              )}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * A sent or prepared step's latest run on its row (plan #1044): "Dash is on
 * it" and what it is on now while it goes, then why it failed or what it said it did, with the run's
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
        className="flex flex-wrap items-center gap-x-1.5 pb-1.5 pr-3 text-small text-ink-muted"
      >
        {/* The move every row says while a Dash run on it is going (plan
            #1455), beside the Who column rather than in place of it: who the
            step is on is a different fact from what is happening to it now. */}
        <MoveLabel move={{ state: 'dash_working' }} title="A Dash run on this step is going now." />
        <span>
          · {run.running} · {details}
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
  const [state, action, pending] = useActionState(async (prev: TreeActionState, form: FormData) => {
    const result = await blockGoalStep(prev, form);
    if (!result.error) onDone();
    return result;
  }, {} as TreeActionState);
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

/** Ask Dash, or Ask Dash again on a step of yours Dash has already prepared. */
function askDashLabel(step: GoalRowNode['step']): string {
  const prepared = askDash(step)?.mode === 'prepare' && Boolean(step.result || step.resultUrl);
  return prepared ? 'Ask Dash again' : 'Ask Dash';
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
  // A step Dash finished lately settles in with its mark flashing, the first
  // time you see it (plan #1561).
  const arrived = step.status === 'done' && (context.arrivals?.has(step.id) ?? false);
  const markRef = useDashArrival(step.id, arrived);
  // Ask Dash (plans #1000 and #1001): askDash picks whether the step is
  // handed over or prepared. Held by the row rather than by a button, because
  // there are three ways to press it -- the quick icon, the button in the
  // opened row and the menu -- and what came back is said once, on the row,
  // as the dev plan does.
  const [askState, askAction, askPending] = useActionState(
    askDashStepAction,
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
  // A changed answer reopened it, and it waits on your Seen it (plan #1050).
  const answerChanged =
    filled !== undefined && awaitsSeenIt(step.status, context.answers[step.id] ?? []);

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
  // rather than counted towards the new one. A rhythm that counts itself
  // from a source is not counted by hand (lib/goals/rhythm-sources.ts).
  const countOne = menuAction(countRhythmAction);
  const rhythmItems: ActionMenuItem[] = current && !step.countSource
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
  const askable = context.canRun && offersAsk(step);
  const askLabel = askDashLabel(step);
  const askItems: ActionMenuItem[] = askable
    ? [{ id: 'ask', label: askLabel, formAction: askAction, formFields: { id: step.id } }]
    : [];
  const run = context.runs[step.id];
  const stepFiles = context.files?.[step.id] ?? NO_FILES;
  const prep = context.prepFor?.[step.id];
  const progress = context.progress?.[step.id];
  // Under way is a reading of an open step, never a status: a closed step
  // keeps its entries in the panel and says nothing on the row.
  const stepOpen = step.status !== 'done' && step.status !== 'dropped';
  const prepares = step.kind === 'claude' ? context.targetOf?.[step.id] : undefined;
  // Once the page holds the run a press started, its line says what the
  // press's message said and more, so the message gives way to it. A refusal
  // is still said: it started nothing.
  const pressNote = askState.error ?? (run?.running ? undefined : askState.message);
  const move = menuAction(moveStepAction);
  const menu: ActionMenuItem[] = [
    ...askItems,
    ...rhythmItems,
    ...todoItems,
    { id: 'add-child', label: 'Add a sub-step', onSelect: row.addChild },
    { id: 'edit', label: 'Rename', onSelect: () => row.setEditing(true) },
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

  // Whose the step is, on every row (plan #1159): Dash's mark, or the
  // dev plan's Yours mark, by the same reading as the Who column, which is
  // hidden below sm. A stage over both kinds carries both. A rhythm keeps its
  // own mark beside the Yours one.
  const yours = node.who.word !== 'Dash';
  // A step of yours that Dash closed from evidence carries the mark too.
  const dashes = node.who.word !== 'You' || arrived;
  const onTodo = context.todoOn && step.onTodo && canShowOnTodo(step);
  const substeps = node.children.filter((child) => child.kind !== 'decision');

  return (
    <TreeRow
      node={node}
      trail={trail}
      row={row}
      health={node.health}
      // Who the step is on, where the plan says whose move it is (note
      // 6d242e62). That is a different fact from the move, so it keeps its own
      // words rather than MoveLabel's; the goal's move is on GoalProgress.
      move={<StateLabel glyph={null} word={node.who.word} tone={node.who.tone} title={node.who.title} />}
      statusMenu={statusMenu}
      menu={menu}
      actions={GOAL_TREE_ACTIONS}
      anchorId={`step-${step.id}`}
      source={fromGoal ? `From ${fromGoal.title}` : undefined}
      // What a step waiting on you is waiting for (note 5aa7216c), or the
      // steps and questions it waits on (plan #1159), as the dev plan's Needs
      // line says it.
      need={node.need}
      comments={GOAL_COMMENTS}
      threadPlaceholder="A note on this step. Tag @dash to ask about it, or to give it figures to file."
      dependencies={{ catalog: context.catalog, groupOf: () => context.goalTitle }}
      marks={
        <>
          {yours && (
            <span
              title={node.who.title}
              className="inline-flex shrink-0 items-center rounded-full bg-accent-tint px-1 py-0.5 text-accent"
            >
              <CircleUser className="size-3" strokeWidth={2} aria-hidden />
              <span className="sr-only">Yours</span>
            </span>
          )}
          {dashes && (
            <span
              ref={markRef}
              title={
                step.kind === 'claude'
                  ? STEP_KIND_LABELS.claude
                  : arrived
                    ? 'Finished by Dash'
                    : node.who.title
              }
              className="inline-flex shrink-0 text-ink-muted"
            >
              <DashMark size="2xs" label="Dash's" />
            </span>
          )}
          {step.kind === 'rhythm' && (
            <span title={STEP_KIND_LABELS.rhythm} className="inline-flex shrink-0 text-ink-muted">
              <Repeat className="size-3" strokeWidth={1.75} aria-hidden />
              <span className="sr-only">{STEP_KIND_LABELS.rhythm}</span>
            </span>
          )}
        </>
      }
      priority={
        /* The shared cell truncates, which suits the plan's one word and
           size. A rhythm's count runs to three or four words ("0 of 1 this
           week"), so it wraps onto a second line the way the plan's "Next ·
           L" does rather than being cut off (plan #983). */
        answerChanged ? (
          <span className="whitespace-normal text-caution">An answer changed</span>
        ) : current && step.rhythmPeriod ? (
          <span className="whitespace-normal text-ink-muted">
            {progressLine(step.rhythmPeriod, current, step.countSource)}
          </span>
        ) : step.waitsUntil ? (
          <span className="text-ink-muted">Starts {formatDate(step.waitsUntil)}</span>
        ) : step.dueOn ? (
          <span className="text-ink-muted">Due {formatDate(step.dueOn)}</span>
        ) : null
      }
      quickActions={
        askable && (
          <form action={askAction}>
            <input type="hidden" name="id" value={step.id} />
            <RowIconButton type="submit" label={askLabel} pending={askPending}>
              <DashMark size="2xs" decorative />
            </RowIconButton>
          </form>
        )
      }
      notices={
        <>
          {blocking && (
            <BlockForm node={node} inset={rowInset(trail)} onDone={() => setBlocking(false)} />
          )}
          {/* What the last Ask Dash started, or why it was refused, wherever it was pressed. */}
          {pressNote && (
            <li style={rowInset(trail)} className="pb-1.5 pr-3 text-small">
              <FieldError>{askState.error}</FieldError>
              {!askState.error && <span className="text-ink-muted">{askState.message}</span>}
            </li>
          )}
          {/* The step's own latest run, read with the page (plan #1044). */}
          {run && <StepRunLine run={run} inset={rowInset(trail)} />}
          {stepOpen && (
            <ProgressLine
              progress={progress}
              beneath={context.progressBeneath?.[step.id]}
              total={{ quantity: step.estimatedTotal, unit: step.totalUnit }}
              inset={rowInset(trail)}
            />
          )}
        </>
      }
      // Edited where it is read (plan #1435): the title on the row, the
      // detail and done-when as text you press, the rest as chips.
      titleEditor={<StepTitleEditor node={step} onDone={() => row.setEditing(false)} />}
      detailView={<StepText node={step} field="detail" />}
      acceptanceView={isDecision ? undefined : <StepText node={step} field="acceptance" />}
      body={
        <>
          {!isDecision && <StepFacts node={step} links={links} otherGoals={context.otherGoals} />}
          {isDecision &&
            step.status !== 'dropped' &&
            (step.status === 'open' || step.resolution !== null) && <Question node={step} />}
          {step.kind === 'claude' &&
            (awaitsReview(step) || step.result || step.resultUrl || stepFiles.length > 0) && (
              <ClaudeResult node={step} files={stepFiles} />
            )}
          {step.kind === 'mine' && (step.result || step.resultUrl || stepFiles.length > 0) && (
            <ClaudeResult node={step} files={stepFiles} />
          )}
          {prep && <PrepNote prep={prep} />}
          {progress && <ProgressList progress={progress} />}
          {rhythm && rhythm.past.length > 0 && step.rhythmPeriod && (
            <PastPeriods past={rhythm.past} period={step.rhythmPeriod} />
          )}
          {filled && (
            <InformationStep
              node={step}
              collection={filled.collection}
              records={filled.records}
              answers={context.answers[step.id] ?? []}
              kinds={filled.kinds}
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
          {current && step.rhythmPeriod && <span>{progressLine(step.rhythmPeriod, current, step.countSource)}</span>}
          {step.waitsUntil && <span>Starts {formatDate(step.waitsUntil)}</span>}
          {step.dueOn && <span>Due {formatDate(step.dueOn)}</span>}
          {step.estimatedTotal && step.totalUnit && (
            <span className="tabular">
              About {amountWords(step.estimatedTotal, step.totalUnit)} in all
            </span>
          )}
          {prepares && (
            <a href={`#step-${prepares.id}`} className="underline">
              For {prepares.title}
            </a>
          )}
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
          {/* Ask Dash, with room to say what you want: the words go into the
              run's brief as a comment's would. Left empty, the step says it. */}
          {askable && (
            <form action={askAction} className="flex min-w-0 flex-[1_1_18rem] items-center gap-2">
              <input type="hidden" name="id" value={step.id} />
              <InlineInput
                name="asked"
                maxLength={4000}
                placeholder="What you want, if anything"
                className="max-sm:min-h-11"
                aria-label={`What you want Dash to do with ${step.title}`}
              />
              <Button type="submit" size="sm" variant="secondary" pending={askPending} className="shrink-0">
                <DashMark size="2xs" decorative />
                {askPending ? 'Asking…' : askLabel}
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
