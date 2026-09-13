'use client';

import { useActionState, useState } from 'react';
import Link from 'next/link';
import { Bot, ChevronRight, Lightbulb, Sparkles } from 'lucide-react';
import {
  addIdea,
  deleteIdea,
  dismissIdea,
  restoreIdea,
  shapeIdea,
  updateIdea,
  type IdeaActionState,
} from './actions';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { FieldError, Select, Textarea } from '@/components/ui/field';
import { MODULES, type ModuleId } from '@/lib/modules';
import type { IdeaList, IdeaRow } from '@/lib/ideas/load';
import { cardVariants } from '@/components/ui/card';
import { CommentThread } from '@/components/dev/comment-thread';
import { AddTrigger } from '@/components/ui/add-trigger';
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
 *
 * Closed until asked for (law 14). This page is read far more often than it is
 * written to -- the list of ideas is the point of visiting -- and a three-row
 * box standing open above that list was the first thing on the page.
 *
 * The label goes with it: the placeholder already says what to type, and a
 * caption above a box repeating it is law 15.
 */
function AddIdea() {
  const [state, action, pending] = useActionState(addIdea, {} as IdeaActionState);
  const [composing, setComposing] = useState(false);

  // Close once it has saved. The new idea appearing in the list below is the
  // confirmation; leaving the box open would put the fault straight back.
  //
  // Adjusted during render rather than in an effect: this is React's own
  // pattern for reacting to a changed value, and an effect here is a second
  // render for nothing -- which the lint rule says out loud.
  const [seen, setSeen] = useState<string | undefined>(undefined);
  if (state.message !== seen) {
    setSeen(state.message);
    if (state.message && !state.error) setComposing(false);
  }

  if (!composing) {
    return <AddTrigger label="Add an idea" onClick={() => setComposing(true)} />;
  }

  return (
    <form action={action} className={cardVariants({ padding: 'dense' })}>
      <Textarea
        id="idea-body"
        name="body"
        rows={3}
        autoFocus
        placeholder="Something worth doing one day. It will sit here until it is."
      />
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <ModuleSelect name="module" defaultValue={null} />
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? 'Saving…' : 'Add idea'}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setComposing(false)}>
          Cancel
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
      {/* Ink, not green. Law 4 keeps positive for money coming back, and "sent"
          is the system saying what it did. */}
      {state.message && <span className="text-small text-ink-muted">{state.message}</span>}
      <FieldError>{state.error}</FieldError>
    </form>
  );
}

function IdeaCard({ idea, dismissed = false }: { idea: IdeaRow; dismissed?: boolean }) {
  const [editing, setEditing] = useState(false);
  const [saveState, saveAction, savePending] = useActionState(
    updateIdea,
    {} as IdeaActionState,
  );
  const [deleteState, deleteAction, deletePending] = useActionState(
    deleteIdea,
    {} as IdeaActionState,
  );
  const [asideState, asideAction, asidePending] = useActionState(
    dismissed ? restoreIdea : dismissIdea,
    {} as IdeaActionState,
  );

  return (
    <li className="flex flex-col gap-2 px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-full bg-accent-tint px-2 py-0.5 text-micro font-semibold uppercase tracking-wide text-accent">
          {scopeLabel(idea.module)}
        </span>
        {/* Only a suggestion is marked. Tagging your own ideas "me" would put a
            label on every row to distinguish the few that need one. */}
        {idea.source === 'claude' && (
          <span className="inline-flex items-center gap-1 rounded-full bg-raised px-2 py-0.5 text-micro font-semibold uppercase tracking-wide text-ink-muted">
            <Bot className="size-3" strokeWidth={2} aria-hidden />
            Suggested
          </span>
        )}
        <span className="tabular text-small text-ink-muted">{idea.createdAt.slice(0, 10)}</span>
      </div>

      {/* Which feature the session was working on when it wrote this. On its
          own line rather than in the badge's tooltip: a suggestion with no
          origin reads as a machine talking to itself. */}
      {idea.source === 'claude' && idea.from && (
        <p className="text-small text-ink-muted">
          Came out of #{idea.from.number} {idea.from.title}
        </p>
      )}

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
          <CommentThread
            target="idea"
            id={idea.id}
            thread={idea.thread}
            placeholder="What you think about this idea, or what you would want it to do. Shaping reads it; tag @dash to ask about it."
          />
          <div className="flex flex-wrap items-center gap-2">
            {/* A dismissed idea gets one move back into the list and nothing
                else. Shaping or editing one from inside the fold would be
                working on a row you have already said no to. */}
            {!dismissed && (
              <>
                <ShapeIdea idea={idea} />
                <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(true)}>
                  Edit
                </Button>
              </>
            )}
            <form action={asideAction}>
              <input type="hidden" name="id" value={idea.id} />
              <Button type="submit" size="sm" variant="ghost" pending={asidePending}>
                {dismissed ? 'Bring back' : 'Dismiss'}
              </Button>
            </form>
            <form action={deleteAction}>
              <input type="hidden" name="id" value={idea.id} />
              <Button type="submit" size="sm" variant="ghost" disabled={deletePending}>
                Delete
              </Button>
            </form>
            <FieldError>{deleteState.error ?? asideState.error}</FieldError>
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
 *
 * Your own ideas are the grouping; what a session suggested sits in one
 * section under them, so that a night of follow-ons cannot push the two
 * thoughts you had off the top of the page.
 *
 * An idea that has been shaped into the plan is out of that grouping entirely
 * and in its own section at the bottom, folded shut. It is finished as an idea
 * -- the thing to do about it now lives on the plan -- and left among the rest
 * it grew the list it was supposed to be leaving, until the page read as
 * mostly-done and the two or three still worth thinking about were the hard
 * part to find. Kept rather than hidden, because "did I already write that
 * down" is a question this page has to answer. A dismissed idea is in the
 * fold under that one, for the same reason.
 */
export function IdeasView({ ideas }: { ideas: IdeaList }) {
  const { mine, suggested, shaped, dismissed } = ideas;
  const total = mine.length + suggested.length + shaped.length + dismissed.length;

  const scopes: Array<ModuleId | null> = [
    null,
    ...MODULES.map((module) => module.id).filter((id) => mine.some((idea) => idea.module === id)),
  ];

  return (
    <div className="space-y-6">
      <AddIdea />

      {total === 0 && (
        // The shared empty state rather than a hand-drawn dashed paragraph:
        // this is the whole page when the list is empty, and law 1 says that
        // gets a real one. The dashed edge is the same dashed edge, drawn once
        // in the primitive.
        <EmptyState
          icon={Lightbulb}
          title="Nothing written down yet"
          description="An idea here becomes work when you have Claude shape it into the plan, and approve what it proposes there."
        />
      )}

      {/* Everything written down has been shaped. Not the empty state above:
          nothing is missing here, the list has simply been worked to the end,
          and an empty-handed illustration would be saying the opposite. */}
      {total > 0 && mine.length === 0 && suggested.length === 0 && (
        <p className="text-ui text-ink-muted">
          Every idea written down has been shaped into the plan or put aside. The ones below
          are kept for the record.
        </p>
      )}

      {scopes.map((scope) => {
        const rows = mine.filter((idea) => idea.module === scope);
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
      })}

      {/* Under your own list rather than mixed into it. A session working a
          feature can write several follow-ons in a night, and above the module
          headings they would be the first thing on the page. Not grouped by
          workspace: this list is the short one. */}
      {suggested.length > 0 && (
        <section className="space-y-2">
          <h2 className="flex items-center gap-1.5 text-body font-semibold text-ink">
            <Bot className="size-4 text-ink-ghost" strokeWidth={1.75} aria-hidden />
            Suggested by Claude{' '}
            <span className="font-normal text-ink-muted">({suggested.length})</span>
          </h2>
          <p className="text-small text-ink-muted">
            Follow-ons a session wrote down while building something else. Shape one into the
            plan, or dismiss it and it stops being offered.
          </p>
          <ul className={cn(cardVariants(), 'divide-y divide-border')}>
            {suggested.map((idea) => (
              <IdeaCard key={idea.id} idea={idea} />
            ))}
          </ul>
        </section>
      )}

      {shaped.length > 0 && (
        <details className="group">
          <summary className="flex cursor-pointer list-none items-center gap-1.5 text-body font-semibold text-ink [&::-webkit-details-marker]:hidden">
            <ChevronRight
              className="size-4 shrink-0 text-ink-ghost transition-transform duration-150 group-open:rotate-90"
              strokeWidth={1.75}
              aria-hidden
            />
            Already in the plan{' '}
            <span className="font-normal text-ink-muted">({shaped.length})</span>
          </summary>
          <ul className={cn(cardVariants(), 'mt-2 divide-y divide-border')}>
            {shaped.map((idea) => (
              <IdeaCard key={idea.id} idea={idea} />
            ))}
          </ul>
        </details>
      )}

      {/* Where a dismissal goes, which is why dismissing is not deleting.
          Folded shut and out of every count above: the point of putting an
          idea aside is not reading it again unless you come looking. */}
      {dismissed.length > 0 && (
        <details className="group">
          <summary className="flex cursor-pointer list-none items-center gap-1.5 text-body font-semibold text-ink [&::-webkit-details-marker]:hidden">
            <ChevronRight
              className="size-4 shrink-0 text-ink-ghost transition-transform duration-150 group-open:rotate-90"
              strokeWidth={1.75}
              aria-hidden
            />
            Dismissed <span className="font-normal text-ink-muted">({dismissed.length})</span>
          </summary>
          <ul className={cn(cardVariants(), 'mt-2 divide-y divide-border')}>
            {dismissed.map((idea) => (
              <IdeaCard key={idea.id} idea={idea} dismissed />
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
