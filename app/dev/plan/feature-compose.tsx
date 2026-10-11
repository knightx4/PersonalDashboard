'use client';

import { useActionState, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Boxes } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { AddTrigger } from '@/components/ui/add-trigger';
import { cardVariants } from '@/components/ui/card';
import { ChipSelect, ComposeBody, FieldError } from '@/components/ui/field';
import { useSettled } from '@/components/plan-tree/use-settled';
import { cn } from '@/lib/cn';
import { NEW_FEATURE_PARAM, featureHref } from '@/lib/plan/feature-page';
import { PLAN_SCOPES, planScopeLabel, type PlanScope } from '@/lib/plan/projects';
import type { PlanNode } from '@/lib/plan/tree';
import {
  addFeature,
  updateFeature,
  type FeatureActionState,
  type PlanActionState,
} from './actions';
import { AssigneeSelect, PrioritySelect, SizeSelect } from './step-forms';

/**
 * Writing a feature, in one compose surface (plan #1670).
 *
 * The title large, a one-line summary under it, the properties as a row of
 * chips, then the free description and what it is checked against: the same
 * compose surface and chips a step is written in (`StepFields` in
 * step-forms.tsx), with the summary and the module added, since a feature is
 * the row the page is about. The same surface opens filled in when the
 * feature is edited on its page; there the module is the page's crumb and
 * not offered, because moving a feature to another module moves every step
 * beneath it, which is the row's Move, not an edit.
 */

/** Every module a feature can be written into from /dev/plan, the app as a whole first. */
export const FEATURE_SCOPES: readonly (PlanScope | null)[] = [null, ...PLAN_SCOPES];

/** Short enough for a chip: "The app as a whole" is a sentence. */
function chipLabel(scope: PlanScope | null): string {
  return scope ? planScopeLabel(scope) : 'The app';
}

function ModuleSelect({
  defaultValue,
  scopes,
  id,
}: {
  defaultValue: PlanScope | null;
  scopes: readonly (PlanScope | null)[];
  id?: string;
}) {
  return (
    <ChipSelect
      id={id}
      name="module"
      defaultValue={defaultValue ?? ''}
      aria-label="Module"
      icon={<Boxes className="size-3.5" strokeWidth={2} />}
    >
      {scopes.map((scope) => (
        <option key={scope ?? 'app'} value={scope ?? ''}>
          {chipLabel(scope)}
        </option>
      ))}
    </ChipSelect>
  );
}

export function FeatureCompose({
  node,
  module = null,
  scopes,
  onDone,
  onAdded,
  className,
}: {
  /** The feature being edited. Absent: a new one. */
  node?: Pick<
    PlanNode,
    'id' | 'title' | 'summary' | 'detail' | 'acceptance' | 'priority' | 'size' | 'assignee'
  >;
  /** Where a new feature goes, and what the module chip starts on. */
  module?: PlanScope | null;
  /** The modules the chip offers. One or none: no chip, the feature goes in `module`. */
  scopes?: readonly (PlanScope | null)[];
  onDone: () => void;
  /** A new feature landed, with its number. */
  onAdded?: (number: number) => void;
  className?: string;
}) {
  const [state, action, pending] = useActionState<FeatureActionState, FormData>(
    node
      ? (updateFeature as (prev: PlanActionState, data: FormData) => Promise<FeatureActionState>)
      : addFeature,
    {},
  );
  useSettled(state, () => {
    if (!node && state.number) onAdded?.(state.number);
    onDone();
  });

  const prefix = node ? `feature-${node.id}` : `new-feature-${module ?? 'app'}`;
  const chooseModule = !node && scopes !== undefined && scopes.length > 1;

  return (
    <form
      action={action}
      aria-label={node ? 'Edit the feature' : 'New feature'}
      className={cn(cardVariants({ padding: 'dense' }), 'flex flex-col gap-2', className)}
    >
      {node && <input type="hidden" name="id" value={node.id} />}
      {!chooseModule && !node && <input type="hidden" name="module" value={module ?? ''} />}
      {/* The title in a box that wraps, at the size of a page title: a
       * feature's name runs to two lines, and a one-line input scrolled the
       * start of it out of sight. Enter writes no second line. */}
      {/* ui-ok: composer-always-open -- the same surface as the summary below. */}
      <ComposeBody
        id={`${prefix}-title`}
        name="title"
        rows={1}
        defaultValue={node?.title ?? ''}
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
      {/* ui-ok: composer-always-open -- FeatureCompose renders only once New
       * feature, Add a feature or Edit has been pressed; the gate is at the
       * call sites below and on the feature page, where the rule cannot see it. */}
      <ComposeBody
        id={`${prefix}-summary`}
        name="summary"
        // A finger's height on a phone, from padding a negative margin takes back.
        className="max-sm:-my-2.5 max-sm:py-2.5"
        rows={1}
        maxLength={200}
        defaultValue={node?.summary ?? ''}
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
        {chooseModule && (
          <ModuleSelect id={`${prefix}-module`} defaultValue={module} scopes={scopes} />
        )}
        <PrioritySelect id={`${prefix}-priority`} defaultValue={node?.priority ?? 2} />
        <SizeSelect id={`${prefix}-size`} defaultValue={node?.size ?? null} />
        <AssigneeSelect id={`${prefix}-assignee`} defaultValue={node?.assignee ?? null} />
      </div>

      <div className="space-y-2 border-t border-border pt-2">
        {/* ui-ok: composer-always-open -- the same surface as the summary above. */}
        <ComposeBody
          id={`${prefix}-detail`}
          name="detail"
          rows={3}
          defaultValue={node?.detail ?? ''}
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
          defaultValue={node?.acceptance ?? ''}
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
            {node ? (pending ? 'Saving…' : 'Save') : pending ? 'Adding…' : 'Add feature'}
          </Button>
        </div>
      </div>
    </form>
  );
}

/** The line a new feature leaves behind: where it went, and the way to it. */
function Added({ number, onClose }: { number: number; onClose: () => void }) {
  return (
    <p role="status" className="flex flex-wrap items-center gap-x-3 gap-y-1 text-ui text-ink-muted">
      <span>
        Added feature <span className="tabular text-ink">#{number}</span>, last in its module.
      </span>
      <Link
        href={featureHref(number)}
        className="text-ink underline underline-offset-2 hover:text-accent"
      >
        Open it to add steps
      </Link>
      <button
        type="button"
        onClick={onClose}
        className="press rounded-control px-1 text-ink-ghost hover:text-ink-muted"
      >
        Dismiss
      </button>
    </p>
  );
}

/**
 * The surface at the top of /dev/plan that the header's "New feature" opens.
 *
 * Opened by `?new=feature`, which the page reads and passes as `open`, so the
 * header's press is a link and works before the page's JavaScript has loaded;
 * closing it takes the query away again. The gallery passes `open` itself.
 */
export function NewFeature({
  open = false,
  scopes = FEATURE_SCOPES,
  module = null,
}: {
  open?: boolean;
  scopes?: readonly (PlanScope | null)[];
  module?: PlanScope | null;
}) {
  const [added, setAdded] = useState<number | null>(null);

  if (open) {
    return <OpenNewFeature module={module} scopes={scopes} onAdded={setAdded} />;
  }
  if (added !== null) return <Added number={added} onClose={() => setAdded(null)} />;
  return null;
}

/** The open surface, the only part that needs the router: closing it rewrites the address. */
function OpenNewFeature({
  module,
  scopes,
  onAdded,
}: {
  module: PlanScope | null;
  scopes: readonly (PlanScope | null)[];
  onAdded: (number: number) => void;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();

  const close = () => {
    const rest = new URLSearchParams(search.toString());
    rest.delete(NEW_FEATURE_PARAM);
    const query = rest.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  };

  return <FeatureCompose module={module} scopes={scopes} onDone={close} onAdded={onAdded} />;
}

/** "Add a feature" at the foot of a module's section: the same surface, the module set. */
export function AddFeature({ module }: { module: PlanScope | null }) {
  const [open, setOpen] = useState(false);
  const [added, setAdded] = useState<number | null>(null);

  if (open) {
    return (
      <FeatureCompose
        module={module}
        onDone={() => setOpen(false)}
        onAdded={(number) => setAdded(number)}
      />
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <AddTrigger
        label="Add a feature"
        onClick={() => {
          setAdded(null);
          setOpen(true);
        }}
      />
      {added !== null && <Added number={added} onClose={() => setAdded(null)} />}
    </div>
  );
}
