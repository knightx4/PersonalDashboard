'use client';

import { useActionState, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import {
  addPlanItem,
  deletePlanItem,
  seedPlan,
  setPlanItemStatus,
  updatePlanItem,
  type PlanActionState,
} from './actions';
import { Button } from '@/components/ui/button';
import { cardVariants } from '@/components/ui/card';
import { FieldError, Input, Label, Select, Textarea } from '@/components/ui/field';
import type { ModuleId } from '@/lib/modules';
import { PLAN_STATUSES, type PlanItem, type PlanSection, type PlanStatus } from '@/lib/plan/load';
import { cn } from '@/lib/cn';

const STATUS_LABEL: Record<PlanStatus, string> = {
  not_started: 'Not started',
  in_progress: 'In progress',
  done: 'Done',
  dropped: 'Dropped',
};

// The tint tokens rather than colour/10, for the reason the notes list gives:
// the tints are tuned per theme, and 10% alpha over a dark surface is not the
// same thing as a tint.
const STATUS_STYLE: Record<PlanStatus, string> = {
  not_started: 'bg-canvas text-ink-muted',
  in_progress: 'bg-accent-tint text-accent',
  done: 'bg-positive-tint text-positive',
  dropped: 'bg-canvas text-ink-ghost line-through',
};

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
 * How far through, as a bar and as the numbers behind it.
 *
 * The numbers are there because a bar alone is a shape rather than a fact:
 * "8 of 12" survives being read at a glance in a way that four fifths of a
 * rectangle does not.
 */
function Progress({ section }: { section: PlanSection }) {
  const { progress } = section;
  if (progress.fraction === null) return null;

  return (
    <span className="flex items-center gap-2">
      <span
        className="h-1.5 w-24 overflow-hidden rounded-full bg-canvas"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={progress.live}
        aria-valuenow={progress.done}
        aria-label={`${section.label}: ${progress.done} of ${progress.live} done`}
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
 * One step: what it is, where it stands, and whatever you have said about it.
 *
 * Closed, it is a line — the status, the title, and a mark if there is a note
 * under it. The detail and the note are behind the fold because a plan is read
 * as a list far more often than any one step of it is read in full.
 */
function PlanStep({ step }: { step: PlanItem }) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);

  const [statusState, statusAction, statusPending] = useActionState(
    setPlanItemStatus,
    {} as PlanActionState,
  );
  const [saveState, saveAction, savePending] = useActionState(
    updatePlanItem,
    {} as PlanActionState,
  );
  const [deleteState, deleteAction, deletePending] = useActionState(
    deletePlanItem,
    {} as PlanActionState,
  );

  // Closes on a save that landed. Compared by identity rather than by the text
  // of the message, so two consecutive saves are distinguishable.
  const [settled, setSettled] = useState<PlanActionState | null>(null);
  if (saveState.message && saveState !== settled) {
    setSettled(saveState);
    setEditing(false);
  }

  const hasMore = Boolean(step.detail || step.comment);

  return (
    <li className="flex flex-col gap-2 px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        {/* The status is a picker rather than a badge you have to open the step
            to change: "where is this" is the question the page exists for, and
            answering it differently should not be a form. */}
        <form action={statusAction} className="flex items-center gap-1.5">
          <input type="hidden" name="id" value={step.id} />
          <Select
            name="status"
            defaultValue={step.status}
            disabled={statusPending}
            aria-label={`Status of ${step.title}`}
            className={cn('h-7 w-32 py-0 text-small', STATUS_STYLE[step.status])}
            onChange={(event) => event.currentTarget.form?.requestSubmit()}
          >
            <StatusOptions />
          </Select>
        </form>

        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          disabled={!hasMore && !open}
          className={cn(
            'flex min-w-0 flex-1 items-center gap-1 text-left text-ui text-ink',
            hasMore && 'hover:text-accent',
          )}
        >
          {hasMore && (
            <ChevronDown
              className={cn(
                'size-3.5 shrink-0 text-ink-muted transition-transform duration-150',
                !open && '-rotate-90',
              )}
              strokeWidth={1.75}
              aria-hidden
            />
          )}
          <span className={cn('min-w-0', step.status === 'dropped' && 'text-ink-muted line-through')}>
            {step.title}
          </span>
          {step.comment && !open && (
            <span className="shrink-0 text-small text-ink-muted">· noted</span>
          )}
        </button>
      </div>

      {open && !editing && (
        <div className="space-y-2 pl-1">
          {step.detail && (
            <p className="whitespace-pre-wrap text-ui text-ink-muted">{step.detail}</p>
          )}
          {step.comment && (
            <p className="whitespace-pre-wrap rounded-lg bg-canvas px-3 py-2 text-ui text-ink">
              {step.comment}
            </p>
          )}
        </div>
      )}

      {editing ? (
        <form action={saveAction} className="space-y-2">
          <input type="hidden" name="id" value={step.id} />
          <div>
            <Label htmlFor={`title-${step.id}`}>Step</Label>
            <Input id={`title-${step.id}`} name="title" defaultValue={step.title} />
          </div>
          <div>
            <Label htmlFor={`detail-${step.id}`}>What it involves</Label>
            <Textarea id={`detail-${step.id}`} name="detail" rows={3} defaultValue={step.detail ?? ''} />
          </div>
          <div>
            <Label htmlFor={`comment-${step.id}`}>Your note</Label>
            <Textarea
              id={`comment-${step.id}`}
              name="comment"
              rows={2}
              defaultValue={step.comment ?? ''}
              placeholder="What it is waiting on, what changed, why it stalled."
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Select name="status" defaultValue={step.status} className="w-36" aria-label="Status">
              <StatusOptions />
            </Select>
            <Button type="submit" size="sm" disabled={savePending}>
              {savePending ? 'Saving…' : 'Save'}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)}>
              Cancel
            </Button>
            <FieldError>{saveState.error}</FieldError>
          </div>
        </form>
      ) : (
        (open || statusState.error || deleteState.error) && (
          <div className="flex flex-wrap items-center gap-2">
            {open && (
              <>
                <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(true)}>
                  Edit
                </Button>
                <form action={deleteAction}>
                  <input type="hidden" name="id" value={step.id} />
                  <Button type="submit" size="sm" variant="ghost" disabled={deletePending}>
                    Delete
                  </Button>
                </form>
              </>
            )}
            <FieldError>{statusState.error ?? deleteState.error}</FieldError>
          </div>
        )
      )}

      {/* A step with nothing under it still needs a way in to add some. */}
      {!hasMore && !open && !editing && (
        <button
          type="button"
          onClick={() => {
            setOpen(true);
            setEditing(true);
          }}
          className="self-start text-small text-ink-muted underline underline-offset-2 hover:text-accent"
        >
          Add a note
        </button>
      )}
    </li>
  );
}

/** A step of your own, at the end of a module's list. */
function AddStep({ module }: { module: ModuleId | null }) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(addPlanItem, {} as PlanActionState);

  const [settled, setSettled] = useState<PlanActionState | null>(null);
  if (state.message && state !== settled) {
    setSettled(state);
    setOpen(false);
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="press w-full rounded-card border border-dashed border-border bg-surface py-2 text-center text-ui text-ink-muted hover:border-accent hover:text-accent"
      >
        Add a step
      </button>
    );
  }

  return (
    <form action={action} className={cardVariants({ padding: 'dense' })}>
      <input type="hidden" name="module" value={module ?? ''} />
      <Label htmlFor={`new-${module ?? 'app'}`}>The step</Label>
      <Input
        id={`new-${module ?? 'app'}`}
        name="title"
        autoFocus
        placeholder="What has to happen"
      />
      <div className="mt-2">
        <Label htmlFor={`new-detail-${module ?? 'app'}`}>What it involves</Label>
        <Textarea id={`new-detail-${module ?? 'app'}`} name="detail" rows={2} />
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Select name="status" defaultValue="not_started" className="w-36" aria-label="Status">
          <StatusOptions />
        </Select>
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? 'Adding…' : 'Add step'}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
        <FieldError>{state.error}</FieldError>
      </div>
    </form>
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
    <form
      action={action}
      className={cn(cardVariants(), 'border-dashed px-4 py-8 text-center')}
    >
      <p className="text-ui text-ink">Nothing here yet.</p>
      <p className="mx-auto mt-1 max-w-prose text-ui text-ink-muted">
        The build order in <code>docs/BUILD-ORDER.md</code> and the job side&rsquo;s own plan can be
        written in as a starting point — every numbered step, with the ones already marked done
        carried across. After that this list is the plan, and the documents are background reading:
        nothing here reads them again, and the two will drift.
      </p>
      <div className="mt-4 flex flex-col items-center gap-2">
        <Button type="submit" disabled={pending}>
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
 * The same import, offered again once the plan is not empty.
 *
 * A new slice gets planned in `lib/plan/seed.ts`, beside the spec that argues
 * for it; without this the only way those steps reach the page is retyping them
 * into a form, which is how a plan page stops being current and then stops
 * being read. It adds what is missing and leaves everything else exactly as it
 * is, so pressing it when there is nothing new costs a sentence saying so.
 */
function TopUpFromBuildOrder() {
  const [state, action, pending] = useActionState(seedPlan, {} as PlanActionState);

  return (
    <form action={action} className="flex flex-wrap items-center gap-3 border-t border-border pt-4">
      <Button type="submit" size="sm" variant="ghost" disabled={pending}>
        {pending ? 'Checking…' : 'Bring in new steps from the build order'}
      </Button>
      <FieldError>{state.error}</FieldError>
      {state.message && !state.error && (
        <span className="text-small text-ink-muted">{state.message}</span>
      )}
    </form>
  );
}

export function PlanView({ sections, empty }: { sections: PlanSection[]; empty: boolean }) {
  if (empty) return <ImportTheBuildOrder />;

  return (
    <div className="space-y-6">
      {sections.map((section) => (
        <section key={section.module ?? 'app'} className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-body font-semibold text-ink">{section.label}</h2>
            <Progress section={section} />
          </div>

          {section.items.length === 0 ? (
            <p className="rounded-card border border-dashed border-border bg-surface px-4 py-4 text-center text-ui text-ink-muted">
              No plan for {section.label} yet.
            </p>
          ) : (
            <ul className={cn(cardVariants({ padding: 'none' }), 'divide-y divide-border')}>
              {section.items.map((step) => (
                <PlanStep key={step.id} step={step} />
              ))}
            </ul>
          )}

          <AddStep module={section.module} />
        </section>
      ))}

      {/* The app-wide list is not offered as a section until something is in
          it, so this is the only way to put the first thing there. */}
      {!sections.some((section) => section.module === null) && (
        <section className="space-y-2">
          <h2 className="text-body font-semibold text-ink">The app as a whole</h2>
          <AddStep module={null} />
        </section>
      )}
      <TopUpFromBuildOrder />
    </div>
  );
}
