'use client';

import { useActionState, useEffect, useRef } from 'react';
import { Circle, CircleUser, Flag, Scale } from 'lucide-react';
import { updatePlanItem, type PlanActionState } from './actions';
import { Button } from '@/components/ui/button';
import { useCaptureAim } from '@/components/shell/capture-aim';
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
import { useSettled } from '@/components/plan-tree/use-settled';
import { useScopeLabel } from './scope-labels';

/**
 * The edit form for a plan step, the add that opens capture, and the labels they share.
 */

export const STATUS_LABEL = PLAN_STATUS_LABEL;

export const SIZE_LABEL: Record<PlanSize, string> = { s: 'Small', m: 'Medium', l: 'Large' };
export const ASSIGNEE_LABEL: Record<PlanAssignee, string> = { me: 'Me' };


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
export function PrioritySelect({ defaultValue, id }: { defaultValue: PlanPriority; id?: string }) {
  return (
    <ChipSelect
      id={id}
      name="priority"
      defaultValue={String(defaultValue)}
      aria-label="Priority"
      icon={<Flag className="size-3.5" strokeWidth={1.75} />}
    >
      {PLAN_PRIORITIES.map((priority) => (
        <option key={priority} value={priority}>
          {PLAN_PRIORITY_LABEL[priority]}
        </option>
      ))}
    </ChipSelect>
  );
}

export function SizeSelect({ defaultValue, id }: { defaultValue: PlanSize | null; id?: string }) {
  return (
    <ChipSelect
      id={id}
      name="size"
      defaultValue={defaultValue ?? ''}
      placeholderValue=""
      aria-label="Size"
      icon={<Scale className="size-3.5" strokeWidth={1.75} />}
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

export function AssigneeSelect({ defaultValue, id }: { defaultValue: PlanAssignee | null; id?: string }) {
  return (
    <ChipSelect
      id={id}
      name="assignee"
      defaultValue={defaultValue ?? ''}
      placeholderValue=""
      aria-label="Who is on it"
      icon={<CircleUser className="size-3.5" strokeWidth={1.75} />}
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
      icon={<Circle className="size-3.5" strokeWidth={1.75} />}
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
 * It shows everything, because you opened it to change something and which
 * thing is not knowable. A new step is made through capture (`AddStep`).
 */
function StepFields({
  prefix,
  node,
  status,
}: {
  prefix: string;
  node?: Pick<PlanNode, 'title' | 'detail' | 'acceptance' | 'priority' | 'size' | 'assignee'>;
  /** Rendered into the chip row when the surface owns the status too. */
  status?: PlanStatus;
}) {
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

      {/* ui-ok: composer-always-open -- StepFields renders only inside EditStep,
       * once a row's Edit has been pressed; the rule cannot see that gate. */}
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
        {/* ui-ok: composer-always-open -- the same Edit surface as above. */}
        <ComposeBody
          id={`${prefix}-acceptance`}
          name="acceptance"
          rows={1}
          defaultValue={node?.acceptance ?? ''}
          aria-label="Done when"
          placeholder="Done when… — what the work is checked against"
        />
      </div>

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
 * A row of your own under a feature or a step, made through capture (plan
 * #1950.5).
 *
 * The row's Add a step (or substep) sets this rendering, and rendering it
 * opens capture aimed at a step under that row and hands the row back:
 * capture's panel is where the title is typed, one press makes the step, and
 * its page opens for the rest. Outside the shell (the gallery) there is no
 * capture to open, and it draws nothing.
 */
export function AddStep({
  parentId,
  parentTitle,
  onDone,
}: {
  parentId: string;
  /** The row it goes under, as the panel names it: "Under …". */
  parentTitle: string;
  onDone?: () => void;
}) {
  const aim = useCaptureAim();
  // Once per press: the row hands this back in onDone, which unmounts it.
  const asked = useRef(false);
  useEffect(() => {
    if (asked.current) return;
    asked.current = true;
    aim?.({ kind: 'plan-step', under: { id: parentId, title: parentTitle } });
    onDone?.();
  }, [aim, onDone, parentId, parentTitle]);
  return null;
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
  const scopeLabel = useScopeLabel();

  const excluded = subtreeOf(catalog, node.id);
  const parents = catalog.filter(
    (entry) => entry.module === node.module && !excluded.has(entry.id),
  );
  const prefix = `edit-${node.id}`;

  return (
    <form action={action} className="flex flex-col gap-(--field-gap) px-3 pb-3">
      <input type="hidden" name="id" value={node.id} />
      <StepFields prefix={prefix} node={node} status={node.status} />
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
