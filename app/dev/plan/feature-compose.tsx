'use client';

import { useActionState } from 'react';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { AddTrigger } from '@/components/ui/add-trigger';
import { cardVariants } from '@/components/ui/card';
import { ComposeBody, FieldError } from '@/components/ui/field';
import { useSettled } from '@/components/plan-tree/use-settled';
import { useCaptureAim } from '@/components/shell/capture-aim';
import type { CaptureAim } from '@/lib/capture/actions';
import { cn } from '@/lib/cn';
import { planScopeLabel, type PlanScope } from '@/lib/plan/projects';
import type { PlanNode } from '@/lib/plan/tree';
import { updateFeature, type PlanActionState } from './actions';
import { AssigneeSelect, PrioritySelect, SizeSelect } from './step-forms';

/**
 * Editing a feature, in one compose surface (plan #1670).
 *
 * The title large, a one-line summary under it, the properties as a row of
 * chips, then the free description and what it is checked against: the same
 * compose surface and chips a step is written in (`StepFields` in
 * step-forms.tsx), with the summary added, since a feature is the row the
 * page is about. It opens filled in on the feature's page. A new feature is
 * made through capture (plan #1950.5) and written here once it exists. The
 * module is the page's crumb and not offered, because moving a feature to
 * another module moves every step beneath it, which is the row's Move.
 */
export function FeatureCompose({
  node,
  onDone,
  className,
}: {
  /** The feature being edited. */
  node: Pick<PlanNode, 'id' | 'title' | 'summary' | 'detail' | 'acceptance' | 'priority' | 'size' | 'assignee'>;
  onDone: () => void;
  className?: string;
}) {
  const [state, action, pending] = useActionState<PlanActionState, FormData>(updateFeature, {});
  useSettled(state, onDone);

  const prefix = `feature-${node.id}`;

  return (
    <form
      action={action}
      aria-label="Edit the feature"
      className={cn(cardVariants({ padding: 'dense' }), 'flex flex-col gap-2', className)}
    >
      <input type="hidden" name="id" value={node.id} />
      {/* The title in a box that wraps, at the size of a page title: a
       * feature's name runs to two lines, and a one-line input scrolled the
       * start of it out of sight. Enter writes no second line. */}
      {/* ui-ok: composer-always-open -- the same surface as the summary below. */}
      <ComposeBody
        id={`${prefix}-title`}
        name="title"
        rows={1}
        defaultValue={node.title ?? ''}
        autoFocus
        required
        maxLength={200}
        aria-label="The feature"
        placeholder="Feature name"
        className="font-medium text-title max-sm:-my-2.5 max-sm:py-2.5 sm:text-title"
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.preventDefault();
        }}
      />
      {/* ui-ok: composer-always-open -- FeatureCompose renders only once Edit
       * has been pressed; the gate is on the feature page, where the rule
       * cannot see it. */}
      <ComposeBody
        id={`${prefix}-summary`}
        name="summary"
        // A finger's height on a phone, from padding a negative margin takes back.
        className="max-sm:-my-2.5 max-sm:py-2.5"
        rows={1}
        maxLength={200}
        defaultValue={node.summary ?? ''}
        aria-label="Summary"
        placeholder="One line on what it is for…"
        // One line: Enter would write a second.
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.preventDefault();
        }}
      />

      {/* One row at 390 too: four chips at their usual inset wrapped the
       * last one onto a line of its own, so on a phone they sit closer. Each
       * select is a finger's size there (44px), from padding a negative
       * margin takes back, so nothing is drawn bigger. */}
      <div className="flex flex-wrap items-center gap-0.5 py-1 max-sm:*:gap-1 max-sm:*:px-0.5 max-sm:[&_select]:-mx-2.5 max-sm:[&_select]:-my-3 max-sm:[&_select]:px-2.5 max-sm:[&_select]:py-3 sm:gap-1">
        <PrioritySelect id={`${prefix}-priority`} defaultValue={node.priority ?? 2} />
        <SizeSelect id={`${prefix}-size`} defaultValue={node.size ?? null} />
        <AssigneeSelect id={`${prefix}-assignee`} defaultValue={node.assignee ?? null} />
      </div>

      <div className="space-y-2 border-t border-border pt-2">
        {/* ui-ok: composer-always-open -- the same surface as the summary above. */}
        <ComposeBody
          id={`${prefix}-detail`}
          name="detail"
          rows={3}
          defaultValue={node.detail ?? ''}
          aria-label="Description"
          placeholder="Describe it: what it involves, what is already there, what is unsure…"
        />
      </div>
      {/* Under a rule of its own, so a filled-in done-when does not read as
       * the description's last paragraph. */}
      <div className="border-t border-border pt-2">
        {/* ui-ok: composer-always-open -- the same surface as the summary above. */}
        <ComposeBody
          id={`${prefix}-acceptance`}
          name="acceptance"
          rows={1}
          defaultValue={node.acceptance ?? ''}
          aria-label="Done when"
          placeholder="Done when… what the finished feature is checked against"
        />
      </div>

      {/* Actions right, on their own line under a rule, as on a step: the
       * chips are things you set and this is the one thing you press. */}
      <div className="mt-1 flex flex-wrap items-center gap-2 border-t border-border pt-2">
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

/** What capture is aimed at for a feature in `module`: the module when there is one. */
function featureAim(module: PlanScope | null): CaptureAim {
  return module
    ? { kind: 'plan-feature', under: { id: module, title: planScopeLabel(module) } }
    : { kind: 'plan-feature' };
}

/**
 * "New feature" in the plan's header (plan #1950.5): capture aimed at a
 * feature, in the project's module on a project's plan and for the app as a
 * whole otherwise. One press makes it and opens its page, where the summary,
 * the description and the done-when are written.
 */
export function NewFeatureButton({ module = null }: { module?: PlanScope | null }) {
  const aim = useCaptureAim();
  return (
    <Button type="button" variant="secondary" size="sm" onClick={() => aim?.(featureAim(module))}>
      <Plus className="size-3.5" strokeWidth={1.75} aria-hidden />
      New feature
    </Button>
  );
}

/** "Add a feature" at the foot of a module's section: capture aimed at a feature there. */
export function AddFeature({ module }: { module: PlanScope | null }) {
  return <AddTrigger label="Add a feature" aim={featureAim(module)} />;
}
