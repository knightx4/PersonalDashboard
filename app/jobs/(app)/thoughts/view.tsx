'use client';

import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { FieldError, Textarea } from '@/components/ui/field';
import { AddTrigger } from '@/components/ui/add-trigger';
import { ConfirmStep } from '@/components/ui/confirm-step';
import { EditableProse } from '@/components/ui/editable-prose';
import { formatDate } from '@/lib/jobs/applications/load';
import { addThought, deleteThought, updateThought } from './actions';

export type Thought = { id: string; body: string; createdAt: string; updatedAt: string };

/** An edit a day or more after writing is worth saying; a typo fixed at once is not. */
const EDITED_AFTER_MS = 24 * 60 * 60 * 1000;

export function ThoughtsView({ thoughts, timezone }: { thoughts: Thought[]; timezone: string }) {
  return (
    <div className="space-y-3">
      <Compose startOpen={thoughts.length === 0} />
      {thoughts.map((thought) => (
        <Entry key={thought.id} thought={thought} timezone={timezone} />
      ))}
    </div>
  );
}

function Compose({ startOpen }: { startOpen: boolean }) {
  const [open, setOpen] = useState(startOpen);
  const [body, setBody] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  if (!open) return <AddTrigger label="Write something" onClick={() => setOpen(true)} />;

  return (
    <Card padding="dense" className="space-y-2">
      <Textarea
        rows={6}
        autoFocus={!startOpen}
        value={body}
        aria-label="A new entry"
        onChange={(event) => setBody(event.target.value)}
        placeholder="What you want from the next job, what you have stopped wanting, what an interview made you realise."
      />
      <div className="flex items-center gap-2">
        <Button
          type="button"
          size="sm"
          disabled={pending || !body.trim()}
          onClick={() =>
            start(async () => {
              const result = await addThought(body);
              setError(result.error);
              if (!result.error) {
                setBody('');
                setOpen(false);
              }
            })
          }
        >
          {pending ? 'Saving…' : 'Save'}
        </Button>
        {!startOpen && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => {
              setBody('');
              setError(null);
              setOpen(false);
            }}
          >
            Cancel
          </Button>
        )}
        <FieldError>{error}</FieldError>
      </div>
    </Card>
  );
}

function Entry({ thought, timezone }: { thought: Thought; timezone: string }) {
  const edited =
    new Date(thought.updatedAt).getTime() - new Date(thought.createdAt).getTime() >
    EDITED_AFTER_MS;

  return (
    <Card padding="dense">
      <header className="flex items-baseline gap-2">
        <h2 className="tabular text-small font-medium text-ink-muted">
          {formatDate(thought.createdAt, timezone)}
        </h2>
        {edited && (
          <span className="tabular text-small text-ink-ghost">
            edited {formatDate(thought.updatedAt, timezone)}
          </span>
        )}
        <ConfirmStep
          className="ml-auto"
          prompt="Delete this entry? It cannot be brought back."
          confirmLabel="Delete"
          onConfirm={async () => {
            const result = await deleteThought(thought.id);
            if (result.error) throw new Error(result.error);
          }}
        >
          Delete
        </ConfirmStep>
      </header>
      <EditableProse
        className="mt-1"
        label={`Your entry from ${formatDate(thought.createdAt, timezone)}`}
        value={thought.body}
        editLabel="Edit"
        expandable
        onSave={async (next) => {
          const result = await updateThought(thought.id, next);
          return result.error;
        }}
      />
    </Card>
  );
}
