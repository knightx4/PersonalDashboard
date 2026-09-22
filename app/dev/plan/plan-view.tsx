'use client';

import { useActionState, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  Check,
  Circle,
  CircleUser,
  Flag,
  ChevronDown,
  ChevronRight,
  HelpCircle,
  Pencil,
  Play,
  Scale,
  Wrench,
  X,
} from 'lucide-react';
import {
  addPlanDependency,
  addPlanItem,
  answerPlanDecision,
  approvePlanItem,
  deletePlanItem,
  movePlanItem,
  removePlanDependency,
  seedPlan,
  reshapePlanFeature,
  sendPlanFeatureToClaude,
  dismissPlanDecision,
  dismissPlanFog,
  sendPlanItemToClaude,
  setPlanItemAssignee,
  setPlanItemPriority,
  setPlanItemStatus,
  updatePlanItem,
  type PlanActionState,
} from './actions';
import { ActionMenu, type ActionMenuItem } from '@/components/ui/action-menu';
import { planRowId } from '@/lib/comments/refs';
import { CommentCount } from '@/components/dev/comment-count';
import { CommentThread } from '@/components/dev/comment-thread';
import { useClockNow } from '@/lib/use-clock-now';
import { Button } from '@/components/ui/button';
import { AddTrigger } from '@/components/ui/add-trigger';
import { cardVariants } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Banner } from '@/components/ui/banner';
import { Bands } from '@/components/ui/meter';
import { StatusGlyph } from '@/components/ui/status-glyph';
import {
  ChipSelect,
  ComposeBody,
  ComposeTitle,
  FieldError,
  FieldHint,
  Input,
  Label,
  Select,
  Textarea,
} from '@/components/ui/field';
import { StateLabel, TONE_TEXT, type DevTone } from '@/components/dev/state-label';
import { DEV_STATE_WORD, PLAN_MOVE_WORD } from '@/lib/dev/words';
import { MODULES, type ModuleId } from '@/lib/modules';
import {
  PLAN_ASSIGNEES,
  PLAN_PRIORITIES,
  PLAN_PRIORITY_LABEL,
  PLAN_SIZES,
  PLAN_STATUSES,
  isClosed,
  isDismissed,
  type PlanAssignee,
  type PlanPriority,
  type PlanSize,
  type PlanStatus,
} from '@/lib/plan/load';
import {
  PLAN_HEALTHS,
  PLAN_VIEW_CHIPS,
  PLAN_VIEW_LABEL,
  PLAN_VIEW_MENU,
  countMatches,
  flatten,
  healthOf as planHealthOf,
  moveOf as planMoveOf,
  planLiveness,
  searchNodes,
  searchSections,
  searchTerms,
  type MoveContext,
  type PlanBand,
  type PlanHealth,
  type PlanLiveness,
  type PlanMove,
  type PlanNode,
  type PlanProgress,
  type PlanSection,
  type PlanSummary,
  type PlanTally,
  type PlanView as View,
} from '@/lib/plan/tree';
import { PLAN_HEALTH_GLYPHS, type StatusGlyph as GlyphName } from '@/lib/status-glyphs';
import { reshapeOrigin } from '@/lib/plan/origin';
import type { PlanRefTitles } from '@/lib/comments/refs';
import { quietSendAsk } from '@/lib/plan/liveness';
import {
  isResolvingAnswers,
  withReadings,
  type LastRun,
  type StoredRunReading,
} from '@/lib/plan/run-end';
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
import { catalogLabel, subtreeOf, type PlanCatalogEntry } from './plan-catalog';
import { cn } from '@/lib/cn';

/**
 * A step as the pickers know it: enough to name it and to place it.
 *
 * And enough to say when it closed, which the account of a run needs: the
 * tree a row is drawn from is narrowed by the view, so the step a run closed
 * is often not in it, while the catalog is every step in the plan.
 */

const STATUS_LABEL: Record<PlanStatus, string> = {
  proposed: 'Proposed',
  not_started: 'Not started',
  in_progress: 'In progress',
  blocked: 'Blocked',
  done: 'Done',
  dropped: 'Dropped',
};

const SIZE_LABEL: Record<PlanSize, string> = { s: 'Small', m: 'Medium', l: 'Large' };
const ASSIGNEE_LABEL: Record<PlanAssignee, string> = { me: 'Me' };

const MODULE_LABEL: Record<ModuleId, string> = Object.fromEntries(
  MODULES.map((module) => [module.id, module.label]),
) as Record<ModuleId, string>;

function scopeLabel(module: ModuleId | null): string {
  return module ? MODULE_LABEL[module] : 'The app as a whole';
}

function StatusOptions() {
  return (
    <>
      {PLAN_STATUSES.map((status) => (
        <option key={status} value={status}>
          {STATUS_LABEL[status]}
        </option>
      ))}
    </>
  );
}

/**
 * The four properties, as chips rather than as labelled selects.
 *
 * Each carries a glyph saying which property it is and its own current value,
 * which is the whole reason the labels above them could go: "Normal" beside a
 * flag is not ambiguous, and the caption reading "Priority" was costing a line
 * of vertical space to repeat something the value already said. Three labelled
 * full-width selects are three rows; three chips are part of one.
 */
function PrioritySelect({ defaultValue, id }: { defaultValue: PlanPriority; id?: string }) {
  return (
    <ChipSelect
      id={id}
      name="priority"
      defaultValue={String(defaultValue)}
      aria-label="Priority"
      icon={<Flag className="size-3.5" strokeWidth={2} />}
    >
      {PLAN_PRIORITIES.map((priority) => (
        <option key={priority} value={priority}>
          {PLAN_PRIORITY_LABEL[priority]}
        </option>
      ))}
    </ChipSelect>
  );
}

function SizeSelect({ defaultValue, id }: { defaultValue: PlanSize | null; id?: string }) {
  return (
    <ChipSelect
      id={id}
      name="size"
      defaultValue={defaultValue ?? ''}
      placeholderValue=""
      aria-label="Size"
      icon={<Scale className="size-3.5" strokeWidth={2} />}
    >
      <option value="">Size</option>
      {PLAN_SIZES.map((size) => (
        <option key={size} value={size}>
          {SIZE_LABEL[size]}
        </option>
      ))}
    </ChipSelect>
  );
}

function AssigneeSelect({ defaultValue, id }: { defaultValue: PlanAssignee | null; id?: string }) {
  return (
    <ChipSelect
      id={id}
      name="assignee"
      defaultValue={defaultValue ?? ''}
      placeholderValue=""
      aria-label="Who is on it"
      icon={<CircleUser className="size-3.5" strokeWidth={2} />}
    >
      <option value="">Nobody</option>
      {PLAN_ASSIGNEES.map((assignee) => (
        <option key={assignee} value={assignee}>
          {ASSIGNEE_LABEL[assignee]}
        </option>
      ))}
    </ChipSelect>
  );
}

function StatusChip({ defaultValue }: { defaultValue: PlanStatus }) {
  return (
    <ChipSelect
      name="status"
      defaultValue={defaultValue}
      aria-label="Status"
      icon={<Circle className="size-3.5" strokeWidth={2} />}
    >
      <StatusOptions />
    </ChipSelect>
  );
}

/**
 * How far through, as a bar and as the numbers behind it.
 *
 * The numbers are there because a bar alone is a shape rather than a fact:
 * "8 of 12" survives being read at a glance in a way that four fifths of a
 * rectangle does not.
 *
 * The bar is banded rather than a single green length. All green said one
 * thing -- the done fraction -- and left everything not done as blank track,
 * so a module held up by four unanswered questions and a module nobody has
 * got to yet drew the same picture. Each state now owns its share of the
 * length in the tone the health column beneath it already gives it: underway
 * in the app's blue, questions and blocks in the caution amber, not reached
 * in ghost ink. The tally beside it was already saying this in numbers; the
 * bar was the one thing on the row still claiming the module was simply
 * eight twelfths of the way there.
 */
function Progress({
  label,
  progress,
  bands,
}: {
  label: string;
  progress: PlanProgress;
  bands: readonly PlanBand[];
}) {
  if (progress.fraction === null) return null;

  return (
    <span className="flex items-center gap-2">
      {/* `sunken`, not `canvas`. The track is what the bands are drawn on --
          but `--c-page` is defined as `var(--c-canvas)`, so a canvas track on
          a page is the page colour and there is no track at all. It shows
          through wherever a state is missing entirely, which on a module with
          no ready steps and no blocks is most of the bar's own rounding.
          Same reason the avatar tiles are sunken. */}
      <Bands
        bands={bands.map((band) => ({
          key: band.health,
          value: band.count,
          fill: TONE_DOT[HEALTH[band.health].tone],
          label: `${band.count} ${HEALTH[band.health].word.toLowerCase()}`,
        }))}
        track="sunken"
        className="w-24"
        label={label}
      />
      <span className="tabular text-small text-ink-muted">
        {progress.done} of {progress.live}
        {progress.inProgress > 0 && ` · ${progress.inProgress} underway`}
      </span>
    </span>
  );
}

/** Where a view lives. "Open" is the page itself, so it keeps the bare link. */
function viewHref(view: View): string {
  return view === 'open' ? '/dev/plan' : `/dev/plan?view=${view}`;
}

const chipClass = 'press rounded-full px-2.5 py-1 text-small font-medium transition-colors';
const chipOn = 'bg-accent text-surface';
const chipOff = 'text-ink-muted hover:bg-accent-tint hover:text-accent';

/**
 * What a narrowed view says when it finds nothing.
 *
 * Empty is the good state for most of these, so each one says what it means
 * and what would put something in it -- law 1: an empty section gets a real
 * empty state rather than a blank. `open` and `all` are not here on purpose:
 * an empty plan is a different thing entirely and the page says so elsewhere,
 * and an empty module under Open is the invitation to plan it.
 */
const EMPTY_VIEW: Partial<Record<View, { title: string; description: string }>> = {
  ready: {
    title: 'Nothing ready right now',
    description:
      'Every open step is underway, blocked, or waiting on another. Finish one and the next becomes ready.',
  },
  dismissed: {
    title: 'Nothing put aside',
    description:
      'A question you do not want to settle yet, or a patch of fog you do not want raised, is put aside from the row it sits on. It waits here until you bring it back.',
  },
  blocked: {
    title: 'Nothing waiting right now',
    description: 'Nothing is blocked and nothing waits on another step.',
  },
  proposed: {
    title: 'Nothing proposed right now',
    description:
      'Shape an idea from the ideas page and its proposal will appear here for you to approve.',
  },
  claude: {
    title: "Nothing of Dash's right now",
    description:
      'A step appears here once you approve it and leave it unmarked as yours, with nothing blocking it. You can also send one straight to the routine.',
  },
  you: {
    title: 'Nothing waiting on you',
    description:
      'Every question has been answered, every proposal decided on, and nothing is blocked. The plan can move without you.',
  },
};

/**
 * The numbers across the plan, and the views over it.
 *
 * The counts are links where a view answers them: "3 ready" is the question
 * "which three", and the view is the answer. The views are search parameters
 * rather than state so that "the ready steps" is something you can keep.
 */
function SummaryStrip({
  summary,
  view,
}: {
  summary: PlanSummary;
  view: View;
}) {
  const facts: Array<{ view: View | null; value: number; noun: string }> = [
    { view: 'open', value: summary.open, noun: 'open' },
    // Second, because it is the one number on this line that is a request.
    { view: 'you', value: summary.onYou, noun: 'on you' },
    { view: 'ready', value: summary.ready, noun: 'ready' },
    { view: 'proposed', value: summary.proposed, noun: 'proposed' },
    { view: 'blocked', value: summary.waiting, noun: 'waiting' },
    { view: 'fog', value: summary.fog, noun: 'not specified' },
    // Only once there is something in it. A permanent "0 dismissed" would be
    // a count of a thing that has never happened.
    ...(summary.dismissed > 0
      ? [{ view: 'dismissed' as const, value: summary.dismissed, noun: 'dismissed' }]
      : []),
    { view: null, value: summary.inProgress, noun: 'underway' },
    { view: 'claude', value: summary.claude, noun: "Dash's" },
    { view: null, value: summary.done, noun: 'done' },
  ];

  return (
    <div className={cn(cardVariants({ padding: 'dense' }), 'flex flex-wrap items-center gap-x-4 gap-y-2')}>
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-ui text-ink-muted">
        {facts.map((fact) =>
          fact.view ? (
            <Link
              key={fact.noun}
              href={`/dev/plan?view=${fact.view}`}
              className="hover:text-accent hover:underline"
            >
              <span className="tabular font-semibold text-ink">{fact.value}</span> {fact.noun}
            </Link>
          ) : (
            <span key={fact.noun}>
              <span className="tabular font-semibold text-ink">{fact.value}</span> {fact.noun}
            </span>
          ),
        )}
      </p>
      <nav aria-label="View" className="ml-auto flex flex-wrap items-center gap-1">
        {PLAN_VIEW_CHIPS.map((candidate) => (
          <Link
            key={candidate}
            href={viewHref(candidate)}
            aria-current={candidate === view ? 'page' : undefined}
            className={cn(chipClass, candidate === view ? chipOn : chipOff)}
          >
            {PLAN_VIEW_LABEL[candidate]}
          </Link>
        ))}
        {/* The other four. Nothing is lost by moving a view off the row -- it
            is a link in here, and most of them are a link on the counts to the
            left as well -- and the trigger says which one you are on when it is
            one of these, so the row still answers "where am I". */}
        <ActionMenu
          label="More views"
          align="end"
          trigger={
            <span className="inline-flex items-center gap-1">
              {PLAN_VIEW_MENU.includes(view) ? PLAN_VIEW_LABEL[view] : 'More'}
              <ChevronDown className="size-3.5" strokeWidth={2} aria-hidden />
            </span>
          }
          triggerClassName={cn(
            chipClass,
            'gap-1',
            PLAN_VIEW_MENU.includes(view) ? chipOn : chipOff,
          )}
          items={PLAN_VIEW_MENU.map((candidate) => ({
            id: candidate,
            label: PLAN_VIEW_LABEL[candidate],
            href: viewHref(candidate),
            current: candidate === view,
          }))}
        />
      </nav>
    </div>
  );
}

/**
 * Closes a form once its action has landed.
 *
 * Compared by identity rather than by the text of the message, so two
 * consecutive saves are distinguishable. In an effect rather than during
 * render, because what closes is usually the parent's state -- "stop editing",
 * "stop adding" -- and a child may not set its parent's state while rendering.
 */
function useSettled(state: PlanActionState, onSettle: () => void) {
  const seen = useRef<PlanActionState | null>(null);
  useEffect(() => {
    if (state.message && state !== seen.current) {
      seen.current = state;
      onSettle();
    }
  }, [state, onSettle]);
}

/** The steps in the catalog beneath one, itself included: what it cannot move under or wait on. */


/**
 * The fields every step has, for the add and the edit form alike.
 *
 * This is a compose surface, not a form, and the difference is the whole
 * point of laws 11 and 12. There is one thing to type into and it is already
 * focused; the properties are chips carrying their own values; and there is no
 * label, no bordered field and no second box anywhere in it. What it replaced
 * was six captioned full-width controls stacked down a card, which is what a
 * create surface turns into when every property is given a row of its own and
 * a caption repeating what its value already says.
 *
 * `fold` keeps the elaboration out of the way until it is wanted. Adding a
 * step is overwhelmingly a one-line act -- a title and the defaults -- so the
 * add surface opens as a title and a chip row. Editing shows everything,
 * because you opened it to change something and which thing is not knowable.
 */
function StepFields({
  prefix,
  node,
  fold = false,
  status,
}: {
  prefix: string;
  node?: Pick<PlanNode, 'title' | 'detail' | 'acceptance' | 'priority' | 'size' | 'assignee'>;
  fold?: boolean;
  /** Rendered into the chip row when the surface owns the status too. */
  status?: PlanStatus;
}) {
  const [showMore, setShowMore] = useState(!fold);
  const hasDetail = Boolean(node?.detail || node?.acceptance);

  return (
    <div className="space-y-2">
      <ComposeTitle
        id={`${prefix}-title`}
        name="title"
        defaultValue={node?.title ?? ''}
        autoFocus
        aria-label="The step"
        placeholder="What has to happen"
      />

      {showMore || hasDetail ? (
        <>
          <ComposeBody
            id={`${prefix}-detail`}
            name="detail"
            rows={1}
            defaultValue={node?.detail ?? ''}
            aria-label="What it involves"
            placeholder="What it involves…"
          />
          {/* The acceptance line earns its caption: it is the one field whose
            * placeholder cannot say what it is without saying what it is for. */}
          <div className="border-t border-border pt-2">
            <ComposeBody
              id={`${prefix}-acceptance`}
              name="acceptance"
              rows={1}
              defaultValue={node?.acceptance ?? ''}
              aria-label="Done when"
              placeholder="Done when… — what the work is checked against"
            />
          </div>
        </>
      ) : (
        <button
          type="button"
          onClick={() => setShowMore(true)}
          className="press -ml-1.5 inline-flex items-center gap-1 rounded-control px-1.5 py-0.5 text-ui text-ink-ghost hover:bg-sunken hover:text-ink-muted"
        >
          <span aria-hidden>+</span>
          Detail and acceptance
        </button>
      )}

      <div className="flex flex-wrap items-center gap-1">
        {status !== undefined && <StatusChip defaultValue={status} />}
        <PrioritySelect id={`${prefix}-priority`} defaultValue={node?.priority ?? 2} />
        <SizeSelect id={`${prefix}-size`} defaultValue={node?.size ?? null} />
        <AssigneeSelect id={`${prefix}-assignee`} defaultValue={node?.assignee ?? null} />
      </div>
    </div>
  );
}

/**
 * A step of your own: at the top of a module, or under another step.
 *
 * One form for both, told apart by the parent it carries. It opens closed,
 * because a plan with six modules and a full form under each would be mostly
 * form.
 */
function AddStep({
  module,
  parentId,
  open: openAtStart = false,
  onDone,
}: {
  module: ModuleId | null;
  parentId: string | null;
  open?: boolean;
  onDone?: () => void;
}) {
  const [open, setOpen] = useState(openAtStart);
  const [state, action, pending] = useActionState(addPlanItem, {} as PlanActionState);

  useSettled(state, () => {
    setOpen(false);
    onDone?.();
  });

  const prefix = `new-${parentId ?? module ?? 'app'}`;

  if (!open) {
    // This was a hand-rolled version of AddTrigger, written before there was
    // one. Same behaviour, one copy.
    return (
      <AddTrigger
        label={parentId ? 'Add a sub-step' : 'Add a step'}
        onClick={() => setOpen(true)}
      />
    );
  }

  return (
    <form
      action={action}
      className={cn(cardVariants({ padding: 'dense' }), 'flex flex-col gap-(--field-gap)')}
    >
      <input type="hidden" name="module" value={module ?? ''} />
      <input type="hidden" name="parent" value={parentId ?? ''} />
      <StepFields prefix={prefix} fold status="not_started" />
      {/* Actions right, on their own line under a rule: the chip row above is
        * things you set and this is the one thing you press, and running them
        * together made the submit read as a fourth property. */}
      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border pt-2">
        <FieldError>{state.error}</FieldError>
        <div className="ml-auto flex items-center gap-1">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => {
              setOpen(false);
              onDone?.();
            }}
          >
            Cancel
          </Button>
          <Button type="submit" size="sm" pending={pending}>
            {pending ? 'Adding…' : parentId ? 'Add sub-step' : 'Add step'}
          </Button>
        </div>
      </div>
    </form>
  );
}

/** The whole step at once, including where it sits. */
function EditStep({
  node,
  catalog,
  onDone,
}: {
  node: PlanNode;
  catalog: readonly PlanCatalogEntry[];
  onDone: () => void;
}) {
  const [state, action, pending] = useActionState(updatePlanItem, {} as PlanActionState);
  useSettled(state, onDone);

  const excluded = subtreeOf(catalog, node.id);
  const parents = catalog.filter((entry) => entry.module === node.module && !excluded.has(entry.id));
  const prefix = `edit-${node.id}`;

  return (
    <form action={action} className="flex flex-col gap-(--field-gap) px-3 pb-3">
      <input type="hidden" name="id" value={node.id} />
      <StepFields prefix={prefix} node={node} status={node.status} />
      {/* Not part of StepFields, because a step being added has nothing to be
        * foggy about yet: fog is what you find once a feature is real and one
        * half of it will not resolve into steps. */}
      <div>
        <Label htmlFor={`${prefix}-fog`}>Not yet specified</Label>
        {/* ui-ok: composer-always-open -- EditStep only renders when a step is
          * being edited, and the gate is at the call site rather than above
          * this line, so the rule cannot see it. Law 14 is obeyed. */}
        <Textarea
          id={`${prefix}-fog`}
          name="fog"
          rows={2}
          className="min-h-12"
          defaultValue={node.fog ?? ''}
          placeholder="The part nobody can see far enough into to write steps for yet."
        />
        <FieldHint>
          Said plainly here rather than filled with plausible steps. Clear it once the steps
          beneath say it.
        </FieldHint>
      </div>
      <div>
        <Label htmlFor={`${prefix}-comment`}>Your note</Label>
        {/* ui-ok: composer-always-open -- same edit form as the field above. */}
        <Textarea
          id={`${prefix}-comment`}
          name="comment"
          rows={2}
          className="min-h-12"
          defaultValue={node.comment ?? ''}
          placeholder="What it is waiting on, what changed, why it stalled."
        />
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <div>
          <Label htmlFor={`${prefix}-parent`}>Part of</Label>
          <Select id={`${prefix}-parent`} name="parent" defaultValue={node.parentId ?? ''}>
            <option value="">Top of {scopeLabel(node.module)}</option>
            {parents.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {catalogLabel(entry)}
              </option>
            ))}
          </Select>
          <FieldHint>Moving it puts it last under its new parent.</FieldHint>
        </div>
        <div>
          <Label htmlFor={`${prefix}-commit`}>Commit</Label>
          <Input
            id={`${prefix}-commit`}
            name="commit"
            defaultValue={node.commitSha ?? ''}
            placeholder="The one that shipped it"
            className="font-mono"
          />
        </div>
      </div>
      {/* Status moved up into the chip row with the other three properties;
        * it was the only one still spelled as a labelled select down here. */}
      <div className="flex flex-wrap items-center gap-2 border-t border-border pt-2">
        <FieldError>{state.error}</FieldError>
        <div className="ml-auto flex items-center gap-1">
          <Button type="button" size="sm" variant="ghost" onClick={onDone}>
            Cancel
          </Button>
          <Button type="submit" size="sm" pending={pending}>
            {pending ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </div>
    </form>
  );
}

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
        <p className="whitespace-pre-wrap text-ui text-ink">
          {node.detail?.trim() || node.title}
        </p>
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
 * Raise a question against a step, from the step.
 *
 * One field, because a question is one sentence. It becomes a decision beneath
 * the step -- the same row kind the shaping sessions write -- so a question
 * asked here and a question proposed by a session are the same object, answered
 * the same way and carried into the same briefs. The options, if there turn out
 * to be options worth writing down, go in through Edit like any other detail.
 */
function AskQuestion({ node, onDone }: { node: PlanNode; onDone: () => void }) {
  const [state, action, pending] = useActionState(addPlanItem, {} as PlanActionState);
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
function QuestionRow({ node, titles }: { node: PlanNode; titles?: PlanRefTitles }) {
  const [answerState, answerAction, answerPending] = useActionState(
    answerPlanDecision,
    {} as PlanActionState,
  );
  const [dropState, dropAction, dropPending] = useActionState(
    setPlanItemStatus,
    {} as PlanActionState,
  );
  const [dismissState, dismissAction, dismissPending] = useActionState(
    dismissPlanDecision,
    {} as PlanActionState,
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
          {settled && node.status !== 'dropped' ? <Check className="size-3.5" strokeWidth={2} /> : '?'}
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
              target="step"
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
function Questions({ node, titles }: { node: PlanNode; titles?: PlanRefTitles }) {
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
            <QuestionRow key={question.id} node={question} titles={titles} />
          ))}
        </ul>
      )}

      {asking ? (
        <AskQuestion node={node} onDone={() => setAsking(false)} />
      ) : (
        !isClosed(node.status) && (
          <button
            type="button"
            onClick={() => setAsking(true)}
            className="press -ml-1.5 inline-flex items-center gap-1 rounded-control px-1.5 py-0.5 text-ui text-ink-ghost hover:bg-sunken hover:text-ink-muted"
          >
            <span aria-hidden>+</span>
            {questions.length === 0 ? 'Ask a question' : 'Ask another'}
          </button>
        )
      )}
    </div>
  );
}

function Dependencies({
  node,
  catalog,
}: {
  node: PlanNode;
  catalog: readonly PlanCatalogEntry[];
}) {
  const [addState, addAction, addPending] = useActionState(addPlanDependency, {} as PlanActionState);
  const [removeState, removeAction, removePending] = useActionState(
    removePlanDependency,
    {} as PlanActionState,
  );

  const own = new Set(node.dependsOn.map((link) => link.item.id));
  const inherited = node.waitingOn.filter((ref) => !own.has(ref.id));
  const excluded = subtreeOf(catalog, node.id);
  const candidates = catalog.filter(
    (entry) => !excluded.has(entry.id) && !own.has(entry.id) && !entry.closed,
  );
  const byModule = new Map<string, PlanCatalogEntry[]>();
  for (const entry of candidates) {
    const key = scopeLabel(entry.module);
    byModule.set(key, [...(byModule.get(key) ?? []), entry]);
  }

  return (
    <div className="space-y-2">
      {(node.dependsOn.length > 0 || inherited.length > 0) && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-small text-ink-muted">Waits on</span>
          {node.dependsOn.map((link) => (
            <form key={link.dependencyId} action={removeAction} className="contents">
              <input type="hidden" name="id" value={link.dependencyId} />
              <span
                className={cn(
                  'inline-flex items-center gap-1 rounded-full py-0.5 pl-2 pr-1 text-small',
                  isClosed(link.item.status)
                    ? 'bg-positive-tint text-positive'
                    : 'bg-caution-tint text-caution',
                )}
              >
                #{link.item.number} {link.item.title}
                {isClosed(link.item.status) && ` (${STATUS_LABEL[link.item.status].toLowerCase()})`}
                <button
                  type="submit"
                  disabled={removePending}
                  aria-label={`Stop waiting on #${link.item.number}`}
                  className="press rounded-full p-0.5 hover:bg-surface/60"
                >
                  <X className="size-3" strokeWidth={2} aria-hidden />
                </button>
              </span>
            </form>
          ))}
          {inherited.map((ref) => (
            <span
              key={ref.id}
              title="Through a step above this one"
              className="inline-flex items-center rounded-full bg-caution-tint px-2 py-0.5 text-small text-caution opacity-80"
            >
              #{ref.number} {ref.title} · above
            </span>
          ))}
        </div>
      )}

      {node.blocks.length > 0 && (
        <p className="text-small text-ink-muted">
          Unblocks {node.blocks.map((ref) => `#${ref.number} ${ref.title}`).join(', ')}
        </p>
      )}

      {candidates.length > 0 && (
        <form action={addAction} className="flex flex-wrap items-center gap-2">
          <input type="hidden" name="item" value={node.id} />
          {/* Width only. This carried `h-8 py-0 text-small`, which overrode
              three things the primitive is for: the dial's height, so it was
              32px on a phone where every control beside it is 36; and
              `text-base sm:text-ui`, which is the 16px that stops iOS zooming
              the whole page when the select is tapped. Twelve-pixel type on a
              native picker bought nothing and cost that. */}
          <Select
            name="depends_on"
            defaultValue=""
            className="w-auto max-w-xs"
            aria-label="A step this one has to wait for"
          >
            <option value="">Wait on a step…</option>
            {[...byModule.entries()].map(([label, entries]) => (
              <optgroup key={label} label={label}>
                {entries.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {catalogLabel(entry)}
                  </option>
                ))}
              </optgroup>
            ))}
          </Select>
          <Button type="submit" variant="ghost" pending={addPending}>
            {addPending ? 'Adding…' : 'Add'}
          </Button>
          <FieldError>{addState.error ?? removeState.error}</FieldError>
        </form>
      )}
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


/**
 * What the health column says about a step.
 *
 * The stored status is what you set; health is what it means right now. A
 * step not yet started is either ready, waiting on something, or simply not
 * reached -- three different answers the one word "not started" was hiding.
 * The other statuses say what they are. Done and dropped are the quiet ones:
 * finished work is consulted, not read.
 */
type Health = {
  word: string;
  /**
   * The six the dev pages share. `info` is the app's blue and deliberately not
   * `accent`: the accent is whichever hue the workspace you are standing in
   * owns, so an accent-toned state is a different colour on every page and
   * slate on this one.
   */
  tone: DevTone;
  title?: string;
};

/**
 * How each state is worded.
 *
 * Which state a step is in is decided in lib/plan/tree.ts, so the counts
 * beside a module heading and the health column under it cannot disagree.
 * Which shape it draws is in lib/status-glyphs.ts, beside the pipeline's and
 * the todo list's, so a state here looks like the same state there. What is
 * left is the word, the tone and the fixed part of the tooltip.
 *
 * Seven of the fourteen are states the other dev queues have too, and those
 * words come from lib/dev/words.ts so a dropped step and a declined note read
 * alike. The other seven are the plan's own refinements -- a question, a
 * question answered, a proposal, a step waiting on another step, a step nobody
 * has reached, a claim whose run stopped, and a setup job that is yours to do
 * -- and no other queue has anything for them to disagree with. Why there are
 * fourteen rather than fewer is written where the set is, in
 * lib/plan/tree.ts.
 */
const HEALTH: Record<PlanHealth, Health> = {
  unanswered: {
    word: 'Unanswered',
    tone: 'caution',
    title: 'A question waiting on you. It closes on an answer, not a commit.',
  },
  answered: { word: 'Answered', tone: 'positive' },
  proposed: {
    word: 'Proposed',
    tone: 'accent',
    title: 'Written by a session. Approve it, edit it, or drop it -- nothing happens until you do.',
  },
  in_progress: { word: DEV_STATE_WORD.working, tone: 'accent' },
  // The three readings of a claim. `in_progress` above is the fourth and says
  // the least: the row is claimed and nothing has looked into what the session
  // is doing.
  working: {
    word: DEV_STATE_WORD.working,
    tone: 'accent',
    title: 'A session has this and has pushed something recently.',
  },
  quiet: {
    word: 'Quiet',
    tone: 'caution',
    title:
      'A session has this and has pushed nothing for a while. It may still be reading or waiting on a build.',
  },
  abandoned: {
    word: 'Stopped',
    tone: 'caution',
    title:
      'A session claimed this and stopped without closing it. Put it back or send it again -- nothing is working it.',
  },
  // "Waiting on you" rather than "Blocked", which said a step was stuck and not
  // who could unstick it. The notes queue says the same thing about a note
  // blocked on an answer, and now says it in the same words.
  blocked: {
    word: DEV_STATE_WORD.waiting,
    tone: 'caution',
    title: 'Stopped on something only you can settle. The note says what.',
  },
  // A job that was yours from the day it was written -- an account, a key, a
  // switch. "Waiting on you" is what a blocked step says, and it says it about
  // a build that ran into a wall; this one never was a build.
  setup: {
    word: 'Setup',
    tone: 'caution',
    title: 'Something only you can set up. Open it for what to do, and say so when you have.',
  },
  // A step waiting on another step, which clears itself. Nothing else to say
  // "on you" about, and the plan is the only queue that has it.
  waiting: { word: 'Waiting', tone: 'caution' },
  // Blue, not green. Ready and done were both `positive`, so the one state
  // that is an invitation to start read at a glance as the state that needs
  // nothing.
  //
  // `info` and not `accent`, which is what it used to be and which was not
  // blue anywhere it was read: the accent is the workspace's hue, and this
  // page lives in the dev workspace, whose hue is slate. "Blue" was written
  // in this comment and rendered as grey on the only page that shows it.
  // `info` is the app's own blue, themed in all five palettes, and it does
  // not move when the workspace does.
  ready: { word: DEV_STATE_WORD.ready, tone: 'info' },
  not_started: { word: 'Not started', tone: 'quiet' },
  done: { word: DEV_STATE_WORD.done, tone: 'positive' },
  dropped: { word: DEV_STATE_WORD.dropped, tone: 'ghost' },
};

function healthOf(
  node: PlanNode,
  liveness?: PlanLiveness,
): Health & { glyph: GlyphName; name: PlanHealth } {
  const health = planHealthOf(node, liveness);
  const base = { ...HEALTH[health], glyph: PLAN_HEALTH_GLYPHS[health], name: health };

  // A row closed over open work reports what is open beneath it, so the word
  // is about a step further down and the fixed tooltip would be describing the
  // wrong row. Naming the rows is the whole answer to "why does this say that".
  if (isClosed(node.status) && health !== 'done' && health !== 'dropped' && health !== 'answered') {
    const open = flatten(node.children).filter((child) => !isClosed(child.status));
    return {
      ...base,
      title: `Closed, but still open beneath it: ${open
        .slice(0, 3)
        .map((child) => `#${child.number} ${child.title}`)
        .join(', ')}${open.length > 3 ? `, and ${open.length - 3} more` : ''}`,
    };
  }

  // The three tooltips that can only be written with the step in hand.
  if (health === 'answered') return { ...base, title: node.resolution ?? undefined };
  if (health === 'blocked') return { ...base, title: node.blockAsk ?? node.comment ?? undefined };
  if (health === 'waiting') {
    return {
      ...base,
      title: `Waits on ${node.waitingOn.map((ref) => `#${ref.number} ${ref.title}`).join(', ')}`,
    };
  }
  return base;
}

/**
 * The Status column, worded and toned.
 *
 * "Needs you" takes caution, which is the tone every dev queue already spends
 * on a row stopped on the person. "With Dash" takes the accent because a
 * session running right now is the one thing on this page that is changing
 * while you look at it. The rest are ink: nothing is claimed about a step you
 * kept or one another step is holding up, and a step waiting its turn has no
 * word to tone.
 *
 * The tooltip is where the rollup is explained. A feature reporting "With Dash"
 * because its third step is with a session would otherwise be a word with no
 * visible cause, which is the complaint the whole column exists to answer.
 */
const MOVE_TONE: Record<PlanMove, Health['tone']> = {
  // The accent, the same as "With Dash": both are a session working on this
  // right now, and the difference between them is which job, not whose turn.
  resolving: 'accent',
  on_you: 'caution',
  with_dash: 'accent',
  waiting: 'quiet',
  yours: 'quiet',
  none: 'ghost',
  settled: 'ghost',
};

const MOVE_TITLE: Record<PlanMove, string> = {
  resolving:
    'Re-reading this feature against the answers you just gave. What it proposes will be here when it is done; sending it anywhere until then would send a plan that is mid-edit.',
  on_you: 'Stopped on you: a question to answer, a proposal to approve, or something only you can supply.',
  with_dash: 'A session is working on this now.',
  waiting: 'Held up by another step that has not closed.',
  yours: 'You kept this one, so the runner will not take it.',
  none: 'Approved and waiting its turn. Nothing is on it and nothing is needed from you.',
  settled: 'Nothing left to do on this one.',
};

function moveFor(
  node: PlanNode,
  context?: MoveContext,
): { word: string; tone: Health['tone']; title?: string } {
  const move = planMoveOf(node, context);
  const own = ownMoveWord(node, context);
  return {
    word: PLAN_MOVE_WORD[move],
    tone: MOVE_TONE[move],
    // Said only where it is not obvious from the row itself: a leaf reporting
    // its own move needs no explanation of where the word came from.
    title: own === move ? MOVE_TITLE[move] : `${MOVE_TITLE[move]} (from a step beneath this one.)`,
  };
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
 * A module's steps, counted by state, beside its heading.
 *
 * The progress bar next to this answers "how far through", which is one
 * number and hides the shape of what is left: eleven not-started steps and
 * eleven unanswered questions are the same bar and are not the same module.
 * A count per state says which, without the section being opened -- and it
 * survives the fold, which is the point (law 10).
 *
 * Each count is marked with the state's hexagon rather than a round dot, so
 * "four blocked, two ready" is readable without telling the tones apart. Same
 * shape as the health column under it and the same size, because the two are
 * on screen together and a state that changed shape between them would read
 * as two states.
 *
 * Only states that are actually present are counted. A row of zeroes is noise,
 * and a "0 blocked" is a fact nobody needed (law 1). The count is the label:
 * the word is on the tooltip and in the accessible name, because eight
 * spelled-out states would be a paragraph where a glance was asked for.
 *
 * Answered is left out. Every other dot is either work outstanding or work
 * that shipped; an answered question is neither -- it is a decision recorded
 * and carried into the briefs beneath it, and it never becomes work again.
 * Counting them said nothing about the shape of what is left in a module,
 * which is the one thing these dots are for, and it was a dot on every
 * heading.
 */
const TALLY_HEALTHS = PLAN_HEALTHS.filter((health) => health !== 'answered');

function SectionTally({ tally, label }: { tally: PlanTally; label: string }) {
  const present = TALLY_HEALTHS.filter((health) => tally[health] > 0);
  if (present.length === 0) return null;

  return (
    <span className="flex items-center gap-2.5" aria-label={`${label} by state`}>
      {present.map((health) => (
        <span
          key={health}
          className="flex items-center gap-1"
          title={`${tally[health]} ${HEALTH[health].word.toLowerCase()}`}
        >
          <StatusGlyph
            glyph={PLAN_HEALTH_GLYPHS[health]}
            className={TONE_TEXT[HEALTH[health].tone]}
          />
          <span className="tabular text-small text-ink-muted">{tally[health]}</span>
          <span className="sr-only">{HEALTH[health].word}</span>
        </span>
      ))}
    </span>
  );
}

const TONE_DOT: Record<Health['tone'], string> = {
  quiet: 'bg-ink-ghost',
  ghost: 'bg-ink-ghost',
  accent: 'bg-accent',
  info: 'bg-status-submitted',
  positive: 'bg-positive',
  caution: 'bg-caution',
};

/**
 * The columns every row shares.
 *
 * One template, used by the header and by every row at every depth, is what
 * makes the page scan: the health of a sub-sub-step sits under the health of
 * the feature above it, because the indent lives inside the name cell rather
 * than around the row. On a phone the three middle columns go and the name,
 * the health and the menu stay.
 */
// The last column holds the row's quick actions as well as its menu, so it is
// wide enough for them from sm up -- reserved rather than grown on hover,
// because a column that widens under the pointer moves every row beside it.
// Status sits directly after Health, because the two are read together -- "how
// far along, and who has it" is one question asked twice -- and a column
// between them would make that a comparison across the row.
const ROW_GRID =
  'grid grid-cols-[minmax(0,1fr)_7.25rem_2rem] items-center gap-x-2 ' +
  'sm:grid-cols-[minmax(0,1fr)_7.25rem_6rem_5.5rem_6rem_8rem]';

/** The width of one level of the tree, in the name cell. */
const LEVEL = 'w-5';

function ColumnHeader() {
  return (
    <li
      aria-hidden
      className={cn(
        ROW_GRID,
        'px-3 py-1.5 text-micro font-semibold uppercase tracking-wide text-ink-ghost',
      )}
    >
      <span>Step</span>
      <span>Health</span>
      <span className="hidden sm:block">Status</span>
      <span className="hidden sm:block">Priority</span>
      <span className="hidden sm:block">Steps</span>
      <span />
    </li>
  );
}

/**
 * The lines that draw the tree.
 *
 * One slot per level above this row. An outer slot carries the line down
 * from an ancestor that still has siblings after it; the innermost slot is
 * the elbow into this row, continuing below when a sibling follows. It is
 * what lets a step three deep be read as three deep at a glance, without the
 * indent alone having to say so.
 */
function TreeGuides({ trail }: { trail: readonly boolean[] }) {
  return (
    <>
      {trail.map((continues, level) => {
        const last = level === trail.length - 1;
        return (
          <span key={level} className={cn(LEVEL, 'relative shrink-0 self-stretch')} aria-hidden>
            {(continues || last) && (
              <span
                className={cn(
                  'absolute left-2 top-0 w-px bg-border-strong',
                  continues ? 'bottom-0' : 'h-1/2',
                )}
              />
            )}
            {last && <span className="absolute left-2 top-1/2 h-px w-2.5 bg-border-strong" />}
          </span>
        );
      })}
    </>
  );
}

/**
 * Done, underway, blocked, not started: the leaf steps beneath a feature, as
 * dots. Read from the roll-up rather than from the children on the page, so
 * a narrowed view that has folded the done steps away still counts them.
 */
function Breakdown({ node }: { node: PlanNode }) {
  const { done, inProgress, blocked, live } = node.rollup;
  if (live === 0) return <span className="text-small text-ink-ghost">—</span>;

  const counts: Array<{ status: PlanStatus; tone: Health['tone']; n: number }> = [
    { status: 'done', tone: 'positive', n: done },
    { status: 'in_progress', tone: 'accent', n: inProgress },
    { status: 'blocked', tone: 'caution', n: blocked },
    { status: 'not_started', tone: 'quiet', n: live - done - inProgress - blocked },
  ];
  const shown = counts.filter((c) => c.n > 0);
  const title = shown.map((c) => `${c.n} ${STATUS_LABEL[c.status].toLowerCase()}`).join(', ');

  return (
    <span
      className="tabular flex flex-wrap items-center gap-x-2 gap-y-0.5 text-small text-ink-muted"
      title={`${title} of ${live}`}
      aria-label={`${title} of ${live} steps`}
    >
      {shown.map((c) => (
        <span key={c.status} className="inline-flex items-center gap-1">
          <span className={cn('size-1.5 rounded-full', TONE_DOT[c.tone])} aria-hidden />
          {c.n}
        </span>
      ))}
    </span>
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
function PlanRow({
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
  // A question lives in its step's panel rather than as a row of its own, so
  // the Dismissed view would otherwise be a list of steps to open one at a
  // time. The rows that hold something put aside start open there.
  const [open, setOpen] = useState(
    opened ||
      (view === 'dismissed' &&
        node.children.some((child) => child.kind === 'decision' && isDismissed(child))),
  );
  const [editing, setEditing] = useState(false);
  const [addingChild, setAddingChild] = useState(false);
  const [answering, setAnswering] = useState(false);
  // Send has been pressed on a step whose run went quiet, and the question is
  // on the page waiting to be answered. Held by the row rather than by a
  // button because there are three ways to press Send here -- the quick icon,
  // the button on the opened row and the row menu -- and one question in one
  // place is better than the same question drawn three times.
  const [confirmingSend, setConfirmingSend] = useState(false);
  const substeps = node.children.filter((child) => child.kind !== 'decision');
  const hasChildren = substeps.length > 0;
  // Every feature starts folded.
  //
  // It used to be only the closed ones, on the grounds that finished work is
  // consulted rather than read. But the page opens on a plan of 117 features
  // and several hundred steps, and unfolding all the open ones by default made
  // the first screen a wall with no shape in it -- the modules and the features
  // are the map, and you cannot see a map through its own detail. The arrow on
  // every row is one press, and it was already there.
  //
  // A search is the exception, and the same one as before: the row is only on
  // the page because something inside it matched, and folding that away would
  // be answering the search with a closed drawer.
  //
  // Fog folds too, and that is the whole of what the arrow is for on a row
  // with no steps under it. #386 is fog and nothing else -- a feature real
  // enough to name and not yet real enough to break up -- so gating the arrow
  // on sub-steps alone left its one block of text pinned open with no control
  // anywhere on the row. A leaf still starts unfolded, so scanning the plan
  // shows the fog exactly as it did; what is new is being able to put it away.
  const foldableFog = Boolean(node.fog) && (node.fogDismissedAt === null || view === 'dismissed');
  const [showChildren, setShowChildren] = useState(
    () => searching || unfolded || (!hasChildren && foldableFog),
  );

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
  // The same rope pulled for the whole subtree: one press, every step beneath.
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
  // The same rope pulled the other way: re-read this feature against what has
  // been answered beneath it, and propose what has changed.
  const [reshapeState, reshapeAction, reshapePending] = useActionState(
    reshapePlanFeature,
    {} as PlanActionState,
  );
  const [fogState, fogAction, fogPending] = useActionState(
    dismissPlanFog,
    {} as PlanActionState,
  );

  // A question beneath a step is that step's question, and it is read and
  // answered in the step's own questions section. It is deliberately not also a
  // row in the tree: the same question in two places, one of which can answer
  // it, is how you end up answering neither. A decision at the top of a module
  // is nobody's question but its own and stays a row.
  const questions = node.children.filter((child) => child.kind === 'decision');
  const unanswered = questions.filter((question) => !isClosed(question.status)).length;

  const descendants = flatten([node]).length - 1;
  const closed = isClosed(node.status);
  const isDecision = node.kind === 'decision';
  // A setup job still open. Closed, it is an ordinary finished row -- the
  // errand is run, and a box inviting you to run it again would be a lie.
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
  const accountForRun = run !== undefined && (node.status === 'in_progress' || run.status === 'started');
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
  // The line under the title: what it involves, or failing that your note --
  // minus the stamp, which has its own line above and should not be said
  // twice on one row.
  const gloss =
    (node.detail ?? node.comment ?? '')
      .split('\n')
      .find((line) => line.trim() && !(origin && line.includes(`#${origin.number}'s answer:`))) ??
    '';

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
    {
      id: 'add-child',
      label: 'Add a sub-step',
      onSelect: () => {
        setShowChildren(true);
        setAddingChild(true);
      },
    },
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

  // Everything under the row -- the detail, the edit form, the sub-step form --
  // sits in from the tree by the same amount the title does.
  const inset = { paddingLeft: `${0.75 + trail.length * 1.25 + 1.25}rem` };

  return (
    <>
      {/* The anchor a `#494` written in a comment lands on. `scroll-mt` keeps
          the row clear of the pinned header it would otherwise arrive under. */}
      <li
        id={planRowId(node.number)}
        className={cn(
          ROW_GRID,
          'group scroll-mt-24 px-3',
          gloss && !open ? 'py-1.5' : 'py-2',
          !node.matches && 'opacity-60',
          closed && 'opacity-70',
        )}
      >
        <div className="flex min-w-0 items-stretch">
          <TreeGuides trail={trail} />

          {/* The fold for the sub-steps. A spacer where there are none, so the
              titles at one depth line up. */}
          {hasChildren || foldableFog ? (
            <button
              type="button"
              onClick={() => setShowChildren((value) => !value)}
              aria-expanded={showChildren}
              title={
                hasChildren
                  ? showChildren
                    ? `Fold the ${substeps.length} sub-steps`
                    : `Unfold the ${substeps.length} sub-steps`
                  : showChildren
                    ? 'Fold what is not yet specified'
                    : 'Unfold what is not yet specified'
              }
              aria-label={
                hasChildren
                  ? showChildren
                    ? 'Hide the sub-steps'
                    : 'Show the sub-steps'
                  : showChildren
                    ? 'Hide what is not yet specified'
                    : 'Show what is not yet specified'
              }
              className={cn(
                LEVEL,
                'press flex shrink-0 items-center justify-center self-center rounded text-ink-muted hover:bg-accent-tint hover:text-accent',
                'h-5',
              )}
            >
              <ChevronDown
                className={cn('size-3.5 transition-transform duration-150', !showChildren && '-rotate-90')}
                strokeWidth={1.75}
                aria-hidden
              />
            </button>
          ) : isDecision ? (
            // Where a build step's checkbox would be. A question and a piece
            // of work are different things, and the row should say which it is
            // before the health column is read.
            <span
              title="A decision: a question, closed by an answer rather than a commit."
              className={cn(
                LEVEL,
                'flex h-5 shrink-0 select-none items-center justify-center self-center text-small font-semibold text-caution',
              )}
            >
              ?<span className="sr-only">Decision</span>
            </span>
          ) : setupOpen ? (
            // The same slot, for the other row that is not a piece of work.
            // A setup job is an errand, closed by going and doing it, and the
            // row should say so before the health column is read -- the same
            // argument as the question mark above.
            <span
              title="A setup job: something only you can set up, closed when you have."
              className={cn(
                LEVEL,
                'flex h-5 shrink-0 select-none items-center justify-center self-center text-caution',
              )}
            >
              <Wrench className="size-3.5" strokeWidth={1.75} aria-hidden />
              <span className="sr-only">Setup</span>
            </span>
          ) : (
            <span className={cn(LEVEL, 'shrink-0')} aria-hidden />
          )}

          {/* The title opens the step itself, which the chevron beside it
              never does -- that one is the tree, and only the tree. The two
              were told apart by nothing but position, so this one says what it
              is, and what it opens is a panel rather than another level. */}
          <button
            type="button"
            onClick={() => setOpen((value) => !value)}
            aria-expanded={open}
            title={open ? `Close #${node.number}` : `Open #${node.number}`}
            className="min-w-0 flex-1 self-center text-left hover:text-accent"
          >
            <span
              className={cn(
                'flex min-w-0 items-baseline gap-1.5 text-ui',
                trail.length === 0 ? 'font-medium text-ink' : 'text-ink',
              )}
            >
              {/* Where the row sits, not just what it is called: a feature
                  reads #595 and its second step reads #595.2, so a step says
                  which feature it belongs to and how far through it is
                  without the tree guides having to be traced up by eye.
                  `number` is still the handle -- it is what the commits, the
                  comments and the CLI say, it is the anchor a `#597` link
                  lands on, and the button around this says "Open #597" -- and
                  the search box takes either. */}
              <span className="tabular shrink-0 text-small text-ink-ghost">#{node.outline}</span>
              {/* Truncated closed, whole open. A row is a line and a long title
                * has to give way to keep it one; but opening the step is the
                * gesture that means "show me this one", and a name still cut
                * off after it leaves no way to read it at all. */}
              <span
                className={cn(
                  'min-w-0',
                  open ? 'break-words' : 'truncate',
                  node.status === 'dropped' && 'text-ink-muted line-through',
                )}
              >
                {node.title}
              </span>
              {/* A question waiting on this step, said on the row. The section
                * that answers it is behind the fold, and a question nobody
                * knows is there is the thing this whole section exists to
                * stop. */}
              {unanswered > 0 && !open && (
                <span
                  title={`${unanswered} unanswered ${unanswered === 1 ? 'question' : 'questions'}`}
                  className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-caution-tint px-1.5 text-small font-semibold text-caution"
                >
                  <HelpCircle className="size-3" strokeWidth={2} aria-hidden />
                  {unanswered}
                  <span className="sr-only">
                    unanswered {unanswered === 1 ? 'question' : 'questions'}
                  </span>
                </span>
              )}
              {/* And whether anything has been said about it. */}
              <CommentCount count={node.thread.length} />
              {/* The steps you kept, on the row.
                * The runner takes anything approved that is not yours, so the
                * fact worth reading off a resting row is which steps it will
                * skip. It used to be the other way round: the mark was a robot
                * on every step handed to Dash, from when a session could only
                * work a step somebody had handed it.
                *
                * The row's Mine press carries the same fact in its accented
                * icon, but that icon is drawn only under the pointer and not
                * at all below sm, so this is the only place a plan at rest
                * says it. Steps still holding the old 'claude' value are not
                * read here and nothing clears them.
                *
                * A mark, not a column: it appears on the few steps you held
                * back, which is what makes it worth reading. */}
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
            </span>
            {/* Where it came from, when it did not come from you. On the row
                and not behind the fold, because a step that appeared under a
                feature you approved last week is exactly the one you would
                never think to open. */}
            {origin && (
              <span className="block truncate text-small text-ink-ghost">
                From #{origin.number}&apos;s answer: {origin.gist}
              </span>
            )}
            {gloss && !open && (
              <span className="block truncate text-small text-ink-muted">
                {!node.detail && 'Note: '}
                {gloss}
              </span>
            )}
          </button>
        </div>

        {/* Health is a word you click to change, not a badge you have to open
            the step to change: "where is this" is the question the page exists
            for, and answering it differently should not be a form. */}
        <ActionMenu
          label={`Status of #${node.number} ${node.title}`}
          items={statusMenu}
          align="start"
          className="justify-self-start"
          triggerClassName={cn(
            'h-7 w-auto gap-1.5 px-1.5 text-small font-medium',
            TONE_TEXT[health.tone],
          )}
          trigger={
            <StateLabel
              // Inherits the trigger's own text size and tone, which is what
              // makes the health a word you click rather than a badge inside a
              // button.
              className="text-inherit"
              tone={health.tone}
              title={health.title}
              word={health.word}
              // No glyph on a dropped row. The slash was a third way of
              // saying what the ghost tone and the struck-through title
              // already say, on the one state nobody is scanning for -- so it
              // read as clutter beside the rows that are still live, which is
              // where the eye is actually going (law 15). Every other state
              // keeps its shape: those are the ones being scanned, and the
              // glyph is how they are told apart at a glance. The count
              // beside the module heading keeps its slash too, because there
              // a bare number would say nothing at all.
              glyph={health.name === 'dropped' ? null : health.glyph}
            />
          }
        />

        {/* Whose move it is, beside how far along it is.

            A word and a tone, and deliberately no glyph: the hexagons belong to
            health, they are a scale from empty to full, and a second column of
            shapes beside them would read as a second position on the same scale
            rather than as an answer to a different question. Law 4 -- if none
            of the meanings is true, use ink and a shape, and here the shape is
            the column itself.

            Not a menu, where health is one. Health is set by hand; this is
            derived from what is already true of the row -- who it is assigned
            to, what it waits on, whether it is a question -- so there is
            nothing here to pick. Changing it means handing the step over or
            answering what it asks, which are the buttons already on the row. */}
        <span
          className={cn('hidden truncate text-small sm:block', TONE_TEXT[move.tone])}
          title={move.title}
        >
          {move.word}
        </span>

        {/* Priority, and only when it says something. Nearly every step is at
            Normal, so the word was on almost every row and told you nothing;
            what you are scanning for is the handful marked Next or Someday.
            The separator before the size goes with it, so a normal step at S
            reads as "S" rather than as "· S".

            A word you click, like the health beside it -- note 3bfb2749. At
            Normal there is no word to click, so the trigger is the word
            itself, drawn only while the row is under the pointer or the menu
            is being reached by keyboard: the resting row still says nothing,
            which is the whole reason Normal is silent. */}
        <span className="hidden truncate text-small sm:block">
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
        </span>

        {/* No "Who" column. It was a column of dashes with the occasional
            name in it -- one fact, on a plan whose every approved step the
            runner takes unless you keep it, and keeping it is a button. The
            one value it carried is now a mark beside the title, on the steps
            you kept; the rest is on the open step, in the summary's "Claude's"
            view, and in the menu that changes it. */}
        <span className="hidden sm:block">
          <Breakdown node={node} />
        </span>

        {/* The three things done to a step without reading it first, then the
            menu for everything else. Under the pointer or under focus, so a
            plan at rest is a plan rather than a wall of icons; the same three
            are in the menu, which is how a phone reaches them. */}
        <div className="flex items-center justify-self-end">
          <div className="hidden items-center opacity-0 transition-opacity duration-150 group-focus-within:opacity-100 group-hover:opacity-100 sm:flex">
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
          </div>
          <ActionMenu label={`Actions for #${node.number}`} items={menu} />
        </div>
      </li>

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
      {(assignState.error ??
        sendState.error ??
        batchState.error ??
        reshapeState.error ??
        answerState.error ??
        assignState.message ??
        sendState.message ??
        batchState.message ??
        reshapeState.message ??
        answerState.message) && (
        <li style={inset} className="pb-1.5 pr-3 text-small">
          <FieldError>
            {assignState.error ??
              sendState.error ??
              batchState.error ??
              reshapeState.error ??
              answerState.error}
          </FieldError>
          {!assignState.error &&
            !sendState.error &&
            !batchState.error &&
            !reshapeState.error &&
            !answerState.error && (
            // Ink, not green. The tones above are a status system where
            // positive means done; this is a transient "Assigned" or "Sent"
            // from the action that just ran, which is the system reporting
            // itself and is not a claim about money (law 4).
              <span className="text-ink-muted">
                {assignState.message ??
                  sendState.message ??
                  batchState.message ??
                  reshapeState.message ??
                  answerState.message}
              </span>
            )}
        </li>
      )}

      {/* In the tree rather than behind the fold, because fog on a feature is
          the thing you most want to see while scanning a plan: it is the part
          that is admittedly not a plan yet, and one that only showed on a step
          you thought to open would be a gap nobody found. Quiet and dashed, so
          it does not read as detail. Nothing at all when there is none, which
          is most steps most of the time.

          It does fold with the group, though. Fog belongs to what is beneath
          the row -- it is the part of it that is not a plan yet -- so a
          collapsed feature leaving its fog behind was one block outliving the
          thing it described. Only where there is an arrow to fold: on a leaf
          a leaf used to have no arrow at all, so gating on it alone hid fog on
          every stepless feature with no way back -- which is what happened to
          #386. The arrow above now appears for fog as well as for sub-steps,
          so the fold is a control everywhere it is a state. */}
      {foldableFog && showChildren && (
          <li style={inset} className="pb-1.5 pr-3">
            <div className="border-l-2 border-dashed border-border-strong pl-2.5">
              <p className="text-micro font-semibold uppercase tracking-wide text-ink-ghost">
                Not yet specified
              </p>
              <p className="whitespace-pre-wrap text-small text-ink-muted">{node.fog}</p>
              {/* Putting the patch aside stops it being raised: off the page,
                  out of the Not specified view, out of every turn, and no
                  longer holding the step open when you close it. */}
              <form action={fogAction} className="mt-1">
                <input type="hidden" name="id" value={node.id} />
                <input
                  type="hidden"
                  name="dismissed"
                  value={node.fogDismissedAt === null ? '1' : '0'}
                />
                <Button type="submit" size="sm" variant="ghost" pending={fogPending}>
                  {node.fogDismissedAt === null ? 'Not now' : 'Bring back'}
                </Button>
              </form>
              <FieldError>{fogState.error}</FieldError>
            </div>
          </li>
        )}

      {editing ? (
        <li style={inset} className="pr-3">
          <EditStep node={node} catalog={catalog} onDone={() => setEditing(false)} />
        </li>
      ) : (
        open && (
          // The step itself, as a panel with an edge of its own. It was loose
          // rows at the next indent, which made opening a step look like
          // unfolding one more level of the tree -- the same gesture and the
          // same shape for two different meanings.
          <li style={inset} className="pb-3 pr-3">
            <div className="space-y-3 border-l-2 border-accent bg-canvas px-3 py-2.5">
            {/* Not on a decision: there the detail is the options, and it is
                shown as options inside the question block below rather than
                twice -- once as a paragraph here and once as itself. Nor on an
                open setup job, where the detail is the instructions and is
                drawn inside the box that closes them, for the same reason. */}
            {node.detail && !isDecision && !setupOpen && (
              <p className="whitespace-pre-wrap text-ui text-ink-muted">{node.detail}</p>
            )}
            {node.acceptance && (
              <div>
                <p className="text-small font-semibold uppercase tracking-wide text-ink-muted">Done when</p>
                <p className="whitespace-pre-wrap text-ui text-ink">{node.acceptance}</p>
              </div>
            )}
            {/* What it needs, in its own line above the history. The comment
                below is every block this step has had, dated; this is the one
                sentence that still stands. */}
            {node.blockAsk && (
              <div>
                <p className="text-small font-semibold uppercase tracking-wide text-ink-muted">Needs</p>
                <p className="whitespace-pre-wrap text-ui text-ink">{node.blockAsk}</p>
              </div>
            )}
            {node.comment && (
              <p className="whitespace-pre-wrap rounded-lg bg-canvas px-3 py-2 text-ui text-ink">
                {node.comment}
              </p>
            )}

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
                autoFocus={answering}
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

            <Questions node={node} titles={refTitles} />

            <Dependencies node={node} catalog={catalog} />

            <CommentThread
              target="step"
              id={node.id}
              thread={node.thread}
              titles={refTitles}
              placeholder="A note on this step. Tag @dash to ask something, or to tell it to reword the step, file an idea or build it."
            />

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

            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(true)}>
                Edit
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => {
                  setShowChildren(true);
                  setAddingChild(true);
                }}
              >
                Add a sub-step
              </Button>
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
                    !sendState.error &&
                    !sendState.message &&
                    !batchState.error &&
                    !batchState.message
                  }
                />
              )}
            </div>
            </div>
          </li>
        )
      )}

      {hasChildren &&
        showChildren &&
        substeps.map((child, index) => (
          <PlanRow
            key={child.id}
            node={child}
            trail={[...trail, index < substeps.length - 1]}
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
        ))}

      {addingChild && (
        <li style={inset} className="py-2 pr-3">
          <AddStep
            module={node.module}
            parentId={node.id}
            open
            onDone={() => setAddingChild(false)}
          />
        </li>
      )}
    </>
  );
}

/**
 * The empty state, which is also the import.
 *
 * A button rather than a seed that runs when you first look at the page:
 * writing forty rows because somebody opened a tab is a write nobody got to
 * decline, and saying what it will do first costs one click.
 */
function ImportTheBuildOrder() {
  const [state, action, pending] = useActionState(seedPlan, {} as PlanActionState);

  return (
    <form action={action} className={cn(cardVariants(), 'border-dashed px-4 py-8 text-center')}>
      <p className="text-ui text-ink">Nothing here yet.</p>
      <p className="mx-auto mt-1 max-w-prose text-ui text-ink-muted">
        The build order in <code>docs/BUILD-ORDER.md</code> and the job side&rsquo;s own plan can be
        written in as a starting point — every numbered step, with the ones already marked done
        carried across, each at the top of its module for you to group as you see fit. After that
        this is the plan, and the documents are background reading: nothing here reads them again,
        and the two will drift.
      </p>
      <div className="mt-4 flex flex-col items-center gap-2">
        <Button type="submit" pending={pending}>
          {pending ? 'Importing…' : 'Import the build order'}
        </Button>
        <FieldError>{state.error}</FieldError>
        {state.message && !state.error && (
          <span className="text-small text-ink-muted">{state.message}</span>
        )}
      </div>
    </form>
  );
}

/**
 * Finding a step again.
 *
 * The plan outgrew being read: three hundred steps across nine modules, and
 * the only ways to reach one were to know its module and scroll, or to know
 * which view it happened to fall into. The number, the title and the detail
 * are the three things somebody remembers about a step they are looking for,
 * so all three are searched.
 *
 * It says how many it found rather than leaving you to count the rows, because
 * the count is the answer to "is it in here at all" and the rows are the answer
 * to "which one". Escape clears it, which is what Escape does in a field you
 * are filtering with -- there is a button for the pointer beside it.
 */
function SearchThePlan({
  query,
  onQuery,
  hits,
  searching,
}: {
  query: string;
  onQuery: (next: string) => void;
  hits: number;
  searching: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <div className="relative min-w-0 flex-1 sm:max-w-xs">
        <Input
          type="search"
          value={query}
          onChange={(event) => onQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') onQuery('');
          }}
          placeholder="Search the plan — a number, a title, a phrase"
          aria-label="Search the plan"
          className="w-full"
        />
      </div>

      {searching && (
        <p className="tabular text-small text-ink-muted" role="status">
          {hits === 0
            ? 'Nothing matches'
            : `${hits} ${hits === 1 ? 'step' : 'steps'} found`}
          {' · '}
          <button
            type="button"
            onClick={() => onQuery('')}
            className="underline underline-offset-2 hover:text-ink"
          >
            clear
          </button>
        </p>
      )}
    </div>
  );
}

/**
 * The run readings, asked for once the page has drawn.
 *
 * #563: the page appears with whatever was last written down and updates a
 * moment later, rather than holding the render open on a request to GitHub.
 * `app/api/plan/runs` does the asking, writes what came back onto the run rows
 * so the terminal tool and the next session's brief read the same answer, and
 * hands the readings back for the rows already on screen.
 *
 * Nothing is asked when no step is claimed, which is most of the time: there
 * is no run being worked to ask about, and every reading the page has is about
 * a run that is over. Asked once rather than on a timer -- the clock ticks the
 * rows on by itself, and a reading is only worth taking again when something
 * has been sent since.
 *
 * A request that fails changes nothing, so the page goes on showing the
 * reading it drew with. That is the third line of the done-when, and it is
 * what falling back to the clock in `claimLiveness` is for.
 */
function useRefreshedRuns(
  lastRuns: Record<string, LastRun>,
  claims: number,
  stored: string | null,
): { runs: Record<string, LastRun>; refusal: string | null } {
  const [answer, setAnswer] = useState<{
    readings: Record<string, StoredRunReading>;
    error: string | null;
  } | null>(null);

  useEffect(() => {
    if (claims === 0) return;
    const leaving = new AbortController();

    void (async () => {
      try {
        const res = await fetch('/api/plan/runs', { method: 'POST', signal: leaving.signal });
        if (!res.ok) return;
        const body = (await res.json()) as {
          readings?: Record<string, StoredRunReading>;
          error?: string | null;
        };
        setAnswer({ readings: body.readings ?? {}, error: body.error ?? null });
      } catch {
        // Left as it was drawn.
      }
    })();

    return () => leaving.abort();
  }, [claims]);

  const runs = useMemo(
    () => (answer ? withReadings(lastRuns, answer.readings) : lastRuns),
    [lastRuns, answer],
  );

  // The route's own word wins outright once it has one, `null` included. It
  // asked GitHub a moment ago, and the refusals the page was handed are from
  // whenever anything last asked -- a key replaced between the two would
  // otherwise go on being reported as rejected for as long as one of those
  // runs was on screen. A 200 with no `error` is GitHub answering, which is
  // the fix landing.
  return { runs, refusal: answer ? answer.error : stored };
}

export function PlanView({
  sections,
  finished,
  summary,
  view,
  catalog,
  lastRuns,
  runRaises = [],
  keyRefusal = null,
  liveness,
  commitChecks,
  empty,
  canSend,
  unfolded = false,
  opened = false,
}: {
  sections: PlanSection[];
  /** The finished features, for the fold at the foot of Everything. */
  finished: PlanNode[];
  summary: PlanSummary;
  view: View;
  catalog: PlanCatalogEntry[];
  /** The newest run against each step, by step id. */
  lastRuns: Record<string, LastRun>;
  /** Every raise that names a step, for the opened step's account of its run. */
  runRaises?: readonly RunRaise[];
  /**
   * Why GitHub is refusing to say what anything has pushed, as the run rows
   * had it when the page rendered.
   *
   * Drawn with rather than waited for, so a rejected key is on screen in the
   * first paint instead of a second later: it is the reason every claimed row
   * below reads off the clock. The route's answer replaces it once that
   * arrives -- see `useRefreshedRuns`.
   */
  keyRefusal?: string | null;
  /** The claims read against their runs, at the clock the page rendered with. */
  liveness?: PlanLiveness;
  /** What CI said about each commit a step shipped in, by the commit's sha. */
  commitChecks: Record<string, CommitCheck>;
  empty: boolean;
  canSend: boolean;
  /**
   * Render every feature with its sub-steps already showing.
   *
   * A seam for the render tests and nothing else -- the page leaves it off, so
   * every feature starts folded there. A folded row renders no children at
   * all, and `renderToStaticMarkup` cannot press the arrow, so the tests that
   * pin how a nested row is laid out would have nothing to look at.
   */
  unfolded?: boolean;
  /**
   * Render every row with its own panel already open.
   *
   * The same kind of seam, for what is behind a row's fold rather than beneath
   * it: the account of a step's run lives there, and nothing can press a title
   * in a static render. The page leaves it off.
   */
  opened?: boolean;
}) {
  const [query, setQuery] = useState('');
  const searching = searchTerms(query).length > 0;

  // What GitHub says about the runs behind the claimed steps, taken once the
  // page is up and written over the readings it drew with. A claim is the only
  // reason to ask, so the server's own reading of them is what decides whether
  // anything is asked at all.
  const refreshed = useRefreshedRuns(
    lastRuns,
    Object.keys(liveness ?? {}).length,
    keyRefusal,
  );
  const runs = refreshed.runs;

  // The whole tree is already on the page, so the search runs here rather than
  // as a round trip: a plan is tens of steps, and a filter you feel keeping up
  // with you is a different tool from one you submit. The view stays a search
  // parameter, because "the ready steps" is a thing worth keeping a link to and
  // "the word I typed for ten seconds" is not.
  const shown = useMemo(
    () => (searching ? searchSections(sections, query) : sections),
    [sections, query, searching],
  );
  // The archive searches with everything else. "Did I already plan that" is
  // the question a finished feature gets asked, and it is asked by typing.
  const found = useMemo(
    () => (searching ? searchNodes(finished, query) : finished),
    [finished, query, searching],
  );
  const hits = useMemo(
    () => (searching ? countMatches(shown) + flatten(found).filter((n) => n.matches).length : 0),
    [shown, found, searching],
  );

  if (empty) return <ImportTheBuildOrder />;

  const nothingToShow =
    shown.every((section) => section.nodes.length === 0) && found.length === 0;

  return (
    <div className="space-y-6">
      {/* Above the summary, because it is the reason the summary's claims are
          read off the clock. A banner rather than a status line: the key is a
          setting only the person can change, the sentence GitHub's refusal was
          turned into already says which one and what to do with it, and until
          it is done no row on this page can say whether its session is still
          working. */}
      {refreshed.refusal && (
        <Banner tone="warn">
          <p className="font-semibold">
            Nothing can read what these runs have pushed.
          </p>
          <p>{refreshed.refusal}</p>
          <p className="text-small text-ink-muted">
            Until then a claimed step reads off the clock: claimed for two hours, then stopped.
          </p>
        </Banner>
      )}

      <SummaryStrip summary={summary} view={view} />

      <SearchThePlan query={query} onQuery={setQuery} hits={hits} searching={searching} />

      {!searching && nothingToShow && EMPTY_VIEW[view] && (
        <EmptyState
          tone="finished"
          title={EMPTY_VIEW[view].title}
          description={EMPTY_VIEW[view].description}
          seed={`plan-${view}`}
        />
      )}

      {/* The sections as a stack of their own. They were spaced like the parts
          of the page -- a summary strip, a filter row, a plan -- which left a
          collapsed module marooned between two large gaps. Between sections
          the right distance is smaller than that, and now that each one is a
          card it is the gap between cards rather than between headings. */}
      <div className="space-y-3">
        {shown.map((section) => {
          // What is finished is consulted, not read -- the same call the rows
          // make about a closed step's children. The progress stays on the
          // summary line either way, so a folded module still says how far it
          // got: law 10, a fold that hides its own count has moved the work.
          const finished = section.progress.live > 0 && section.progress.fraction === 1;

          // Not while searching: a row offering to write a new step under
          // every module is the page's furniture, and a page narrowed to four
          // results should be four results.
          const canAdd = !searching && (view === 'open' || view === 'all');

          return (
            // One card per module, header included, rather than a bar that
            // turns into a heading. The fold used to swap the header's ground,
            // its inset and its height all at once, so a module did not open so
            // much as jump: the line you had just clicked moved out from under
            // the pointer and changed colour doing it. The card is the drawer
            // in both states now, and the only thing the fold animates is the
            // chevron -- which is the whole of what changed.
            <details
              // Keyed on whether a search is running, so starting or clearing
              // one remounts the fold. A module you had collapsed by hand would
              // otherwise stay collapsed over its own results, and the `open`
              // prop below cannot push it back: React writes that attribute on
              // a change of value, not on every render.
              key={`${section.module ?? 'app'}${searching ? ':found' : ''}`}
              // A search opens every module it kept, because it only kept the
              // ones with something in them.
              open={searching || !finished}
              className={cn(cardVariants({ padding: 'none' }), 'group/section overflow-hidden')}
            >
              <summary
                className={cn(
                  'press flex cursor-pointer list-none flex-wrap items-center justify-between gap-2',
                  'px-3 py-2.5 [&::-webkit-details-marker]:hidden',
                  'transition-colors duration-150 hover:bg-sunken',
                  'focus-visible:outline-2 focus-visible:-outline-offset-2',
                  // The hairline belongs to the fold, not to the list: it is
                  // what joins the header to what it opened, and a border round
                  // the list as well would be a border inside a border (law 11).
                  'group-open/section:border-b group-open/section:border-border',
                )}
              >
                <h2 className="flex items-center gap-2 text-body font-semibold text-ink">
                  <ChevronRight
                    aria-hidden
                    strokeWidth={2}
                    className="size-4 shrink-0 text-ink-muted transition-transform duration-150 group-open/section:rotate-90"
                  />
                  {section.label}
                </h2>
                <span className="flex flex-wrap items-center gap-x-4 gap-y-1">
                  <SectionTally tally={section.tally} label={section.label} />
                  <Progress
                    label={section.label}
                    progress={section.progress}
                    bands={section.bands}
                  />
                </span>
              </summary>

              {section.nodes.length > 0 && (
                <ul className="divide-y divide-border">
                  <ColumnHeader />
                  {section.nodes.map((node) => (
                    <PlanRow
                      key={node.id}
                      node={node}
                      trail={[]}
                      catalog={catalog}
                      canSend={canSend}
                      lastRuns={runs}
                      runRaises={runRaises}
                      liveness={liveness}
                      commitChecks={commitChecks}
                      view={view}
                      searching={searching}
                      unfolded={unfolded}
                      opened={opened}
                    />
                  ))}
                </ul>
              )}

              {/* Unfolded onto nothing was the worst of it: a dashed box the
                  width of the page saying "No plan for Shopping yet", with a
                  second box under it to add one. A module with nothing in it
                  has nothing to show -- law 1 -- and the offer to write the
                  first step is the one line worth putting there. The finished
                  case does say something, because "nothing here" and "all of it
                  shipped" are different facts and only one of them is empty. */}
              {section.nodes.length === 0 && finished && (
                <p className="px-3 py-2.5 text-ui text-ink-muted">
                  Everything planned for {section.label} is done.
                </p>
              )}

              {canAdd && (
                <div
                  className={cn(
                    'px-3 py-2',
                    section.nodes.length > 0 && 'border-t border-border',
                  )}
                >
                  <AddStep module={section.module} parentId={null} />
                </div>
              )}
            </details>
          );
        })}
      </div>

      {/* What is finished, out of the way but not gone. Folded shut, newest
          first, and only on Everything -- every other view dropped these rows
          before the page saw them. A search opens it, because "did I already
          plan that" is the question it exists to answer. */}
      {found.length > 0 && (
        <details
          key={searching ? 'finished:found' : 'finished'}
          open={searching}
          className={cn(cardVariants({ padding: 'none' }), 'group/section overflow-hidden')}
        >
          <summary
            className={cn(
              'press flex cursor-pointer list-none flex-wrap items-center justify-between gap-2',
              'px-3 py-2.5 [&::-webkit-details-marker]:hidden',
              'transition-colors duration-150 hover:bg-sunken',
              'focus-visible:outline-2 focus-visible:-outline-offset-2',
              'group-open/section:border-b group-open/section:border-border',
            )}
          >
            <h2 className="flex items-center gap-2 text-body font-semibold text-ink">
              <ChevronRight
                aria-hidden
                strokeWidth={2}
                className="size-4 shrink-0 text-ink-muted transition-transform duration-150 group-open/section:rotate-90"
              />
              Finished
            </h2>
            <span className="text-ui text-ink-muted">
              <span className="tabular font-semibold text-ink">{found.length}</span>{' '}
              {found.length === 1 ? 'feature' : 'features'}
            </span>
          </summary>
          <ul className="divide-y divide-border">
            <ColumnHeader />
            {found.map((node) => (
              <PlanRow
                key={node.id}
                node={node}
                trail={[]}
                catalog={catalog}
                canSend={canSend}
                lastRuns={runs}
                runRaises={runRaises}
                liveness={liveness}
                commitChecks={commitChecks}
                view={view}
                searching={searching}
                unfolded={unfolded}
                opened={opened}
              />
            ))}
          </ul>
        </details>
      )}

      {/* The app-wide list is not offered as a section until something is in
          it, so this is the only way to put the first thing there. Only on
          Everything, which is where the empty sections live now: drawing this
          heading over the open view would put back the one thing dropping
          them took away. */}
      {!searching &&
        view === 'all' &&
        !sections.some((section) => section.module === null) && (
          <section className="space-y-2">
            <h2 className="text-body font-semibold text-ink">The app as a whole</h2>
            <AddStep module={null} parentId={null} />
          </section>
        )}
    </div>
  );
}

export type { PlanCatalogEntry };
