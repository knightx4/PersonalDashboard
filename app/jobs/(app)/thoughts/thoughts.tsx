'use client';

import { useActionState, useRef, useState } from 'react';
import { AddTrigger } from '@/components/ui/add-trigger';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ConfirmStep } from '@/components/ui/confirm-step';
import { EditableProse } from '@/components/ui/editable-prose';
import { ComposeBody } from '@/components/ui/field';
import { THOUGHT_MAX } from '@/lib/jobs/thoughts';
import { addThought, deleteThought, updateThought, type ThoughtState } from './actions';

export type ThoughtView = {
  id: string;
  body: string;
  /** The day it was written, already formatted in the person's zone. */
  written: string;
  /** The day it was last changed, when that was a later edit. */
  edited: string | null;
};

const initial: ThoughtState = { error: null };

export function ThoughtList({ thoughts }: { thoughts: ThoughtView[] }) {
  return (
    <div className="max-w-3xl space-y-3">
      {/* With nothing written yet the composer is the page, so it starts open. */}
      <Composer startOpen={thoughts.length === 0} />
      {thoughts.map((thought, index) => (
        <Entry key={thought.id} thought={thought} latest={index === 0} />
      ))}
    </div>
  );
}

function Composer({ startOpen }: { startOpen: boolean }) {
  const [open, setOpen] = useState(startOpen);
  const form = useRef<HTMLFormElement>(null);
  // A saved entry clears the box. It stays open only when it is the whole page.
  const [state, add, adding] = useActionState(async (prev: ThoughtState, data: FormData) => {
    const next = await addThought(prev, data);
    if (!next.error) {
      form.current?.reset();
      if (!startOpen) setOpen(false);
    }
    return next;
  }, initial);

  if (!open) return <AddTrigger label="New entry" onClick={() => setOpen(true)} />;

  return (
    <Card>
      <form
        ref={form}
        action={add}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && !startOpen) setOpen(false);
        }}
      >
        <div className="px-3 py-3">
          <ComposeBody
            name="body"
            required
            autoFocus={!startOpen}
            rows={4}
            maxLength={THOUGHT_MAX}
            placeholder="The kind of work you want next, what matters in the role and the company, where you want to be in a few years, and where you are now."
            aria-label="New career goals entry"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2 border-t border-border px-3 py-2">
          {state.error && <span className="text-small text-danger">{state.error}</span>}
          <span className="ml-auto flex items-center gap-1">
            {!startOpen && (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => setOpen(false)}
                disabled={adding}
              >
                Cancel
              </Button>
            )}
            <Button type="submit" size="sm" disabled={adding}>
              {adding ? 'Saving…' : 'Save entry'}
            </Button>
          </span>
        </div>
      </form>
    </Card>
  );
}

function Entry({ thought, latest }: { thought: ThoughtView; latest: boolean }) {
  return (
    <Card padding="dense">
      <header className="flex flex-wrap items-baseline gap-2">
        <h2 className="text-ui font-medium text-ink">{thought.written}</h2>
        {latest && (
          <span className="rounded-full bg-accent-tint px-1.5 py-0.5 text-small text-accent">
            Latest
          </span>
        )}
        {thought.edited && (
          <span className="text-small text-ink-muted">edited {thought.edited}</span>
        )}
        <ConfirmStep
          className="ml-auto"
          prompt="Delete this entry for good?"
          confirmLabel="Delete"
          pendingLabel="Deleting…"
          onConfirm={async () => {
            const result = await deleteThought(thought.id);
            if (result.error) throw new Error(result.error);
          }}
        >
          Delete
        </ConfirmStep>
      </header>
      <EditableProse
        className="mt-2"
        label={`Career goals entry from ${thought.written}`}
        value={thought.body}
        editLabel="Edit this entry"
        onSave={async (next) => {
          const result = await updateThought(thought.id, next);
          return result.error;
        }}
      />
    </Card>
  );
}
