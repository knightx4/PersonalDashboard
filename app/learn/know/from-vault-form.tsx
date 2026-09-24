'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { Button } from '@/components/ui/button';
import { PaidHint } from '@/components/ui/paid-hint';
import { Field, Select } from '@/components/ui/field';
import { cardVariants } from '@/components/ui/card';
import type { ProposedChain } from '@/lib/learn/graph/chain-payload';
import { proposeFromNote, type FromNoteState } from './actions';
import { Proposal } from './brief-form';

/**
 * Reading one note in the vault for the claims it makes.
 *
 * The first slice of the vault pass: one note that you choose, so what the
 * pipeline produces can be looked at before it is pointed at 1,244 of them.
 *
 * The note is chosen from a plain list rather than through the search box the
 * quiz form uses. That box is the right control and it exists twice already --
 * here it would be a third copy of a debounce, an aborted request and rows
 * that stay put while a newer answer lands. The sweep this slice leads to
 * picks its own notes and needs no picker at all, so the list is scaffolding
 * and is marked as such rather than being built properly and then deleted.
 *
 * The proposal and the approval are the briefing import's, unchanged. A vault
 * note and a pasted briefing produce the same chain, so there is one screen
 * for reviewing one and one server path for writing it.
 */

function ReadButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? 'Reading it…' : 'Read this note'}
    </Button>
  );
}

export function FromVaultForm({
  subjects,
  notes,
}: {
  subjects: { id: string; name: string }[];
  notes: { path: string; title: string }[];
}) {
  const [state, propose] = useActionState<FromNoteState, FormData>(proposeFromNote, {});
  const [discarded, setDiscarded] = useState<ProposedChain | null>(null);

  const chain = state.chain;
  if (chain && chain !== discarded) {
    return <Proposal chain={chain} onDiscard={() => setDiscarded(chain)} />;
  }

  return (
    <form action={propose} className={cardVariants({ padding: 'standard' })}>
      {subjects.length > 0 && (
        <Field
          label="Into which track?"
          id="vault-subject"
          hint="Leave it unset and the note names its own track."
        >
          <Select id="vault-subject" name="subjectId" defaultValue="">
            <option value="">Let it decide</option>
            {subjects.map((subject) => (
              <option key={subject.id} value={subject.id}>
                {subject.name}
              </option>
            ))}
          </Select>
        </Field>
      )}

      <Field
        label="Which note?"
        id="vault-note"
        hint="Notes long enough to be arguing something. What it argues becomes ideas to learn, and what it only records does not."
      >
        {/*
          The note that was read stays chosen. A proposal that failed is
          usually retried on the same note, and a picker that empties itself
          makes that a hunt through five hundred paths.
        */}
        <Select
          id="vault-note"
          name="notePath"
          key={state.verdict?.notePath ?? 'none'}
          defaultValue={state.verdict?.notePath ?? ''}
          required
        >
          <option value="" disabled>
            Pick a note
          </option>
          {notes.map((note) => (
            <option key={note.path} value={note.path}>
              {note.path}
            </option>
          ))}
        </Select>
      </Field>

      {/*
        Shown whether or not the note was read. A note the classifier turns
        down is the case most worth seeing, because a wrong call here is the
        one the full sweep would make over and over.
      */}
      {state.verdict && (
        <p className="mt-4 text-ui text-ink-muted">
          <span className="font-medium text-ink">{state.verdict.noteClass}</span>
          {' — '}
          {state.verdict.reason}
        </p>
      )}

      {state.message && <p className="mt-2 text-ui text-ink-muted">{state.message}</p>}
      {state.error && <p className="mt-2 text-ui text-caution">{state.error}</p>}

      <div className="mt-4 flex items-center gap-3">
        <ReadButton />
        <PaidHint
          action="app/learn/know/actions.ts#proposeFromNote"
          what="Cost of reading the note"
        />
      </div>
    </form>
  );
}
