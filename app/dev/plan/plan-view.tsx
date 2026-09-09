'use client';

import { useActionState, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import {
  Ban,
  Check,
  Circle,
  CircleUser,
  Flag,
  Lightbulb,
  ChevronDown,
  ChevronRight,
  CircleDashed,
  HelpCircle,
  Hourglass,
  Pencil,
  Play,
  Scale,
  Sparkles,
  TrendingUp,
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
  sendPlanItemToClaude,
  sendPlanQueueToClaude,
  setPlanItemAssignee,
  setPlanItemStatus,
  updatePlanItem,
  type PlanActionState,
} from './actions';
import { ActionMenu, type ActionMenuItem } from '@/components/ui/action-menu';
import { Button } from '@/components/ui/button';
import { cardVariants } from '@/components/ui/card';
import { Disclosure } from '@/components/ui/disclosure';
import { EmptyState } from '@/components/ui/empty-state';
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
import { MODULES, type ModuleId } from '@/lib/modules';
import {
  PLAN_ASSIGNEES,
  PLAN_PRIORITIES,
  PLAN_SIZES,
  PLAN_STATUSES,
  isClosed,
  type PlanAssignee,
  type PlanPriority,
  type PlanSize,
  type PlanStatus,
} from '@/lib/plan/load';
import {
  PLAN_HEALTHS,
  PLAN_VIEWS,
  PLAN_VIEW_LABEL,
  flatten,
  healthOf as planHealthOf,
  type PlanHealth,
  type PlanNode,
  type PlanProgress,
  type PlanSection,
  type PlanSummary,
  type PlanTally,
  type PlanView as View,
} from '@/lib/plan/tree';
import { reshapeOrigin } from '@/lib/plan/origin';
import { elapsedSince } from '@/lib/plan/elapsed';
import { optionAnswer, planOptions, type PlanOption } from '@/lib/plan/options';
import { cn } from '@/lib/cn';

/** A step as the pickers know it: enough to name it and to place it. */
export type PlanCatalogEntry = {
  id: string;
  number: number;
  title: string;
  module: ModuleId | null;
  parentId: string | null;
  depth: number;
  closed: boolean;
};

const STATUS_LABEL: Record<PlanStatus, string> = {
  proposed: 'Proposed',
  not_started: 'Not started',
  in_progress: 'In progress',
  blocked: 'Blocked',
  done: 'Done',
  dropped: 'Dropped',
};

const PRIORITY_LABEL: Record<PlanPriority, string> = { 1: 'Next', 2: 'Normal', 3: 'Someday' };
const SIZE_LABEL: Record<PlanSize, string> = { s: 'Small', m: 'Medium', l: 'Large' };
const ASSIGNEE_LABEL: Record<PlanAssignee, string> = { me: 'Me', claude: 'Claude' };

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
          {PRIORITY_LABEL[priority]}
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
 */
function Progress({ label, progress }: { label: string; progress: PlanProgress }) {
  if (progress.fraction === null) return null;

  return (
    <span className="flex items-center gap-2">
      {/* `sunken`, not `canvas`. A progress bar is a fraction *of* something,
          and the something is the track -- but `--c-page` is defined as
          `var(--c-canvas)`, so a canvas track on a page is the page colour and
          there is no track at all. What was left was a green pill of no
          particular length floating on the background, which is a bar that
          cannot be seen responding to anything however faithfully its width
          follows the number. Same reason the avatar tiles are sunken. */}
      <span
        className="h-1.5 w-24 overflow-hidden rounded-full bg-sunken"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={progress.live}
        aria-valuenow={progress.done}
        aria-label={`${label}: ${progress.done} of ${progress.live} done`}
      >
        <span
          className="block h-full rounded-full bg-positive"
          style={{ width: `${Math.round(progress.fraction * 100)}%` }}
        />
      </span>
      <span className="tabular text-small text-ink-muted">
        {progress.done} of {progress.live}
        {progress.inProgress > 0 && ` · ${progress.inProgress} underway`}
      </span>
    </span>
  );
}

/**
 * The numbers across the plan, and the views over it.
 *
 * The counts are links where a view answers them: "3 ready" is the question
 * "which three", and the view is the answer. The views are search parameters
 * rather than state so that "the ready steps" is something you can keep.
 */
/**
 * The queue, sent.
 *
 * Beside the count of what is Claude's, because that number is the question
 * this button answers: you have spent a while going down the plan handing
 * things over, and what you want at the end of it is not to press Send on each
 * of them. Absent when nothing is handed over, since there would be nothing to
 * send and an always-present button that usually refuses teaches people not to
 * press it.
 */
function SendTheQueue({ count }: { count: number }) {
  const [state, action, pending] = useActionState(sendPlanQueueToClaude, {} as PlanActionState);

  if (count === 0) return null;

  return (
    <>
      <form action={action}>
        <Button
          type="submit"
          size="sm"
          variant="secondary"
          pending={pending}
          title="Hand the whole queue to one routine, worked in order"
        >
          <Play className="size-3.5" aria-hidden />
          {pending ? 'Sending…' : `Send all ${count} to Claude`}
        </Button>
      </form>
      {(state.error ?? state.message) && (
        <p className="basis-full text-small">
          <FieldError>{state.error}</FieldError>
          {!state.error && <span className="text-ink-muted">{state.message}</span>}
        </p>
      )}
    </>
  );
}

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
    title: "Nothing of Claude's right now",
    description: 'Hand a step to Claude from its menu, or send one straight to the routine.',
  },
  you: {
    title: 'Nothing waiting on you',
    description:
      'Every question has been answered, every proposal decided on, and nothing is blocked. The plan can move without you.',
  },
};

function SummaryStrip({
  summary,
  view,
  queued,
}: {
  summary: PlanSummary;
  view: View;
  /** What the send-all button would actually send: not every step marked as
      Claude's, since an unanswered question is nobody's to build. */
  queued: number;
}) {
  const facts: Array<{ view: View | null; value: number; noun: string }> = [
    { view: 'open', value: summary.open, noun: 'open' },
    // Second, because it is the one number on this line that is a request.
    { view: 'you', value: summary.onYou, noun: 'on you' },
    { view: 'ready', value: summary.ready, noun: 'ready' },
    { view: 'proposed', value: summary.proposed, noun: 'proposed' },
    { view: 'blocked', value: summary.waiting, noun: 'waiting' },
    { view: 'fog', value: summary.fog, noun: 'not specified' },
    { view: null, value: summary.inProgress, noun: 'underway' },
    { view: 'claude', value: summary.claude, noun: "Claude's" },
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
      <SendTheQueue count={queued} />
      <nav aria-label="View" className="ml-auto flex flex-wrap items-center gap-1">
        {PLAN_VIEWS.map((candidate) => (
          <Link
            key={candidate}
            href={candidate === 'open' ? '/dev/plan' : `/dev/plan?view=${candidate}`}
            aria-current={candidate === view ? 'page' : undefined}
            className={cn(
              'press rounded-full px-2.5 py-1 text-small font-medium transition-colors',
              candidate === view
                ? 'bg-accent text-surface'
                : 'text-ink-muted hover:bg-accent-tint hover:text-accent',
            )}
          >
            {PLAN_VIEW_LABEL[candidate]}
          </Link>
        ))}
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
function subtreeOf(catalog: readonly PlanCatalogEntry[], id: string): Set<string> {
  const ids = new Set([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const entry of catalog) {
      if (entry.parentId && ids.has(entry.parentId) && !ids.has(entry.id)) {
        ids.add(entry.id);
        grew = true;
      }
    }
  }
  return ids;
}

function catalogLabel(entry: PlanCatalogEntry): string {
  return `${'· '.repeat(entry.depth)}#${entry.number} ${entry.title}`;
}

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
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="press inline-flex items-center gap-1.5 rounded-control px-2 py-1 text-ui text-ink-muted hover:bg-shell-hover hover:text-accent"
      >
        <span aria-hidden className="text-body leading-none">+</span>
        {parentId ? 'Add a sub-step' : 'Add a step'}
      </button>
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
/**
 * The heading over a part of a question: the question, the options, the answer.
 *
 * Three words in the same small caps in every place a question is shown, so
 * that "which of these am I reading" is answered by the shape of the thing and
 * not by working it out from the prose.
 */
function QuestionPartLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-micro font-semibold uppercase tracking-wide text-ink-muted">{children}</p>
  );
}

/**
 * The question itself, said once and set apart.
 *
 * A question used to be a line of body text among the step's other lines, at
 * the same size and weight as the description of the work -- so the one thing
 * on the surface that is actually waiting on a person looked like reading
 * matter. It is now labelled and set a step up the scale, which is the whole
 * ask: when something needs an answer, the question I am answering should be
 * the clearest thing on the surface.
 */
function TheQuestion({ node }: { node: PlanNode }) {
  return (
    <div className="space-y-0.5">
      <QuestionPartLabel>The question</QuestionPartLabel>
      <p className="text-ui font-medium text-ink">
        <span className="tabular mr-1.5 font-normal text-small text-ink-ghost">#{node.number}</span>
        {node.title}
      </p>
    </div>
  );
}

/**
 * The options, as options.
 *
 * They are written as prose in `detail` -- a lettered paragraph each, with
 * what it costs and a recommendation -- and were shown as that same paragraph:
 * a muted block of text in which the choices had to be found by reading. Where
 * the letters are legible (see lib/plan/options.ts) each one now gets its own
 * line and its letter in a badge, so the shape of the choice is visible before
 * a word of it is read.
 *
 * `onChoose` makes each line the button that answers with it. Without it they
 * are just the options, which is what they are while nobody is answering.
 *
 * The prose does not disappear: the letters carry only each option's opening
 * sentence, and the cost and the recommendation are the rest of the paragraph.
 * That goes under the fold, where it can be read by anybody who wants more than
 * the choice -- law 10, and the collapsed line says what is behind it.
 */
function TheOptions({
  detail,
  onChoose,
}: {
  detail: string | null;
  onChoose?: (option: PlanOption) => void;
}) {
  if (!detail) return null;
  const options = planOptions(detail);

  if (options.length === 0) {
    return (
      <div className="space-y-0.5">
        <QuestionPartLabel>The options</QuestionPartLabel>
        <p className="whitespace-pre-wrap text-small text-ink-muted">{detail}</p>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      <QuestionPartLabel>The options</QuestionPartLabel>
      <ul className="space-y-1">
        {options.map((option) => {
          const body = (
            <>
              <span
                aria-hidden
                className="flex size-5 shrink-0 items-center justify-center rounded-control bg-surface text-micro font-semibold uppercase text-ink"
              >
                {option.letter}
              </span>
              <span className="min-w-0 flex-1 text-left text-small text-ink">{option.label}</span>
            </>
          );

          return (
            <li key={option.letter}>
              {onChoose ? (
                <button
                  type="button"
                  onClick={() => onChoose(option)}
                  title={`Answer ${option.letter}: ${option.label}`}
                  className="press flex w-full items-start gap-2 rounded-control px-1.5 py-1 transition-colors duration-150 hover:bg-accent-tint"
                >
                  {body}
                </button>
              ) : (
                <span className="flex items-start gap-2 px-1.5 py-1">{body}</span>
              )}
            </li>
          );
        })}
      </ul>
      <Disclosure title="What each one costs" className="px-1.5">
        <p className="whitespace-pre-wrap text-small text-ink-muted">{detail}</p>
      </Disclosure>
    </div>
  );
}

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
  const field = `answer-${node.id}`;
  const options = planOptions(node.detail);
  const [answer, setAnswer] = useState('');

  // Replaces rather than appends: the options are a choice between them, and
  // pressing two means you changed your mind, not that you want both written
  // down. What you type after it is yours and is left alone.
  //
  // Controlled rather than written through a ref. A ref put the text into the
  // DOM node behind React's back, which worked here only because this box
  // happens to always be mounted -- the same call in the questions list had
  // nothing to write to, so the options there did nothing at all. One
  // mechanism, in both places.
  const choose = (option: PlanOption) => setAnswer(optionAnswer(option));

  return (
    /* A well, not a frame: this sits inside the open step, which is already a
       box, and the caution hairline round it was a second claim on a grouping
       the ground had already made. The tint stays -- it is the thing saying a
       question is waiting on you. Law 11. */
    <div className="space-y-2.5 rounded-lg bg-caution-tint/40 px-3 py-2.5">
      {/* The question and its options, before the box that closes them. The
          box used to come first with the options as a row of chips above it,
          which put the form in front of the thing the form is about. */}
      <TheQuestion node={node} />
      <TheOptions detail={node.detail} onChoose={choose} />

      {node.resolution && (
        <div className="space-y-0.5">
          <QuestionPartLabel>Answered</QuestionPartLabel>
          <p className="whitespace-pre-wrap text-ui text-ink">{node.resolution}</p>
        </div>
      )}
      <form action={action} className="space-y-2">
        <input type="hidden" name="id" value={node.id} />
        <Label htmlFor={field}>{node.resolution ? 'Change the answer' : 'Your answer'}</Label>
        <Textarea
          id={field}
          name="answer"
          rows={2}
          className="min-h-12"
          autoFocus={autoFocus}
          value={answer}
          onChange={(event) => setAnswer(event.target.value)}
          placeholder={
            options.length > 0
              ? 'Pick one above, or say it in your own words — and enough of why that a session need not ask again.'
              : 'What you decided, and enough of why that a session need not ask again.'
          }
        />
        <FieldHint>This closes the question. Nothing is committed against it.</FieldHint>
        <Button type="submit" size="sm" pending={pending}>
          {node.resolution ? 'Record the new answer' : 'Answer'}
        </Button>
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
function QuestionRow({ node }: { node: PlanNode }) {
  const [answerState, answerAction, answerPending] = useActionState(
    answerPlanDecision,
    {} as PlanActionState,
  );
  const [dropState, dropAction, dropPending] = useActionState(
    setPlanItemStatus,
    {} as PlanActionState,
  );
  const [answering, setAnswering] = useState(false);
  const [answer, setAnswer] = useState('');
  useSettled(answerState, () => setAnswering(false));

  const settled = isClosed(node.status);
  const field = `question-${node.id}`;

  /**
   * Pressing an option opens the box with that option in it.
   *
   * Both halves matter. It writes rather than records, as it always has:
   * an answer is read by every session that works beneath this feature from
   * now on, so the last word before it is written down stays yours, and "b,
   * but only for the shared lists" is the answer you most often actually
   * want. And it opens the box itself, which is the half that was missing --
   * the options were only clickable once you had already pressed Answer, so
   * from the outside they were three things that looked like buttons and did
   * nothing. Replaces rather than appends: pressing two of them means you
   * changed your mind, not that you want both written down.
   *
   * The box is controlled rather than written through a ref, because it does
   * not exist yet at the moment the option is pressed.
   */
  const choose = (option: PlanOption) => {
    setAnswer(optionAnswer(option));
    setAnswering(true);
  };

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
              <span className="tabular mr-1.5 text-small text-ink-ghost">#{node.number}</span>
              {node.title}
            </p>
          ) : (
            <>
              <TheQuestion node={node} />
              <TheOptions detail={node.detail} onChoose={settled ? undefined : choose} />
            </>
          )}

          {node.resolution && (
            <div className="space-y-0.5">
              <QuestionPartLabel>Answered</QuestionPartLabel>
              <p className="whitespace-pre-wrap text-ui text-ink">{node.resolution}</p>
            </div>
          )}

          {answering ? (
            <form action={answerAction} className="space-y-2">
              <input type="hidden" name="id" value={node.id} />
              <Label htmlFor={field}>{node.resolution ? 'Change the answer' : 'Your answer'}</Label>
              <Textarea
                id={field}
                name="answer"
                rows={2}
                className="min-h-12"
                autoFocus
                value={answer}
                onChange={(event) => setAnswer(event.target.value)}
                placeholder={
                  planOptions(node.detail).length > 0
                    ? 'Pick one above, or say it in your own words — and enough of why that a session need not ask again.'
                    : 'What you decided, and enough of why that a session need not ask again.'
                }
              />
              <div className="flex items-center gap-1">
                <Button type="submit" size="sm" pending={answerPending}>
                  {node.resolution ? 'Record the new answer' : 'Answer'}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setAnswer('');
                    setAnswering(false);
                  }}
                >
                  Cancel
                </Button>
              </div>
            </form>
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
            </div>
          )}

          <FieldError>{answerState.error ?? dropState.error}</FieldError>
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
function Questions({ node }: { node: PlanNode }) {
  const [asking, setAsking] = useState(false);
  const questions = node.children.filter((child) => child.kind === 'decision');
  const unanswered = questions.filter((question) => !isClosed(question.status)).length;

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
            <QuestionRow key={question.id} node={question} />
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
 * Hand it over and start the routine now.
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
}) {
  // Every open step beneath, the feature itself aside: what the batch would
  // take on, and the only reason to offer it.
  const beneath = flatten([node]).filter(
    (step) => step.id !== node.id && !isClosed(step.status) && step.status !== 'proposed',
  ).length;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <form action={action}>
        <input type="hidden" name="id" value={node.id} />
        <Button type="submit" size="sm" variant="secondary" pending={pending}>
          <Play className="size-3.5" aria-hidden />
          {pending ? 'Sending…' : 'Send to Claude'}
        </Button>
      </form>
      {beneath > 0 && (
        <form action={batchAction}>
          <input type="hidden" name="id" value={node.id} />
          <Button
            type="submit"
            size="sm"
            variant="ghost"
            pending={batchPending}
            title="Hand every open step beneath this one to Claude, worked in order"
          >
            {batchPending ? 'Sending…' : `Send all ${beneath} beneath`}
          </Button>
        </form>
      )}
      {/* The return trip, and the only button here that does not hand work
          over: it asks for the feature to be re-read against what has been
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
            title="Re-read this feature against the questions answered beneath it. Whatever comes back is proposed, not started."
          >
            {reshapePending ? 'Re-shaping…' : 'Re-shape'}
          </Button>
        </form>
      )}
      {!canSend && quiet && (
        <span className="text-small text-ink-muted">
          Needs the plan routine&apos;s token on the deployment.
        </span>
      )}
    </div>
  );
}

/**
 * One of the row's quick actions.
 *
 * An icon on the row rather than a button behind the fold: sending a step to
 * Claude, handing it over and editing it are the three things done to a step
 * without needing to read it first, and reaching them through the step's own
 * detail made every one of them two clicks and a scroll.
 */
function RowIconButton({
  label,
  type = 'button',
  pending = false,
  onClick,
  children,
}: {
  label: string;
  type?: 'button' | 'submit';
  pending?: boolean;
  onClick?: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type={type}
      title={label}
      onClick={onClick}
      disabled={pending}
      className="press flex size-7 items-center justify-center rounded-lg text-ink-muted transition-colors duration-150 hover:bg-sunken hover:text-ink disabled:opacity-50"
    >
      {children}
      <span className="sr-only">{label}</span>
    </button>
  );
}

function when(iso: string | null): string | null {
  return iso ? iso.slice(0, 10) : null;
}

/**
 * The wall clock, as something to subscribe to.
 *
 * One interval for the whole page rather than one per running step: a plan
 * with six steps underway should not be six timers waking the tab up out of
 * step with each other. It only runs while something is watching, and 30
 * seconds is as often as a figure rounded to the minute can change.
 *
 * Zero until the first subscriber arrives, which is what makes it safe to
 * render on the server: the elapsed time is the one value already different by
 * the time the HTML lands, so both sides render the placeholder and the figure
 * appears on the tick after mount.
 */
const CLOCK_TICK_MS = 30_000;
let clockNow = 0;
let clockTimer: ReturnType<typeof setInterval> | null = null;
const clockWatchers = new Set<() => void>();

function subscribeToClock(onTick: () => void): () => void {
  clockWatchers.add(onTick);
  if (clockTimer === null) {
    clockNow = Date.now();
    clockTimer = setInterval(() => {
      clockNow = Date.now();
      for (const watcher of clockWatchers) watcher();
    }, CLOCK_TICK_MS);
  }
  return () => {
    clockWatchers.delete(onTick);
    if (clockWatchers.size === 0 && clockTimer !== null) {
      clearInterval(clockTimer);
      clockTimer = null;
    }
  };
}

/** The clock on a step that is underway. */
function Elapsed({ startedAt }: { startedAt: string }) {
  const now = useSyncExternalStore(
    subscribeToClock,
    () => clockNow,
    () => 0,
  );

  return <>{now === 0 ? '…' : elapsedSince(startedAt, now)}</>;
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
  tone: 'quiet' | 'ghost' | 'accent' | 'positive' | 'caution';
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  title?: string;
};

/**
 * How each state is worded and drawn.
 *
 * Which state a step is in is decided in lib/plan/tree.ts, so the dots beside
 * a module heading and the health column under it cannot disagree. What is
 * left here is presentation: the word, the icon, and the fixed part of the
 * tooltip.
 */
const HEALTH: Record<PlanHealth, Health> = {
  unanswered: {
    word: 'Unanswered',
    tone: 'caution',
    icon: HelpCircle,
    title: 'A question waiting on you. It closes on an answer, not a commit.',
  },
  answered: { word: 'Answered', tone: 'positive', icon: Check },
  proposed: {
    word: 'Proposed',
    tone: 'accent',
    icon: Lightbulb,
    title: 'Written by a session. Approve it, edit it, or drop it -- nothing happens until you do.',
  },
  in_progress: { word: 'In progress', tone: 'accent', icon: TrendingUp },
  blocked: { word: 'Blocked', tone: 'caution', icon: Ban },
  waiting: { word: 'Waiting', tone: 'caution', icon: Hourglass },
  ready: { word: 'Ready', tone: 'positive', icon: Sparkles },
  not_started: { word: 'Not started', tone: 'quiet', icon: CircleDashed },
  done: { word: 'Done', tone: 'positive', icon: Check },
  dropped: { word: 'Dropped', tone: 'ghost', icon: X },
};

function healthOf(node: PlanNode): Health {
  const health = planHealthOf(node);
  const base = HEALTH[health];

  // The three tooltips that can only be written with the step in hand.
  if (health === 'answered') return { ...base, title: node.resolution ?? undefined };
  if (health === 'blocked') return { ...base, title: node.comment ?? undefined };
  if (health === 'waiting') {
    return {
      ...base,
      title: `Waits on ${node.waitingOn.map((ref) => `#${ref.number} ${ref.title}`).join(', ')}`,
    };
  }
  return base;
}

/**
 * A module's steps, counted by state, as dots beside its heading.
 *
 * The progress bar next to this answers "how far through", which is one
 * number and hides the shape of what is left: eleven not-started steps and
 * eleven unanswered questions are the same bar and are not the same module.
 * A dot per state with its count says which, without the section being
 * opened -- and it survives the fold, which is the point (law 10).
 *
 * Only states that are actually present get a dot. A row of zeroes is noise,
 * and a "0 blocked" is a fact nobody needed (law 1). The count is the label:
 * the word is on the dot's tooltip and in its accessible name, because eight
 * spelled-out states would be a paragraph where a glance was asked for.
 */
function SectionTally({ tally, label }: { tally: PlanTally; label: string }) {
  const present = PLAN_HEALTHS.filter((health) => tally[health] > 0);
  if (present.length === 0) return null;

  return (
    <span className="flex items-center gap-2.5" aria-label={`${label} by state`}>
      {present.map((health) => (
        <span
          key={health}
          className="flex items-center gap-1"
          title={`${tally[health]} ${HEALTH[health].word.toLowerCase()}`}
        >
          <span className={cn('size-2 shrink-0 rounded-full', TONE_DOT[HEALTH[health].tone])} aria-hidden />
          <span className="tabular text-small text-ink-muted">{tally[health]}</span>
          <span className="sr-only">{HEALTH[health].word}</span>
        </span>
      ))}
    </span>
  );
}

const TONE_TEXT: Record<Health['tone'], string> = {
  quiet: 'text-ink-muted',
  ghost: 'text-ink-ghost',
  accent: 'text-accent',
  positive: 'text-positive',
  caution: 'text-caution',
};

const TONE_DOT: Record<Health['tone'], string> = {
  quiet: 'bg-ink-ghost',
  ghost: 'bg-ink-ghost',
  accent: 'bg-accent',
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
const ROW_GRID =
  'grid grid-cols-[minmax(0,1fr)_7.25rem_2rem] items-center gap-x-2 ' +
  'sm:grid-cols-[minmax(0,1fr)_7.25rem_5.5rem_6rem_8rem]';

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
}: {
  node: PlanNode;
  /** One entry per level above: whether that level's line carries on below this row. */
  trail: readonly boolean[];
  catalog: readonly PlanCatalogEntry[];
  canSend: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [addingChild, setAddingChild] = useState(false);
  const [answering, setAnswering] = useState(false);
  const [showChildren, setShowChildren] = useState(() => !isClosed(node.status));

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
  // The same rope pulled the other way: re-read this feature against what has
  // been answered beneath it, and propose what has changed.
  const [reshapeState, reshapeAction, reshapePending] = useActionState(
    reshapePlanFeature,
    {} as PlanActionState,
  );

  // A question beneath a step is that step's question, and it is read and
  // answered in the step's own questions section. It is deliberately not also a
  // row in the tree: the same question in two places, one of which can answer
  // it, is how you end up answering neither. A decision at the top of a module
  // is nobody's question but its own and stays a row.
  const questions = node.children.filter((child) => child.kind === 'decision');
  const substeps = node.children.filter((child) => child.kind !== 'decision');
  const unanswered = questions.filter((question) => !isClosed(question.status)).length;

  const hasChildren = substeps.length > 0;
  const descendants = flatten([node]).length - 1;
  const closed = isClosed(node.status);
  const isDecision = node.kind === 'decision';
  const health = healthOf(node);
  const HealthIcon = health.icon;

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

  // The open steps beneath this one, which a hand-over covers as well. Said in
  // the label rather than found out afterwards.
  const openBeneath = flatten([node]).filter(
    (step) => step.id !== node.id && !isClosed(step.status),
  ).length;
  const beneath = openBeneath > 0 ? `, with ${openBeneath} beneath` : '';
  const handOver = node.assignee !== 'claude';
  const assignLabel = handOver
    ? `Hand to Claude${beneath}`
    : `Take back from Claude${beneath}`;

  const menu: ActionMenuItem[] = [
    {
      // First, because marking a step as Claude's is the move this page exists
      // to make and it should not need the step opened first.
      id: 'assign',
      label: assignLabel,
      formAction: (formData: FormData) => setPlanItemAssignee({}, formData),
      formFields: { id: node.id, assignee: handOver ? 'claude' : '' },
    },
    // The quick icons are only there from sm up and only under a pointer, so
    // the menu carries the same two actions for a phone and for a keyboard.
    ...(closed
      ? []
      : [
          {
            id: 'send',
            label: 'Send to Claude',
            formAction: (formData: FormData) => sendPlanItemToClaude({}, formData),
            formFields: { id: node.id },
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
      <li
        className={cn(
          ROW_GRID,
          'group px-3',
          gloss && !open ? 'py-1.5' : 'py-2',
          !node.matches && 'opacity-60',
          closed && 'opacity-70',
        )}
      >
        <div className="flex min-w-0 items-stretch">
          <TreeGuides trail={trail} />

          {/* The fold for the sub-steps. A spacer where there are none, so the
              titles at one depth line up. */}
          {hasChildren ? (
            <button
              type="button"
              onClick={() => setShowChildren((value) => !value)}
              aria-expanded={showChildren}
              title={
                showChildren
                  ? `Fold the ${substeps.length} sub-steps`
                  : `Unfold the ${substeps.length} sub-steps`
              }
              aria-label={showChildren ? 'Hide the sub-steps' : 'Show the sub-steps'}
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
              <span className="tabular shrink-0 text-small text-ink-ghost">#{node.number}</span>
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
              {/* Whose it is, on the row.
                * The "Who" column was dropped for being a column of dashes,
                * and it was right to go -- but with it went any way of seeing
                * that a step is Claude's without opening it, hovering it, or
                * switching to the Claude's view. Handing a step over is the
                * move this page exists to make, and the page said nothing
                * about the result. A mark, not a column: it appears only on
                * the steps that have been handed over, which is what makes it
                * worth reading. */}
              {node.assignee === 'claude' && (
                <span
                  title="Handed to Claude"
                  className="inline-flex shrink-0 items-center rounded-full bg-accent-tint px-1 py-0.5 text-accent"
                >
                  <CircleUser className="size-3" strokeWidth={2} aria-hidden />
                  <span className="sr-only">Handed to Claude</span>
                </span>
              )}
              {/* And how long it has been going.
                * "In progress" in the health column is a state; this is the
                * thing you actually want to know about a step Claude is on --
                * whether it started four minutes ago or has been sitting at
                * "in progress" since yesterday, which is what a stuck routine
                * looks like from here. The dot pulses because the one fact it
                * carries is that something is happening right now. */}
              {node.status === 'in_progress' && node.startedAt && (
                <span
                  title={`${node.assignee === 'claude' ? 'Claude has been on this' : 'Underway'} since ${node.startedAt.replace('T', ' ').slice(0, 16)}`}
                  className="tabular inline-flex shrink-0 items-center gap-1 rounded-full bg-accent-tint px-1.5 py-0.5 text-small font-medium text-accent"
                >
                  <span className="size-1.5 animate-pulse rounded-full bg-accent" aria-hidden />
                  <Elapsed startedAt={node.startedAt} />
                </span>
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
            <span className="inline-flex items-center gap-1.5" title={health.title}>
              <HealthIcon className="size-3.5 shrink-0" strokeWidth={2} aria-hidden />
              <span className="truncate">{health.word}</span>
            </span>
          }
        />

        <span className="hidden truncate text-small sm:block">
          {node.priority === 1 && <span className="text-accent">Next</span>}
          {node.priority === 2 && <span className="text-ink-muted">Normal</span>}
          {node.priority === 3 && <span className="text-ink-ghost">Someday</span>}
          {node.size && (
            <span className="text-ink-muted" title={SIZE_LABEL[node.size]}>
              {' · '}
              {node.size.toUpperCase()}
            </span>
          )}
        </span>

        {/* No "Who" column. It was a column of dashes with the occasional
            "Claude" in it -- one fact, on a plan whose every step is yours
            unless you hand it over, and handing it over is a button. The one
            value it carried is now a mark beside the title, on the steps that
            have it; the rest is on the open step, in the summary's "Claude's"
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
            {!closed && (
              <form action={sendAction}>
                <input type="hidden" name="id" value={node.id} />
                <RowIconButton type="submit" label="Send to Claude" pending={sendPending}>
                  <Play className="size-3.5" strokeWidth={1.75} aria-hidden />
                </RowIconButton>
              </form>
            )}
            <form action={assignAction}>
              <input type="hidden" name="id" value={node.id} />
              <input type="hidden" name="assignee" value={handOver ? 'claude' : ''} />
              <RowIconButton type="submit" label={assignLabel} pending={assignPending}>
                <CircleUser
                  className={cn('size-3.5', !handOver && 'text-accent')}
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
          is most steps most of the time. */}
      {node.fog && (
        <li style={inset} className="pb-1.5 pr-3">
          <div className="border-l-2 border-dashed border-border-strong pl-2.5">
            <p className="text-micro font-semibold uppercase tracking-wide text-ink-ghost">
              Not yet specified
            </p>
            <p className="whitespace-pre-wrap text-small text-ink-muted">{node.fog}</p>
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
                twice -- once as a paragraph here and once as itself. */}
            {node.detail && !isDecision && (
              <p className="whitespace-pre-wrap text-ui text-ink-muted">{node.detail}</p>
            )}
            {node.acceptance && (
              <div>
                <p className="text-small font-semibold uppercase tracking-wide text-ink-muted">Done when</p>
                <p className="whitespace-pre-wrap text-ui text-ink">{node.acceptance}</p>
              </div>
            )}
            {node.comment && (
              <p className="whitespace-pre-wrap rounded-lg bg-canvas px-3 py-2 text-ui text-ink">
                {node.comment}
              </p>
            )}

            {isDecision && (
              <AnswerDecision
                node={node}
                action={answerAction}
                pending={answerPending}
                autoFocus={answering}
              />
            )}

            <Questions node={node} />

            <Dependencies node={node} catalog={catalog} />

            <p className="flex flex-wrap gap-x-3 text-small text-ink-muted">
              <span>{scopeLabel(node.module)}</span>
              <span>{PRIORITY_LABEL[node.priority]}</span>
              {node.size && <span>{SIZE_LABEL[node.size]}</span>}
              {node.assignee && <span>{ASSIGNEE_LABEL[node.assignee]}</span>}
              {when(node.startedAt) && (
                <span>
                  Started {when(node.startedAt)}
                  {node.status === 'in_progress' && node.startedAt && (
                    <>
                      {' · running '}
                      <Elapsed startedAt={node.startedAt} />
                    </>
                  )}
                </span>
              )}
              {when(node.completedAt) && (
                <span>
                  {node.status === 'dropped' ? 'Dropped' : 'Done'} {when(node.completedAt)}
                </span>
              )}
              {node.commitSha && <span className="font-mono">{node.commitSha}</span>}
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
                <input
                  type="hidden"
                  name="assignee"
                  value={node.assignee === 'claude' ? '' : 'claude'}
                />
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

export function PlanView({
  sections,
  summary,
  view,
  catalog,
  empty,
  canSend,
  queued,
}: {
  sections: PlanSection[];
  summary: PlanSummary;
  view: View;
  catalog: PlanCatalogEntry[];
  empty: boolean;
  canSend: boolean;
  queued: number;
}) {
  if (empty) return <ImportTheBuildOrder />;

  const nothingToShow = sections.every((section) => section.nodes.length === 0);

  return (
    <div className="space-y-6">
      <SummaryStrip summary={summary} view={view} queued={queued} />

      {nothingToShow && EMPTY_VIEW[view] && (
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
          the right distance is smaller than that. */}
      <div className="space-y-3">
        {sections.map((section) => {
          // What is finished is consulted, not read -- the same call the rows
          // make about a closed step's children. The progress stays on the
          // summary line either way, so a folded module still says how far it
          // got: law 10, a fold that hides its own count has moved the work.
          const finished = section.progress.live > 0 && section.progress.fraction === 1;

          return (
            <details
              key={section.module ?? 'app'}
              open={!finished}
              className="group/section space-y-2"
            >
              <summary
                className={cn(
                  'press flex cursor-pointer list-none flex-wrap items-center justify-between gap-2',
                  'rounded-card [&::-webkit-details-marker]:hidden',
                  'focus-visible:outline-2 focus-visible:outline-offset-2',
                  // Closed, a section is a shut drawer with a ground of its own.
                  // It was a bare line of text sitting in a large gap, which read
                  // as a heading somebody had forgotten to put anything under.
                  // Open, the list beneath it is the object on the page, so the
                  // header stands back down to being a heading.
                  'bg-sunken px-3 py-2.5',
                  'group-open/section:bg-transparent group-open/section:px-0 group-open/section:py-1',
                )}
              >
                <h2 className="flex items-center gap-2 text-lead font-semibold text-ink">
                  <ChevronRight
                    aria-hidden
                    strokeWidth={2}
                    className="size-4 shrink-0 text-ink-muted transition-transform duration-150 group-open/section:rotate-90"
                  />
                  {section.label}
                </h2>
                <span className="flex flex-wrap items-center gap-x-4 gap-y-1">
                  <SectionTally tally={section.tally} label={section.label} />
                  <Progress label={section.label} progress={section.progress} />
                </span>
              </summary>

              <div className="space-y-2">
                {section.nodes.length === 0 ? (
                  <p className={cn(cardVariants({ padding: 'standard' }), 'border-dashed text-center text-ui text-ink-muted')}>
                    {finished
                      ? `Everything planned for ${section.label} is done.`
                      : `No plan for ${section.label} yet.`}
                  </p>
                ) : (
                  <ul className={cn(cardVariants({ padding: 'none' }), 'divide-y divide-border')}>
                    <ColumnHeader />
                    {section.nodes.map((node) => (
                      <PlanRow
                        key={node.id}
                        node={node}
                        trail={[]}
                        catalog={catalog}
                        canSend={canSend}
                      />
                    ))}
                  </ul>
                )}

                {(view === 'open' || view === 'all') && (
                  <AddStep module={section.module} parentId={null} />
                )}
              </div>
            </details>
          );
        })}
      </div>

      {/* The app-wide list is not offered as a section until something is in
          it, so this is the only way to put the first thing there. */}
      {(view === 'open' || view === 'all') &&
        !sections.some((section) => section.module === null) && (
          <section className="space-y-2">
            <h2 className="text-body font-semibold text-ink">The app as a whole</h2>
            <AddStep module={null} parentId={null} />
          </section>
        )}
    </div>
  );
}
