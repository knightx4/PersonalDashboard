'use client';

import { useActionState, useEffect, useRef, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { DashAction } from '@/components/ui/dash-action';
import { Input } from '@/components/ui/field';
import { addSubjectSource, type AddSourceState } from './actions';

/**
 * Add a source (plan #2307.4): the one press that puts material in the bank
 * the preparation reads, under the Sources section. Closed until pressed, so
 * no empty box sits under the sources (law 14). Open, it takes an address or
 * a search phrase; while it fetches a line says so, and what it stored, or
 * why it stored nothing, stays under the box until the next press.
 *
 * `drawn` is for the gallery, which has no server: it fixes the box open and
 * its state, and pending, so each hidden part can be photographed.
 */

function AddButton({ pendingDrawn }: { pendingDrawn?: boolean }) {
  const { pending: live } = useFormStatus();
  const pending = live || pendingDrawn === true;
  return (
    <DashAction
      type="submit"
      size="sm"
      variant="primary"
      pending={pending}
      paid="app/learn/s/[id]/actions.ts#addSubjectSource"
      what="Cost of searching for and matching a source"
      className="min-h-11 lg:min-h-0"
    >
      {pending ? 'Adding…' : 'Add'}
    </DashAction>
  );
}

function Progress({ pendingDrawn }: { pendingDrawn?: boolean }) {
  const { pending: live } = useFormStatus();
  if (!live && !pendingDrawn) return null;
  return (
    <p className="mt-2 text-ui text-ink-muted" aria-live="polite">
      Fetching it, reading its sections and matching its weeks. This can take a minute.
    </p>
  );
}

export function AddSource({
  subjectId,
  drawn,
}: {
  subjectId: string;
  drawn?: { open: boolean; pending?: boolean; state?: AddSourceState; value?: string };
}) {
  const [open, setOpen] = useState(drawn?.open ?? false);
  const [live, formAction] = useActionState<AddSourceState, FormData>(addSubjectSource, {});
  const state = drawn?.state ?? live;
  const formRef = useRef<HTMLFormElement>(null);
  const submitted = useRef(false);

  // A press that stored something empties the box for the next one.
  useEffect(() => {
    if (submitted.current && state.lines && !state.error) {
      formRef.current?.reset();
      submitted.current = false;
    }
  }, [state]);

  if (!open) {
    return (
      <div className="mt-3 flex items-center gap-2">
        <Button type="button" variant="ghost" size="sm" className="min-h-11 lg:min-h-0" onClick={() => setOpen(true)}>
          <Plus className="size-4" strokeWidth={1.75} aria-hidden />
          Add a source
        </Button>
      </div>
    );
  }

  return (
    <Card padding="standard" className="mt-3">
      <form
        ref={formRef}
        action={(formData) => {
          submitted.current = true;
          return formAction(formData);
        }}
      >
        <input type="hidden" name="subjectId" value={subjectId} />
        <div className="flex flex-wrap items-center gap-2">
          <Input
            name="ask"
            required
            autoFocus={!drawn}
            maxLength={2000}
            defaultValue={drawn?.value}
            placeholder="An address, or what to search for"
            aria-label="A source to add: an address, or what to search for"
            className="min-h-11 min-w-0 flex-1 basis-full sm:basis-0 lg:min-h-0"
          />
          <AddButton pendingDrawn={drawn?.pending} />
          <Button type="button" variant="ghost" size="sm" className="min-h-11 lg:min-h-0" onClick={() => setOpen(false)}>
            Cancel
          </Button>
        </div>
        <p className="mt-2 text-small text-ink-muted">
          A syllabus, a course page, a textbook or a guide. It is kept with its licence and its weeks join the ones
          this subject is built from.
        </p>
        <Progress pendingDrawn={drawn?.pending} />
        {!drawn?.pending && state.lines && state.lines.length > 0 && (
          <div className="mt-2 space-y-1 text-ui text-ink" aria-live="polite">
            {state.lines.map((line) => (
              <p key={line}>{line}</p>
            ))}
          </div>
        )}
        {!drawn?.pending && state.error && (
          <p role="alert" className="mt-2 text-ui text-danger">
            {state.error}
          </p>
        )}
      </form>
    </Card>
  );
}
