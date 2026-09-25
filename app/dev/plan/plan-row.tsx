'use client';

import { useActionState, useMemo, useState } from 'react';
import { CircleUser, Pencil, Play } from 'lucide-react';
import {
  addPlanDependency,
  addPlanItem,
  answerPlanDecision,
  approvePlanItem,
  deletePlanItem,
  movePlanItem,
  removePlanDependency,
  reshapePlanFeature,
  sendPlanFeatureToClaude,
  dismissPlanDecision,
  dismissPlanFog,
  sendPlanItemToClaude,
  setPlanItemAssignee,
  setPlanItemPriority,
  setPlanItemStatus,
  type PlanActionState,
} from './actions';
import { ActionMenu, type ActionMenuItem } from '@/components/ui/action-menu';
import { useClockNow } from '@/lib/use-clock-now';
import { Button } from '@/components/ui/button';
import { FieldError, FieldHint } from '@/components/ui/field';
import { PLAN_PRIORITIES, PLAN_PRIORITY_LABEL, PLAN_STATUSES, isClosed } from '@/lib/plan/load';
import {
  flatten,
  healthOf as planHealthOf,
  moveOf as planMoveOf,
  planLiveness,
  type MoveContext,
  type PlanLiveness,
  type PlanMove,
  type PlanNode,
  type PlanView as View,
} from '@/lib/plan/tree';
import {
  healthOf as healthWordsOf,
  moveFor as moveWordsFor,
  type HealthFacts,
} from '@/lib/plan/health-words';
import { reshapeOrigin } from '@/lib/plan/origin';
import { quietSendAsk } from '@/lib/plan/liveness';
import { isResolvingAnswers, type LastRun } from '@/lib/plan/run-end';
import { type RunRaise } from '@/lib/plan/work';
import { checkLine, type CommitCheck } from '@/lib/plan/checks';
import {
  AnswerBox,
  QuestionPartLabel,
  TheAnswered,
  TheOptions,
  TheQuestion,
  useAnswerDraft,
} from '@/components/dev/question';
import {
  CheckMark,
  LastRunLine,
  RowIconButton,
  RunWork,
  RunningFor,
  Underway,
  when,
} from './plan-run-status';
import { type PlanCatalogEntry } from './plan-catalog';
import { cn } from '@/lib/cn';
import { TreeRow, rowInset, useTreeRow } from '@/components/plan-tree/tree-row';
import {
  ASSIGNEE_LABEL,
  AddStep,
  EditStep,
  SIZE_LABEL,
  STATUS_LABEL,
  scopeLabel,
} from './step-forms';
import type { TreeActions } from '@/components/plan-tree/types';

/**
 * One row of the dev plan, drawn through the shared tree row.
 */

/** The plan's own writes, for the shared tree components. */
const PLAN_TREE_ACTIONS: TreeActions = {
  answer: answerPlanDecision,
  setStatus: setPlanItemStatus,
  dismissQuestion: dismissPlanDecision,
  ask: addPlanItem,
  addDependency: addPlanDependency,
  removeDependency: removePlanDependency,
  dismissFog: dismissPlanFog,
};

/**
 * What a step waits on, and what waits on it.
 *
 * "Waits on" is the edge you edit; "unblocks" is the same edges read from the
 * other end and is only shown. An inherited wait -- one declared on a step
 * above -- is shown but not removable here, because it is not this step's to
 * remove.
 */
/**
 * The box a decision closes in.
 *
 * One field, because a decision closes on one thing: what you decided, in
 * your words. It goes into `resolution`, where every brief written beneath
 * this feature from now on will carry it, which is what stops a session three
 * nights later asking the same question again.
 *
 * No commit is recorded and none is asked for. A question is not work, and a
 * decision wearing a commit it had nothing to do with would be a lie the plan
 * told about itself. An answer already given is shown above the box rather
 * than loaded into it: changing your mind should read as a new answer, not as
 * an edit that quietly replaces the old one in the record.
 *
 * Where the question was written with lettered options, they sit above the box
 * as chips. Pressing one writes that option into the box rather than recording
 * it: an answer is read by every session that works beneath this feature from
 * now on, so the last word before it is written down stays yours, and "b, but
 * only for the shared lists" is the answer you most often actually want. The
 * box is still the whole form when a question has no options, which is most of
 * them.
 */
function AnswerDecision({
  node,
  action,
  pending,
  autoFocus,
}: {
  node: PlanNode;
  action: (formData: FormData) => void;
  pending: boolean;
  autoFocus: boolean;
}) {
  const { answer, setAnswer, choose } = useAnswerDraft();

  return (
    /* A well, not a frame: this sits inside the open step, which is already a
       box, and the caution hairline round it was a second claim on a grouping
       the ground had already made. The tint stays -- it is the thing saying a
       question is waiting on you. Law 11. */
    <div className="space-y-2.5 rounded-lg bg-caution-tint/40 px-3 py-2.5">
      {/* The question and its options, before the box that closes them. The
          box used to come first with the options as a row of chips above it,
          which put the form in front of the thing the form is about. */}
      <TheQuestion outline={node.outline} title={node.title} />
      <TheOptions detail={node.detail} onChoose={choose} />

      {node.resolution && <TheAnswered resolution={node.resolution} />}
      <AnswerBox
        id={node.id}
        detail={node.detail}
        resolution={node.resolution}
        action={action}
        pending={pending}
        answer={answer}
        onAnswer={setAnswer}
        autoFocus={autoFocus}
        hint
      />
    </div>
  );
}

/**
 * A setup job, and the one press that closes it.
 *
 * Shaped like the answer box above and not like the status dropdown, because
 * it is the same kind of row: something only the person can clear, closed by
 * their word rather than by a commit. The dropdown is where you say where a
 * piece of work has got to; this is not a piece of work that got anywhere, it
 * is an errand, and pressing Done on it through a menu made it look like one
 * more status to keep up to date.
 *
 * The title is the one-line summary and the detail is what to actually go and
 * do -- #599 asked for both, so the detail is drawn here, labelled, rather
 * than left as the unlabelled paragraph every other step's detail is. The
 * paragraph is suppressed while this is showing so it is not said twice.
 *
 * Closing writes `done` through `setPlanItemStatus`, which records no commit,
 * the same as answering a decision: `commit_sha` stays null, because nothing
 * was built.
 */
function SetupJob({
  node,
  action,
  pending,
  error,
}: {
  node: PlanNode;
  action: (formData: FormData) => void;
  pending: boolean;
  error?: string;
}) {
  return (
    <div className="space-y-2.5 rounded-lg bg-caution-tint/40 px-3 py-2.5">
      <div className="space-y-0.5">
        <QuestionPartLabel>What to set up</QuestionPartLabel>
        <p className="whitespace-pre-wrap text-ui text-ink">{node.detail?.trim() || node.title}</p>
      </div>
      <form action={action} className="space-y-2">
        <input type="hidden" name="id" value={node.id} />
        <input type="hidden" name="status" value="done" />
        <FieldHint>This closes the step. Nothing is committed against it.</FieldHint>
        <Button type="submit" size="sm" pending={pending}>
          I have set this up
        </Button>
        <FieldError>{error}</FieldError>
      </form>
    </div>
  );
}

/**
 * What pressing Send actually sends, said before it is pressed.
 *
 * The brief carries the step's whole subtree under "## Steps", so Send on a
 * feature sends the feature and everything beneath it. The button read
 * "Send to Claude" whichever row it sat on, so pressing it on #197 looked like
 * sending one step and sent ten. The action already says so afterwards; this
 * is the same count, in the label, before you commit to it.
 *
 * Everything beneath at any depth, closed rows included, because that is what
 * the brief prints -- deliberately not the batch button's count, which is the
 * open steps it would work through.
 */
function sendLabel(node: PlanNode): string {
  const beneath = flatten([node]).length - 1;
  return beneath === 0
    ? `Send #${node.number} to Dash`
    : `Send #${node.number} and ${beneath} ${beneath === 1 ? 'step' : 'steps'} to Dash`;
}

/**
 * Start the routine on it now.
 *
 * The button is offered whether or not the deployment can start a routine,
 * because the action says exactly what is missing when it cannot, and a
 * button that is simply absent leaves nobody knowing what to set.
 */
function SendToClaude({
  node,
  canSend,
  action,
  pending,
  batchAction,
  batchPending,
  reshapeAction,
  reshapePending,
  quiet,
  quietAsk,
  onAskQuiet,
  resolving,
}: {
  node: PlanNode;
  canSend: boolean;
  action: (formData: FormData) => void;
  pending: boolean;
  /** The whole subtree in one press. Only worth offering where there is one. */
  batchAction: (formData: FormData) => void;
  batchPending: boolean;
  /** The other direction: re-read the feature against what has been settled. */
  reshapeAction: (formData: FormData) => void;
  reshapePending: boolean;
  /** Nothing has been said about the last run yet, so the missing-key note is
      worth the room. */
  quiet: boolean;
  /**
   * The run behind this step has gone quiet, so Send asks before it hands the
   * step over. Null when there is nothing to ask, which is most rows.
   */
  quietAsk: string | null;
  /** Put that question on the row. The row owns it, not this button. */
  onAskQuiet: () => void;
  /**
   * A re-shape is re-reading this feature right now.
   *
   * Everything that hands work over is shut while it is: the run is rewriting
   * the steps a press would send, so a session sent now would build against a
   * plan that is about to change under it, and a second re-shape would be the
   * duplicate-question collision all over again. The button is disabled rather
   * than removed -- a control that vanishes teaches nobody why.
   */
  resolving: boolean;
}) {
  // Every open step beneath, the feature itself aside: what the batch would
  // take on, and the only reason to offer it.
  const beneath = flatten([node]).filter(
    (step) => step.id !== node.id && !isClosed(step.status) && step.status !== 'proposed',
  ).length;

  const held = resolving
    ? 'Dash is re-reading this feature against the answers you just gave. This comes back when it is done.'
    : undefined;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {quietAsk ? (
        // Nothing is submitted from here while the run is quiet. The press
        // raises the question on the row, and answering it is what sends --
        // one question in one place, however Send was reached.
        <Button
          type="button"
          size="sm"
          variant="secondary"
          disabled={resolving}
          title={held ?? quietAsk}
          onClick={onAskQuiet}
        >
          <Play className="size-3.5" aria-hidden />
          {sendLabel(node)}
        </Button>
      ) : (
        <form action={action}>
          <input type="hidden" name="id" value={node.id} />
          <Button
            type="submit"
            size="sm"
            variant="secondary"
            pending={pending}
            disabled={resolving}
            title={held}
          >
            <Play className="size-3.5" aria-hidden />
            {pending ? 'Sending…' : sendLabel(node)}
          </Button>
        </form>
      )}
      {beneath > 0 && (
        <form action={batchAction}>
          <input type="hidden" name="id" value={node.id} />
          <Button
            type="submit"
            size="sm"
            variant="ghost"
            pending={batchPending}
            disabled={resolving}
            title={held ?? 'Start one session on every open step beneath this one, worked in order'}
          >
            {batchPending ? 'Sending…' : `Send all ${beneath} beneath`}
          </Button>
        </form>
      )}
      {/* The return trip, and the only button here that starts no build: it
          asks for the feature to be re-read against what has been
          settled beneath it, and everything that comes back is a proposal
          waiting on the same approve as anything else. Offered wherever there
          is something beneath to re-read. */}
      {node.children.length > 0 && node.status !== 'proposed' && (
        <form action={reshapeAction}>
          <input type="hidden" name="id" value={node.id} />
          <Button
            type="submit"
            size="sm"
            variant="ghost"
            pending={reshapePending}
            disabled={resolving}
            title={
              held ??
              'Re-read this feature against the questions answered beneath it. Whatever comes back is proposed, not started.'
            }
          >
            {reshapePending ? 'Re-shaping…' : 'Re-shape'}
          </Button>
        </form>
      )}
      {/* Said in the row as well as on the tooltip: three buttons that have
          gone quiet at once is the kind of thing a person reads as broken
          unless something tells them otherwise. Law 2. */}
      {resolving && (
        <span className="text-small text-ink-muted">
          Re-reading this against your answers. The buttons come back when it is done.
        </span>
      )}
      {!canSend && quiet && !resolving && (
        <span className="text-small text-ink-muted">
          Needs the plan routine&apos;s token on the deployment.
        </span>
      )}
    </div>
  );
}

/** The facts a health tooltip needs, read off a plan row. */
function healthFactsOf(node: PlanNode): HealthFacts {
  return {
    closed: isClosed(node.status),
    openBeneath: flatten(node.children).filter((child) => !isClosed(child.status)),
    resolution: node.resolution,
    blockAsk: node.blockAsk,
    comment: node.comment,
    waitingOn: node.waitingOn,
  };
}

function healthOf(node: PlanNode, liveness?: PlanLiveness) {
  return healthWordsOf(planHealthOf(node, liveness), healthFactsOf(node));
}

function moveFor(node: PlanNode, context?: MoveContext) {
  return moveWordsFor(planMoveOf(node, context), ownMoveWord(node, context));
}

/** What this row alone would say, to tell a rollup from a row's own state. */
function ownMoveWord(node: PlanNode, context?: MoveContext): PlanMove {
  return planMoveOf({ ...node, children: [] }, context);
}

/**
 * Which rows a re-shape is running against right now.
 *
 * Built from the runs the page already loaded rather than from a second read:
 * `loadLastRuns` carries the job, and a re-shape still going is the whole of
 * the question. Recomputed as the clock ticks, so the state clears on its own
 * when the run ages out rather than on the next navigation.
 */
function useResolving(lastRuns: Readonly<Record<string, LastRun>>, now: number): MoveContext {
  return useMemo(
    () => ({
      resolving: new Set(
        Object.entries(lastRuns)
          .filter(([, run]) => isResolvingAnswers(run, now))
          .map(([id]) => id),
      ),
    }),
    [lastRuns, now],
  );
}

/**
 * One step: what it is, where it stands, and what is beneath it.
 *
 * Closed, it is a line across the columns -- the number and title with the
 * first line of what it involves dimmed beneath, then its health, its
 * priority and size, who holds it, and the state of the steps under it. The
 * full detail, the acceptance criteria, the note and the dependencies are
 * behind the fold because a plan is read as a list far more often than any
 * one step of it is read in full. Its sub-steps follow it as rows of their
 * own, one level further in, folded with the chevron; the fold starts closed
 * on a step that is finished, because what is done is consulted, not read.
 */
export function PlanRow({
  node,
  trail,
  catalog,
  canSend,
  lastRuns,
  runRaises = [],
  liveness: serverLiveness = {},
  commitChecks,
  view,
  searching,
  unfolded,
  opened = false,
}: {
  node: PlanNode;
  /** One entry per level above: whether that level's line carries on below this row. */
  trail: readonly boolean[];
  catalog: readonly PlanCatalogEntry[];
  canSend: boolean;
  /** The newest run against each step, by step id. Most steps have none. */
  lastRuns: Readonly<Record<string, LastRun>>;
  /**
   * What sessions have raised, for the opened step's account of its run.
   *
   * Every raise that names a step, not this step's: which run filed which is
   * `runWork`, off the source and the time. Defaulted, because a render with
   * none simply says nothing was raised.
   */
  runRaises?: readonly RunRaise[];
  /**
   * The same reading worked out on the server, at the clock it rendered with.
   *
   * Used until the browser's clock mounts. Without it the first paint would
   * read every claim as fresh -- `runNow` is 0 before mount -- while the
   * counts beside the module heading, worked out server-side from a real
   * clock, already said one of them had stopped. One answer on the first
   * paint, and the row takes over from the ticking clock after it.
   */
  liveness?: PlanLiveness;
  /** What CI said about each commit a step shipped in, by the commit's sha. */
  commitChecks: Readonly<Record<string, CommitCheck>>;
  /** Which view is on. Only Dismissed shows what has been put aside. */
  view: View;
  /** Whether a search is narrowing the page. Unfolds closed rows that hold a hit. */
  searching: boolean;
  /**
   * Start with the sub-steps showing.
   *
   * A seam for the render tests, and said plainly rather than dressed up as a
   * feature: the page folds every feature by default, a folded row renders no
   * children at all, and `renderToStaticMarkup` cannot press the arrow. The
   * tests that pin how a nested row is laid out would otherwise have nothing
   * to look at. Nothing in the app passes it.
   */
  unfolded: boolean;
  /**
   * Start with every row's own panel open.
   *
   * The second seam for the render tests, and separate from `unfolded` because
   * they open different things: that one shows a row's sub-steps, this one
   * shows what is behind the row's own fold. The tests about the panel -- what
   * a step's run has done among them -- would otherwise be asserting against a
   * closed drawer, and `renderToStaticMarkup` cannot press the title. Nothing
   * in the app passes it.
   */
  opened?: boolean;
}) {
  // Ticks, so a re-shape that ages out stops holding this row's buttons shut
  // without the page being navigated. 0 before mount, which is what keeps the
  // server render and the first client one agreeing.
  const runNow = useClockNow();
  const row = useTreeRow(node, {
    searching,
    unfolded,
    opened,
    showDismissed: view === 'dismissed',
  });
  const { setOpen, setEditing, setAnswering, hasChildren } = row;
  // Send has been pressed on a step whose run went quiet, and the question is
  // on the page waiting to be answered. Held by the row rather than by a
  // button because there are three ways to press Send here -- the quick icon,
  // the button on the opened row and the row menu -- and one question in one
  // place is better than the same question drawn three times.
  const [confirmingSend, setConfirmingSend] = useState(false);

  const [assignState, assignAction, assignPending] = useActionState(
    setPlanItemAssignee,
    {} as PlanActionState,
  );
  // Held by the row rather than by the button, because the same action is one
  // of the quick icons and what happened is said once, in one place.
  const [sendState, sendAction, sendPending] = useActionState(
    sendPlanItemToClaude,
    {} as PlanActionState,
  );
  // The same press for the whole subtree: one press, every step beneath.
  const [batchState, batchAction, batchPending] = useActionState(
    sendPlanFeatureToClaude,
    {} as PlanActionState,
  );
  const [answerState, answerAction, answerPending] = useActionState(
    answerPlanDecision,
    {} as PlanActionState,
  );
  // The one press that closes a setup job. Held by the row for the same reason
  // the hand-over is: the status dropdown drives the same action, and what
  // came back should be said once rather than under each control.
  const [setupState, setupAction, setupPending] = useActionState(
    setPlanItemStatus,
    {} as PlanActionState,
  );
  // The other direction: re-read this feature against what has been answered
  // beneath it, and propose what has changed.
  const [reshapeState, reshapeAction, reshapePending] = useActionState(
    reshapePlanFeature,
    {} as PlanActionState,
  );

  const descendants = flatten([node]).length - 1;
  const closed = isClosed(node.status);
  const isDecision = node.kind === 'decision';
  // A setup job still open. Closed, it is an ordinary finished row.
  const setupOpen = node.kind === 'setup' && !closed;
  // What the runs say about the claims on this row and everything under it.
  //
  // Recomputed as the clock ticks, so a session that goes quiet while you are
  // looking at the page says so without a navigation -- the same reason
  // `useResolving` is built this way. Only this row's subtree, because that is
  // all this row can report on: the module's counts are worked out server-side
  // in `buildPlanTree`, from the same function.
  const liveness = useMemo(
    () => (runNow === 0 ? serverLiveness : planLiveness(flatten([node]), lastRuns, runNow)),
    [node, lastRuns, runNow, serverLiveness],
  );
  const health = healthOf(node, liveness);
  const claim = liveness[node.id];
  // The run behind this row, where there is one to account for. Typed as
  // possibly missing because most rows have no run at all -- the index
  // signature says otherwise and would let a row with none through.
  const run: LastRun | undefined = lastRuns[node.id];
  // A step being worked is what the account of a run is for. A run still
  // reading `started` is included as well, because a feature batch is fired at
  // a feature the batch itself never claims, and that row is where somebody
  // looks for what the batch has done.
  const accountForRun =
    run !== undefined && (node.status === 'in_progress' || run.status === 'started');
  // The question Send has to put first, or null when it has nothing to ask.
  //
  // A quiet run may still be working -- the twenty-minute mark reads wrong on
  // a session that is reading files or waiting on a build -- so #574 settled
  // that the press is taken with the evidence in front of you. Null before
  // mount, since `runNow` is 0 there and no claim reads quiet at that instant,
  // which is what keeps the server render and the first client one agreeing.
  const quietAsk = claim === 'quiet' && run ? quietSendAsk(node.number, run, runNow) : null;
  const resolving = useResolving(lastRuns, runNow);
  // What a "#494" written in a comment on this page is called. The catalog is
  // already every step's number and title, so no page needs to hand it over.
  const refTitles = useMemo(
    () =>
      Object.fromEntries(
        catalog.map((entry) => [entry.number, { title: entry.title, outline: entry.outline }]),
      ),
    [catalog],
  );
  const move = moveFor(node, resolving);
  // Whether this row itself is the one being re-read. The rollup above would
  // also be true of a feature whose child is being re-shaped, and it is the
  // child's buttons that should be shut, not this one's.
  const beingResolved = resolving.resolving?.has(node.id) ?? false;

  // The answer that produced this row, on the steps a re-shape wrote and on
  // nothing else.
  const origin = reshapeOrigin(node.comment);

  // A proposal's first choice is to approve it, with the proposed steps
  // beneath it; the plain statuses follow, and "proposed" is not offered on a
  // step that has already been decided on -- that is a door that only opens
  // one way.
  const proposedBeneath = flatten([node]).filter((step) => step.status === 'proposed').length;
  const statusMenu: ActionMenuItem[] = [
    ...(node.status === 'proposed'
      ? [
          {
            id: 'approve',
            label: proposedBeneath > 1 ? `Approve, with ${proposedBeneath - 1} beneath` : 'Approve',
            formAction: (formData: FormData) => approvePlanItem({}, formData),
            formFields: { id: node.id },
          },
        ]
      : []),
    // A decision's first move is to answer it, in the place a build step's
    // first move is to mark it done -- and "Done" is not offered on one at
    // all, because a question closed with no answer is the thing decisions
    // exist to stop. It opens the box rather than doing it, since what closes
    // a decision is words.
    ...(isDecision
      ? [
          {
            id: 'answer',
            label: node.resolution ? 'Change the answer' : 'Answer',
            onSelect: () => {
              setOpen(true);
              setAnswering(true);
            },
          },
        ]
      : []),
    ...PLAN_STATUSES.filter(
      (status) => status !== 'proposed' && !(isDecision && status === 'done'),
    ).map((status) => ({
      id: status,
      label: STATUS_LABEL[status],
      disabled: status === node.status,
      formAction: (formData: FormData) => setPlanItemStatus({}, formData),
      formFields: { id: node.id, status },
    })),
  ];

  const priorityMenu: ActionMenuItem[] = PLAN_PRIORITIES.map((priority) => ({
    id: `priority-${priority}`,
    label: PLAN_PRIORITY_LABEL[priority],
    disabled: priority === node.priority,
    formAction: (formData: FormData) => setPlanItemPriority({}, formData),
    formFields: { id: node.id, priority: String(priority) },
  }));

  // The open steps beneath this one, which the press covers as well. Said in
  // the label rather than found out afterwards.
  const openBeneath = flatten([node]).filter(
    (step) => step.id !== node.id && !isClosed(step.status),
  ).length;
  const beneath = openBeneath > 0 ? `, with ${openBeneath} beneath` : '';
  // The row's assignee press is what you keep a step back with. The runner
  // takes anything approved that is not yours, so marking a step Mine holds it
  // until you press again; clearing the column gives it back. Until #670 that
  // press was Hand to Dash, from when the runner could only see a step somebody
  // had handed it, and setting a step to Me meant opening Edit.
  const mine = node.assignee === 'me';
  const assignLabel = mine ? `Not mine${beneath}` : `Mine${beneath}`;
  const assignValue = mine ? '' : 'me';

  const menu: ActionMenuItem[] = [
    {
      // First, because keeping a step back is the move this page exists to make
      // and it should not need the step opened first.
      id: 'assign',
      label: assignLabel,
      formAction: (formData: FormData) => setPlanItemAssignee({}, formData),
      formFields: { id: node.id, assignee: assignValue },
    },
    // The quick icons are only there from sm up and only under a pointer, so
    // the menu carries the same two actions for a phone and for a keyboard.
    ...(closed
      ? []
      : [
          {
            id: 'send',
            label: sendLabel(node),
            // Shut for the same reason the button beside it is: the menu is
            // the phone's copy of that button, not a way round it.
            disabled: beingResolved,
            // A quiet run is asked about here with the menu's own confirm,
            // which arms on the first press and does it on the second -- the
            // same shape the question on the row takes, so the two doors ask
            // the same thing. The flag rides on the item, because the menu
            // sends the fields it is given and the guard refuses the press
            // without it anyway.
            ...(quietAsk ? { confirm: quietAsk } : {}),
            formAction: (formData: FormData) => sendPlanItemToClaude({}, formData),
            formFields: quietAsk ? { id: node.id, confirm: 'quiet' } : { id: node.id },
          },
        ]),
    // The return trip, beside the two hand-overs. Only on a feature: a leaf
    // step has nothing beneath it to re-read, and the action says so if it is
    // reached anyway.
    ...(hasChildren && !closed && node.status !== 'proposed'
      ? [
          {
            id: 'reshape',
            label: 'Re-shape against what is decided',
            formAction: (formData: FormData) => reshapePlanFeature({}, formData),
            formFields: { id: node.id },
          },
        ]
      : []),
    { id: 'add-child', label: 'Add a sub-step', onSelect: row.addChild },
    { id: 'edit', label: 'Edit', onSelect: () => setEditing(true) },
    {
      id: 'up',
      label: 'Move up',
      formAction: (formData: FormData) => movePlanItem({}, formData),
      formFields: { id: node.id, direction: 'up' },
    },
    {
      id: 'down',
      label: 'Move down',
      formAction: (formData: FormData) => movePlanItem({}, formData),
      formFields: { id: node.id, direction: 'down' },
    },
    {
      id: 'delete',
      label: 'Delete',
      destructive: true,
      confirm:
        descendants > 0
          ? `Delete #${node.number} and the ${descendants} step${descendants === 1 ? '' : 's'} beneath it? This cannot be undone.`
          : `Delete #${node.number}? This cannot be undone.`,
      formAction: (formData: FormData) => deletePlanItem({}, formData),
      formFields: { id: node.id },
    },
  ];

  const inset = rowInset(trail);
  const actionError =
    assignState.error ??
    sendState.error ??
    batchState.error ??
    reshapeState.error ??
    answerState.error;
  const actionMessage =
    assignState.message ??
    sendState.message ??
    batchState.message ??
    reshapeState.message ??
    answerState.message;

  return (
    <TreeRow
      node={node}
      trail={trail}
      row={row}
      health={health}
      move={move}
      statusMenu={statusMenu}
      menu={menu}
      actions={PLAN_TREE_ACTIONS}
      origin={origin}
      titles={refTitles}
      dependencies={{ catalog, groupOf: (entry) => scopeLabel(entry.module) }}
      marks={
        <>
          {/* The steps you kept, on the row.
           * The runner takes anything approved that is not yours, so the
           * fact worth reading off a resting row is which steps it will
           * skip. The row's Mine press carries the same fact in its accented
           * icon, but that icon is drawn only under the pointer and not at
           * all below sm, so this is the only place a plan at rest says it.
           * Steps still holding the old 'claude' value are not read here and
           * nothing clears them. A mark, not a column: it appears on the few
           * steps you held back, which is what makes it worth reading. */}
          {mine && (
            <span
              title="Yours. The runner will not take this one."
              className="inline-flex shrink-0 items-center rounded-full bg-accent-tint px-1 py-0.5 text-accent"
            >
              {/* The head-and-shoulders from the assignee picker, the same
                  icon the Mine press uses, so the mark and the press that
                  sets it are recognisably one thing. */}
              <CircleUser className="size-3" strokeWidth={2} aria-hidden />
              <span className="sr-only">Marked yours</span>
            </span>
          )}
          {/* And whether the checks passed on what it shipped in. */}
          {node.status === 'done' && node.commitSha && (
            <CheckMark check={commitChecks[node.commitSha]} />
          )}
          {/* And how long it has been going.
           * "In progress" in the health column is a state; this is the
           * thing you actually want to know about a step Claude is on --
           * whether it started four minutes ago or has been sitting at
           * "in progress" since yesterday, which is what a stuck routine
           * looks like from here. The dot pulses because the one fact it
           * carries is that something is happening right now. */}
          {node.status === 'in_progress' && node.startedAt && (
            <Underway startedAt={node.startedAt} assignee={node.assignee} claim={claim} />
          )}
        </>
      }
      priority={
        /* Priority, and only when it says something. Nearly every step is at
           Normal, so the word was on almost every row and told you nothing;
           what you are scanning for is the handful marked Next or Someday.
           The separator before the size goes with it, so a normal step at S
           reads as "S" rather than as "· S".

           A word you click, like the health beside it -- note 3bfb2749. At
           Normal there is no word to click, so the trigger is the word
           itself, drawn only while the row is under the pointer or the menu
           is being reached by keyboard: the resting row still says nothing,
           which is the whole reason Normal is silent. */
        <>
          <ActionMenu
            label={`Priority of #${node.number} ${node.title}`}
            items={priorityMenu}
            align="start"
            triggerClassName={cn(
              'h-auto w-auto rounded px-0.5 py-0 font-normal',
              node.priority === 2 &&
                'text-ink-ghost opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100',
            )}
            trigger={
              <span
                className={cn(
                  node.priority === 1 && 'text-accent',
                  node.priority === 3 && 'text-ink-ghost',
                )}
              >
                {PLAN_PRIORITY_LABEL[node.priority]}
              </span>
            }
          />
          {node.size && (
            <span className="text-ink-muted" title={SIZE_LABEL[node.size]}>
              {node.priority !== 2 && ' · '}
              {node.size.toUpperCase()}
            </span>
          )}
        </>
      }
      quickActions={
        <>
          {!closed &&
            (quietAsk ? (
              // Nothing is sent from here while the run is quiet: the press
              // puts the question on the row instead, and the answer to it
              // is what sends. The icon has no room for a question of its
              // own, and a confirmation that appeared under the pointer and
              // vanished with it would be no confirmation at all.
              <RowIconButton label={sendLabel(node)} onClick={() => setConfirmingSend(true)}>
                <Play className="size-3.5" strokeWidth={1.75} aria-hidden />
              </RowIconButton>
            ) : (
              <form action={sendAction}>
                <input type="hidden" name="id" value={node.id} />
                <RowIconButton type="submit" label={sendLabel(node)} pending={sendPending}>
                  <Play className="size-3.5" strokeWidth={1.75} aria-hidden />
                </RowIconButton>
              </form>
            ))}
          <form action={assignAction}>
            <input type="hidden" name="id" value={node.id} />
            <input type="hidden" name="assignee" value={assignValue} />
            <RowIconButton type="submit" label={assignLabel} pending={assignPending}>
              {/* The head-and-shoulders the assignee picker uses for Me, and
                  accented while the step is yours, so the icon says which way
                  the next press goes. */}
              <CircleUser
                className={cn('size-3.5', mine && 'text-accent')}
                strokeWidth={1.75}
                aria-hidden
              />
            </RowIconButton>
          </form>
          <RowIconButton label="Edit" onClick={() => setEditing(true)}>
            <Pencil className="size-3.5" strokeWidth={1.75} aria-hidden />
          </RowIconButton>
        </>
      }
      notices={
        <>
          {/* The question a quiet run puts in front of Send, wherever the press
              came from. It sits where the result of that press will sit, so the
              answer and what came back of it read as one exchange in one place.
              Gone once something has come back, since the question has been
              answered by then and the answer is what there is to read. */}
          {confirmingSend && quietAsk && !sendState.error && !sendState.message && (
            <li style={inset} className="pb-1.5 pr-3 text-small">
              <p className="text-ink-muted">{quietAsk}</p>
              <div className="mt-1 flex items-center gap-2">
                {/* Cancel first and plain, because doing nothing is the safe half
                    of this and the press that sends should be the deliberate one. */}
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => setConfirmingSend(false)}
                >
                  Cancel
                </Button>
                <form action={sendAction}>
                  <input type="hidden" name="id" value={node.id} />
                  {/* The answer, and the only thing that carries it. The guard
                      refuses the press without it. */}
                  <input type="hidden" name="confirm" value="quiet" />
                  <Button type="submit" size="sm" variant="secondary" pending={sendPending}>
                    {sendPending ? 'Sending…' : 'Send it anyway'}
                  </Button>
                </form>
              </div>
            </li>
          )}

          {/* What the last action did, wherever it was started from. */}
          {(actionError ?? actionMessage) && (
            <li style={inset} className="pb-1.5 pr-3 text-small">
              <FieldError>{actionError}</FieldError>
              {!actionError && (
                // Ink, not green. The tones above are a status system where
                // positive means done; this is a transient "Assigned" or "Sent"
                // from the action that just ran, which is the system reporting
                // itself and is not a claim about money (law 4).
                <span className="text-ink-muted">{actionMessage}</span>
              )}
            </li>
          )}
        </>
      }
      edit={<EditStep node={node} catalog={catalog} onDone={() => setEditing(false)} />}
      body={
        <>
          {/* What its run has done, above the questions and the thread: on a
              step you opened because it says somebody is working it, this is
              the thing you opened it to find out. */}
          {accountForRun && run && (
            <RunWork run={run} node={node} catalog={catalog} raises={runRaises} />
          )}

          {isDecision && (
            <AnswerDecision
              node={node}
              action={answerAction}
              pending={answerPending}
              autoFocus={row.answering}
            />
          )}

          {setupOpen && (
            <SetupJob
              node={node}
              action={setupAction}
              pending={setupPending}
              error={setupState.error}
            />
          )}
        </>
      }
      meta={
        <p className="flex flex-wrap gap-x-3 text-small text-ink-muted">
          <span>{scopeLabel(node.module)}</span>
          {node.priority !== 2 && <span>{PLAN_PRIORITY_LABEL[node.priority]}</span>}
          {node.size && <span>{SIZE_LABEL[node.size]}</span>}
          {node.assignee && <span>{ASSIGNEE_LABEL[node.assignee]}</span>}
          {when(node.startedAt) && (
            <span>
              Started {when(node.startedAt)}
              {node.status === 'in_progress' && node.startedAt && (
                <RunningFor startedAt={node.startedAt} claim={claim} />
              )}
            </span>
          )}
          {when(node.completedAt) && (
            <span>
              {node.status === 'dropped' ? 'Dropped' : 'Done'} {when(node.completedAt)}
            </span>
          )}
          {node.commitSha && <span className="font-mono">{node.commitSha}</span>}
          {node.status === 'done' && node.commitSha && (
            <span
              className={
                commitChecks[node.commitSha]?.conclusion === 'failed' ||
                commitChecks[node.commitSha]?.conclusion === 'unmerged'
                  ? 'text-caution'
                  : undefined
              }
            >
              {checkLine(commitChecks[node.commitSha])}
            </span>
          )}
          {/* Only where the block above is not already accounting for
              this run: two sentences about the same run on one opened row
              is one of them too many. */}
          {run && !accountForRun && <LastRunLine run={run} />}
        </p>
      }
      panelActions={
        <>
          <form action={assignAction}>
            <input type="hidden" name="id" value={node.id} />
            <input type="hidden" name="assignee" value={assignValue} />
            <Button type="submit" size="sm" variant="ghost" pending={assignPending}>
              {assignLabel}
            </Button>
          </form>
          {!closed && (
            <SendToClaude
              node={node}
              canSend={canSend}
              action={sendAction}
              pending={sendPending}
              batchAction={batchAction}
              batchPending={batchPending}
              reshapeAction={reshapeAction}
              reshapePending={reshapePending}
              resolving={beingResolved}
              quietAsk={quietAsk}
              onAskQuiet={() => setConfirmingSend(true)}
              quiet={
                !sendState.error && !sendState.message && !batchState.error && !batchState.message
              }
            />
          )}
        </>
      }
      addChild={
        <AddStep
          module={node.module}
          parentId={node.id}
          open
          onDone={() => row.setAddingChild(false)}
        />
      }
      renderChild={(child, childTrail) => (
        <PlanRow
          // The shared row hands back the node it was given, so this is one.
          node={child as PlanNode}
          trail={childTrail}
          catalog={catalog}
          canSend={canSend}
          lastRuns={lastRuns}
          runRaises={runRaises}
          liveness={serverLiveness}
          commitChecks={commitChecks}
          view={view}
          searching={searching}
          unfolded={unfolded}
          opened={opened}
        />
      )}
    />
  );
}
