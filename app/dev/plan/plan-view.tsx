'use client';

import { useActionState, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ChevronDown, Play, X } from 'lucide-react';
import {
  addPlanDependency,
  addPlanItem,
  deletePlanItem,
  movePlanItem,
  removePlanDependency,
  seedPlan,
  sendPlanItemToClaude,
  setPlanItemAssignee,
  setPlanItemStatus,
  updatePlanItem,
  type PlanActionState,
} from './actions';
import { ActionMenu, type ActionMenuItem } from '@/components/ui/action-menu';
import { Button } from '@/components/ui/button';
import { cardVariants } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { FieldError, FieldHint, Input, Label, Select, Textarea } from '@/components/ui/field';
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
  PLAN_VIEWS,
  PLAN_VIEW_LABEL,
  flatten,
  type PlanNode,
  type PlanProgress,
  type PlanSection,
  type PlanSummary,
  type PlanView as View,
} from '@/lib/plan/tree';
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
  not_started: 'Not started',
  in_progress: 'In progress',
  blocked: 'Blocked',
  done: 'Done',
  dropped: 'Dropped',
};

// The tint tokens rather than colour/10, for the reason the notes list gives:
// the tints are tuned per theme, and 10% alpha over a dark surface is not the
// same thing as a tint.
const STATUS_STYLE: Record<PlanStatus, string> = {
  not_started: 'bg-canvas text-ink-muted',
  in_progress: 'bg-accent-tint text-accent',
  blocked: 'bg-caution-tint text-caution',
  done: 'bg-positive-tint text-positive',
  dropped: 'bg-canvas text-ink-ghost line-through',
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

function PrioritySelect({ defaultValue, id }: { defaultValue: PlanPriority; id?: string }) {
  return (
    <Select id={id} name="priority" defaultValue={String(defaultValue)} aria-label="Priority">
      {PLAN_PRIORITIES.map((priority) => (
        <option key={priority} value={priority}>
          {PRIORITY_LABEL[priority]}
        </option>
      ))}
    </Select>
  );
}

function SizeSelect({ defaultValue, id }: { defaultValue: PlanSize | null; id?: string }) {
  return (
    <Select id={id} name="size" defaultValue={defaultValue ?? ''} aria-label="Size">
      <option value="">Size not said</option>
      {PLAN_SIZES.map((size) => (
        <option key={size} value={size}>
          {SIZE_LABEL[size]}
        </option>
      ))}
    </Select>
  );
}

function AssigneeSelect({ defaultValue, id }: { defaultValue: PlanAssignee | null; id?: string }) {
  return (
    <Select id={id} name="assignee" defaultValue={defaultValue ?? ''} aria-label="Who is on it">
      <option value="">Nobody yet</option>
      {PLAN_ASSIGNEES.map((assignee) => (
        <option key={assignee} value={assignee}>
          {ASSIGNEE_LABEL[assignee]}
        </option>
      ))}
    </Select>
  );
}

/** A small fact on a row: the priority, the size, who holds it. */
function Chip({
  tone = 'quiet',
  children,
  title,
}: {
  tone?: 'quiet' | 'accent' | 'positive' | 'caution';
  children: React.ReactNode;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-micro font-semibold uppercase tracking-wide',
        tone === 'quiet' && 'bg-canvas text-ink-muted',
        tone === 'accent' && 'bg-accent-tint text-accent',
        tone === 'positive' && 'bg-positive-tint text-positive',
        tone === 'caution' && 'bg-caution-tint text-caution',
      )}
    >
      {children}
    </span>
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
      <span
        className="h-1.5 w-24 overflow-hidden rounded-full bg-canvas"
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
function SummaryStrip({ summary, view }: { summary: PlanSummary; view: View }) {
  const facts: Array<{ view: View | null; value: number; noun: string }> = [
    { view: 'open', value: summary.open, noun: 'open' },
    { view: 'ready', value: summary.ready, noun: 'ready' },
    { view: 'blocked', value: summary.waiting, noun: 'waiting' },
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

/** The fields every step has, for the add and the edit form alike. */
function StepFields({
  prefix,
  node,
}: {
  prefix: string;
  node?: Pick<PlanNode, 'title' | 'detail' | 'acceptance' | 'priority' | 'size' | 'assignee'>;
}) {
  return (
    <>
      <div>
        <Label htmlFor={`${prefix}-title`}>The step</Label>
        <Input
          id={`${prefix}-title`}
          name="title"
          defaultValue={node?.title ?? ''}
          autoFocus
          placeholder="What has to happen"
        />
      </div>
      <div>
        <Label htmlFor={`${prefix}-detail`}>What it involves</Label>
        <Textarea
          id={`${prefix}-detail`}
          name="detail"
          rows={3}
          className="min-h-16"
          defaultValue={node?.detail ?? ''}
        />
      </div>
      <div>
        <Label htmlFor={`${prefix}-acceptance`}>Done when</Label>
        <Textarea
          id={`${prefix}-acceptance`}
          name="acceptance"
          rows={2}
          className="min-h-12"
          defaultValue={node?.acceptance ?? ''}
          placeholder="What the work is checked against. Written before the work, it is what makes “done” a fact."
        />
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <div>
          <Label htmlFor={`${prefix}-priority`}>Priority</Label>
          <PrioritySelect id={`${prefix}-priority`} defaultValue={node?.priority ?? 2} />
        </div>
        <div>
          <Label htmlFor={`${prefix}-size`}>Size</Label>
          <SizeSelect id={`${prefix}-size`} defaultValue={node?.size ?? null} />
        </div>
        <div>
          <Label htmlFor={`${prefix}-assignee`}>Who is on it</Label>
          <AssigneeSelect id={`${prefix}-assignee`} defaultValue={node?.assignee ?? null} />
        </div>
      </div>
    </>
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
        className="press w-full rounded-card border border-dashed border-border bg-surface py-2 text-center text-ui text-ink-muted hover:border-accent hover:text-accent"
      >
        {parentId ? 'Add a sub-step' : 'Add a step'}
      </button>
    );
  }

  return (
    <form action={action} className={cn(cardVariants({ padding: 'dense' }), 'space-y-2')}>
      <input type="hidden" name="module" value={module ?? ''} />
      <input type="hidden" name="parent" value={parentId ?? ''} />
      <StepFields prefix={prefix} />
      <div className="flex flex-wrap items-center gap-2">
        <Select name="status" defaultValue="not_started" className="w-36" aria-label="Status">
          <StatusOptions />
        </Select>
        <Button type="submit" size="sm" pending={pending}>
          {pending ? 'Adding…' : parentId ? 'Add sub-step' : 'Add step'}
        </Button>
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
        <FieldError>{state.error}</FieldError>
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
    <form action={action} className="space-y-2 px-3 pb-3">
      <input type="hidden" name="id" value={node.id} />
      <StepFields prefix={prefix} node={node} />
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
      <div className="flex flex-wrap items-center gap-2">
        <Select name="status" defaultValue={node.status} className="w-36" aria-label="Status">
          <StatusOptions />
        </Select>
        <Button type="submit" size="sm" pending={pending}>
          {pending ? 'Saving…' : 'Save'}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <FieldError>{state.error}</FieldError>
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
          <Select
            name="depends_on"
            defaultValue=""
            className="h-8 w-auto max-w-xs py-0 text-small"
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
          <Button type="submit" size="sm" variant="ghost" pending={addPending}>
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
function SendToClaude({ node, canSend }: { node: PlanNode; canSend: boolean }) {
  const [state, action, pending] = useActionState(sendPlanItemToClaude, {} as PlanActionState);

  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="id" value={node.id} />
      <Button type="submit" size="sm" variant="secondary" pending={pending}>
        <Play className="size-3.5" aria-hidden />
        {pending ? 'Sending…' : 'Send to Claude'}
      </Button>
      {!canSend && !state.error && !state.message && (
        <span className="text-small text-ink-muted">Needs CLAUDE_API_KEY on the deployment.</span>
      )}
      {state.message && <span className="text-small text-positive">{state.message}</span>}
      <FieldError>{state.error}</FieldError>
    </form>
  );
}

function when(iso: string | null): string | null {
  return iso ? iso.slice(0, 10) : null;
}

/**
 * One step: what it is, where it stands, and what is beneath it.
 *
 * Closed, it is a line -- the status, the number, the title, and the handful
 * of facts that change what gets picked up next. The detail, the acceptance
 * criteria, the note and the dependencies are behind the fold because a plan
 * is read as a list far more often than any one step of it is read in full.
 * Its sub-steps are a list of their own beneath it, folded with the chevron,
 * and the fold starts closed on a step that is finished: what is done is
 * consulted, not read.
 */
function PlanRow({
  node,
  catalog,
  canSend,
}: {
  node: PlanNode;
  catalog: readonly PlanCatalogEntry[];
  canSend: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [addingChild, setAddingChild] = useState(false);
  const [showChildren, setShowChildren] = useState(() => !isClosed(node.status));

  const [statusState, statusAction, statusPending] = useActionState(
    setPlanItemStatus,
    {} as PlanActionState,
  );
  const [assignState, assignAction, assignPending] = useActionState(
    setPlanItemAssignee,
    {} as PlanActionState,
  );

  const hasChildren = node.children.length > 0;
  const hasMore = Boolean(
    node.detail || node.acceptance || node.comment || node.dependsOn.length || node.blocks.length,
  );
  const descendants = flatten([node]).length - 1;
  const closed = isClosed(node.status);

  const menu: ActionMenuItem[] = [
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

  return (
    <li className="flex flex-col">
      <div
        className={cn(
          'flex items-start gap-2 px-3 py-2',
          !node.matches && 'opacity-60',
        )}
      >
        {/* The fold for the sub-steps. A spacer where there are none, so the
            status pickers line up down the list. */}
        {hasChildren ? (
          <button
            type="button"
            onClick={() => setShowChildren((value) => !value)}
            aria-expanded={showChildren}
            aria-label={showChildren ? 'Hide the sub-steps' : 'Show the sub-steps'}
            className="press mt-1.5 flex size-5 shrink-0 items-center justify-center rounded text-ink-muted hover:bg-accent-tint hover:text-accent"
          >
            <ChevronDown
              className={cn('size-3.5 transition-transform duration-150', !showChildren && '-rotate-90')}
              strokeWidth={1.75}
              aria-hidden
            />
          </button>
        ) : (
          <span className="size-5 shrink-0" aria-hidden />
        )}

        {/* The status is a picker rather than a badge you have to open the step
            to change: "where is this" is the question the page exists for, and
            answering it differently should not be a form. */}
        <form action={statusAction} className="shrink-0">
          <input type="hidden" name="id" value={node.id} />
          <Select
            name="status"
            defaultValue={node.status}
            disabled={statusPending}
            aria-label={`Status of #${node.number} ${node.title}`}
            className={cn('h-7 w-30 py-0 text-small', STATUS_STYLE[node.status])}
            onChange={(event) => event.currentTarget.form?.requestSubmit()}
          >
            <StatusOptions />
          </Select>
        </form>

        <div className="min-w-0 flex-1">
          <button
            type="button"
            onClick={() => setOpen((value) => !value)}
            aria-expanded={open}
            className={cn(
              'flex w-full min-w-0 items-baseline gap-1.5 text-left text-ui hover:text-accent',
              node.depth === 0 ? 'font-medium text-ink' : 'text-ink',
            )}
          >
            <span className="tabular shrink-0 text-small text-ink-ghost">#{node.number}</span>
            <span className={cn('min-w-0', node.status === 'dropped' && 'text-ink-muted line-through')}>
              {node.title}
            </span>
          </button>

          <div className="mt-0.5 flex flex-wrap items-center gap-1">
            {node.priority === 1 && <Chip tone="accent">Next</Chip>}
            {node.priority === 3 && <Chip>Someday</Chip>}
            {node.size && <Chip title={SIZE_LABEL[node.size]}>{node.size}</Chip>}
            {node.assignee === 'claude' && <Chip tone="accent">Claude</Chip>}
            {node.ready && !closed && <Chip tone="positive">Ready</Chip>}
            {node.waitingOn.length > 0 && !closed && (
              <Chip
                tone="caution"
                title={node.waitingOn.map((ref) => `#${ref.number} ${ref.title}`).join(', ')}
              >
                Waits on #{node.waitingOn[0].number}
                {node.waitingOn.length > 1 && ` +${node.waitingOn.length - 1}`}
              </Chip>
            )}
            {hasChildren && node.rollup.live > 0 && (
              <span className="tabular text-small text-ink-muted">
                {node.rollup.done}/{node.rollup.live} steps
              </span>
            )}
            {node.comment && !open && <span className="text-small text-ink-muted">· noted</span>}
            {hasMore && !open && !node.comment && (
              <span className="text-small text-ink-ghost">· more</span>
            )}
          </div>
        </div>

        <ActionMenu label={`Actions for #${node.number}`} items={menu} className="-mr-1" />
      </div>

      <FieldError>{statusState.error ?? assignState.error}</FieldError>

      {editing ? (
        <EditStep node={node} catalog={catalog} onDone={() => setEditing(false)} />
      ) : (
        open && (
          <div className="space-y-3 px-3 pb-3 pl-10">
            {node.detail && <p className="whitespace-pre-wrap text-ui text-ink-muted">{node.detail}</p>}
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

            <Dependencies node={node} catalog={catalog} />

            <p className="flex flex-wrap gap-x-3 text-small text-ink-muted">
              <span>{scopeLabel(node.module)}</span>
              <span>{PRIORITY_LABEL[node.priority]}</span>
              {node.size && <span>{SIZE_LABEL[node.size]}</span>}
              {node.assignee && <span>{ASSIGNEE_LABEL[node.assignee]}</span>}
              {when(node.startedAt) && <span>Started {when(node.startedAt)}</span>}
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
                  {node.assignee === 'claude' ? 'Take back from Claude' : 'Hand to Claude'}
                </Button>
              </form>
              {!closed && <SendToClaude node={node} canSend={canSend} />}
            </div>
          </div>
        )
      )}

      {(hasChildren || addingChild) && showChildren && (
        <div className="ml-7 border-l border-border pl-1">
          {hasChildren && (
            <ul className="divide-y divide-border">
              {node.children.map((child) => (
                <PlanRow key={child.id} node={child} catalog={catalog} canSend={canSend} />
              ))}
            </ul>
          )}
          {addingChild && (
            <div className="px-3 py-2">
              <AddStep
                module={node.module}
                parentId={node.id}
                open
                onDone={() => setAddingChild(false)}
              />
            </div>
          )}
        </div>
      )}
    </li>
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
}: {
  sections: PlanSection[];
  summary: PlanSummary;
  view: View;
  catalog: PlanCatalogEntry[];
  empty: boolean;
  canSend: boolean;
}) {
  if (empty) return <ImportTheBuildOrder />;

  const nothingToShow = sections.every((section) => section.nodes.length === 0);

  return (
    <div className="space-y-6">
      <SummaryStrip summary={summary} view={view} />

      {nothingToShow && view !== 'open' && view !== 'all' && (
        <EmptyState
          tone="finished"
          title={`Nothing ${view === 'ready' ? 'ready' : view === 'blocked' ? 'waiting' : "of Claude's"} right now`}
          description={
            view === 'ready'
              ? 'Every open step is underway, blocked, or waiting on another. Finish one and the next becomes ready.'
              : view === 'blocked'
                ? 'Nothing is blocked and nothing waits on another step.'
                : 'Hand a step to Claude from its menu, or send one straight to the routine.'
          }
          seed={`plan-${view}`}
        />
      )}

      {sections.map((section) => (
        <section key={section.module ?? 'app'} className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-body font-semibold text-ink">{section.label}</h2>
            <Progress label={section.label} progress={section.progress} />
          </div>

          {section.nodes.length === 0 ? (
            <p className="rounded-card border border-dashed border-border bg-surface px-4 py-4 text-center text-ui text-ink-muted">
              {section.progress.live > 0 && section.progress.fraction === 1
                ? `Everything planned for ${section.label} is done.`
                : `No plan for ${section.label} yet.`}
            </p>
          ) : (
            <ul className={cn(cardVariants({ padding: 'none' }), 'divide-y divide-border')}>
              {section.nodes.map((node) => (
                <PlanRow key={node.id} node={node} catalog={catalog} canSend={canSend} />
              ))}
            </ul>
          )}

          {(view === 'open' || view === 'all') && <AddStep module={section.module} parentId={null} />}
        </section>
      ))}

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
