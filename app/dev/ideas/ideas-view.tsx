'use client';

import { useActionState, useState } from 'react';
import Link from 'next/link';
import { Sparkles } from 'lucide-react';
import { addIdea, deleteIdea, shapeIdea, updateIdea, type IdeaActionState } from './actions';
import { Button } from '@/components/ui/button';
import { FieldError, Label, Select, Textarea } from '@/components/ui/field';
import { MODULES, type ModuleId } from '@/lib/modules';
import type { IdeaRow } from '@/lib/ideas/load';
import { cardVariants } from '@/components/ui/card';
import { cn } from '@/lib/cn';

const MODULE_LABEL: Record<ModuleId, string> = Object.fromEntries(
  MODULES.map((module) => [module.id, module.label]),
) as Record<ModuleId, string>;

/** "Everything" rather than an empty label: no module is an answer, not a gap. */
function scopeLabel(module: ModuleId | null): string {
  return module ? MODULE_LABEL[module] : 'Everything';
}

function ModuleSelect({
  name,
  defaultValue,
  id,
}: {
  name: string;
  defaultValue: ModuleId | null;
  id?: string;
}) {
  return (
    <Select id={id} name={name} defaultValue={defaultValue ?? ''} aria-label="What it is about">
      <option value="">Everything</option>
      {MODULES.map((module) => (
        <option key={module.id} value={module.id}>
          {module.label}
        </option>
      ))}
    </Select>
  );
}

/**
 * Writing one down, which is the whole job.
 *
 * Deliberately two fields and a button. An idea that needs a form to describe
 * it is a request, and requests have a queue of their own next door.
 */
function AddIdea() {
  const [state, action, pending] = useActionState(addIdea, {} as IdeaActionState);

  return (
    <form action={action} className={cardVariants({ padding: 'dense' })}>
      <Label htmlFor="idea-body">The idea</Label>
      <Textarea
        id="idea-body"
        name="body"
        rows={3}
        placeholder="Something worth doing one day. It will sit here until it is."
      />
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <ModuleSelect name="module" defaultValue={null} />
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? 'Saving…' : 'Add idea'}
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
 * The way out of the ideas list.
 *
 * An idea has nowhere to go on its own; this is where it goes. Claude reads
 * it and the code and writes a proposal into the plan -- a feature with its
 * steps, done-whens and sizes -- for the person to approve there. Once that
 * has happened the button becomes the link to what it became, because
 * shaping the same idea twice would put two features in the plan.
 */
function ShapeIdea({ idea }: { idea: IdeaRow }) {
  const [state, action, pending] = useActionState(shapeIdea, {} as IdeaActionState);

  if (idea.planItem) {
    return (
      <Link
        href="/dev/plan?view=all"
        className="inline-flex items-center gap-1.5 text-small text-accent hover:underline"
      >
        <Sparkles className="size-3.5" aria-hidden />
        In the plan as #{idea.planItem.number}
        {idea.planItem.status === 'proposed' && ' · waiting for your approval'}
      </Link>
    );
  }

  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="id" value={idea.id} />
      <Button type="submit" size="sm" variant="secondary" pending={pending}>
        <Sparkles className="size-3.5" aria-hidden />
        {pending ? 'Sending…' : 'Shape into a plan'}
      </Button>
      {state.message && <span className="text-small text-positive">{state.message}</span>}
      <FieldError>{state.error}</FieldError>
    </form>
  );
}

function IdeaCard({ idea }: { idea: IdeaRow }) {
  const [editing, setEditing] = useState(false);
  const [saveState, saveAction, savePending] = useActionState(
    updateIdea,
    {} as IdeaActionState,
  );
  const [deleteState, deleteAction, deletePending] = useActionState(
    deleteIdea,
    {} as IdeaActionState,
  );

  return (
    <li className="flex flex-col gap-2 px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-full bg-accent-tint px-2 py-0.5 text-micro font-semibold uppercase tracking-wide text-accent">
          {scopeLabel(idea.module)}
        </span>
        <span className="tabular text-small text-ink-muted">{idea.createdAt.slice(0, 10)}</span>
      </div>

      {editing ? (
        <form action={saveAction} className="space-y-2">
          <input type="hidden" name="id" value={idea.id} />
          <Textarea name="body" rows={3} defaultValue={idea.body} />
          <div className="flex flex-wrap items-center gap-2">
            <ModuleSelect name="module" defaultValue={idea.module} />
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
        <>
          <p className="whitespace-pre-wrap text-body text-ink">{idea.body}</p>
          <div className="flex flex-wrap items-center gap-2">
            <ShapeIdea idea={idea} />
            <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(true)}>
              Edit
            </Button>
            <form action={deleteAction}>
              <input type="hidden" name="id" value={idea.id} />
              <Button type="submit" size="sm" variant="ghost" disabled={deletePending}>
                Delete
              </Button>
            </form>
            <FieldError>{deleteState.error}</FieldError>
          </div>
        </>
      )}
    </li>
  );
}

/**
 * The list, grouped by what each idea is about.
 *
 * Grouped rather than filtered: the list is short enough to read whole, and
 * the question it answers -- "what did I think of for the job search" -- is
 * answered by a heading without anyone having to work a control first.
 */
export function IdeasView({ ideas }: { ideas: IdeaRow[] }) {
  const scopes: Array<ModuleId | null> = [
    null,
    ...MODULES.map((module) => module.id).filter((id) =>
      ideas.some((idea) => idea.module === id),
    ),
  ];

  return (
    <div className="space-y-6">
      <AddIdea />

      {ideas.length === 0 ? (
        <p className="rounded-card border border-dashed border-border bg-surface px-4 py-10 text-center text-ui text-ink-muted">
          Nothing written down yet. An idea here becomes work when you have Claude shape it into
          the plan, and approve what it proposes there.
        </p>
      ) : (
        scopes.map((scope) => {
          const rows = ideas.filter((idea) => idea.module === scope);
          if (rows.length === 0) return null;
          return (
            <section key={scope ?? 'everything'} className="space-y-2">
              <h2 className="text-body font-semibold text-ink">
                {scopeLabel(scope)}{' '}
                <span className="font-normal text-ink-muted">({rows.length})</span>
              </h2>
              <ul className={cn(cardVariants(), 'divide-y divide-border')}>
                {rows.map((idea) => (
                  <IdeaCard key={idea.id} idea={idea} />
                ))}
              </ul>
            </section>
          );
        })
      )}
    </div>
  );
}
