'use client';

import { useActionState, useState } from 'react';
import { Circle, CircleUser, Flag, Scale } from 'lucide-react';
import { addPlanItem, updatePlanItem, type PlanActionState } from './actions';
import { Button } from '@/components/ui/button';
import { AddTrigger } from '@/components/ui/add-trigger';
import { cardVariants } from '@/components/ui/card';
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
  PLAN_PRIORITY_LABEL,
  PLAN_SIZES,
  PLAN_STATUSES,
  PLAN_STATUS_LABEL,
  type PlanAssignee,
  type PlanPriority,
  type PlanSize,
  type PlanStatus,
} from '@/lib/plan/load';
import type { PlanNode } from '@/lib/plan/tree';
import { catalogLabel, subtreeOf, type PlanCatalogEntry } from './plan-catalog';
import { cn } from '@/lib/cn';
import { useSettled } from '@/components/plan-tree/use-settled';

/**
 * The add and edit forms for a plan step, and the labels they share.
 */

export const STATUS_LABEL = PLAN_STATUS_LABEL;

export const SIZE_LABEL: Record<PlanSize, string> = { s: 'Small', m: 'Medium', l: 'Large' };
export const ASSIGNEE_LABEL: Record<PlanAssignee, string> = { me: 'Me' };

const MODULE_LABEL: Record<ModuleId, string> = Object.fromEntries(
  MODULES.map((module) => [module.id, module.label]),
) as Record<ModuleId, string>;

export function scopeLabel(module: ModuleId | null): string {
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
export function AddStep({
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
export function EditStep({
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
  const parents = catalog.filter(
    (entry) => entry.module === node.module && !excluded.has(entry.id),
  );
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
          Said plainly here rather than filled with plausible steps. Clear it once the steps beneath
          say it.
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
