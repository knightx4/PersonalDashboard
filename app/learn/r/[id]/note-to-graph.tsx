'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/field';
import { approveNoteConcepts, readNoteIntoGraph, type NoteGraphState } from './actions';

/**
 * What this reading taught, into the graph.
 *
 * The note is written anyway, so this half of the join asks nothing new: it
 * reads what is already there. Shown only once a note exists, because there is
 * nothing to read otherwise, and only when there is a subject to put it in --
 * a subject is the container that accumulates, and the spec is explicit that
 * nothing creates one silently.
 *
 * Proposed rather than added, like every other generated piece of graph. A
 * note is rough and written for yourself; half of what a model finds in one is
 * your own phrasing coming back as a concept, and approval is what keeps that
 * out.
 */

function SubmitButton({ idle, busy }: { idle: string; busy: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="secondary" size="sm" disabled={pending}>
      {pending ? busy : idle}
    </Button>
  );
}

export function NoteToGraph({
  readingId,
  subjects,
}: {
  readingId: string;
  subjects: { id: string; name: string }[];
}) {
  const [state, read] = useActionState<NoteGraphState, FormData>(readNoteIntoGraph, {});
  const [saved, approve] = useActionState<NoteGraphState, FormData>(approveNoteConcepts, {});

  if (subjects.length === 0) return null;

  if (saved.message) {
    return <p className="mt-3 text-ui text-ink-muted">{saved.message}</p>;
  }

  if (state.chain && state.subjectId) {
    const added = state.chain.nodes.filter((node) => !node.existingId);

    return (
      <form action={approve} className="mt-4">
        <input type="hidden" name="subjectId" value={state.subjectId} />
        <input type="hidden" name="chain" value={JSON.stringify(state.chain)} />

        <p className="text-ui text-ink-muted">
          {added.length === 0
            ? 'Nothing here your graph does not already have.'
            : `${added.length === 1 ? 'One concept' : `${added.length} concepts`} out of that note. Nothing is saved until you approve it.`}
        </p>

        <ul className="mt-2 space-y-2">
          {added.map((node) => (
            <li key={node.name}>
              <span className="block text-ui font-medium text-ink">{node.name}</span>
              <span className="block text-ui text-ink">{node.claim}</span>
              <span className="block text-small text-ink-muted">{node.basis}</span>
            </li>
          ))}
        </ul>

        {added.length > 0 && (
          <div className="mt-3 flex items-center gap-3">
            <SubmitButton idle="Add these to the graph" busy="Adding…" />
            {saved.error && <span className="text-ui text-danger">{saved.error}</span>}
          </div>
        )}
      </form>
    );
  }

  return (
    <form action={read} className="mt-4 flex flex-wrap items-end gap-3">
      <input type="hidden" name="readingId" value={readingId} />

      <div>
        <label htmlFor="subjectId" className="mb-1 block text-small text-ink-muted">
          Add what this taught to
        </label>
        <Select id="subjectId" name="subjectId" defaultValue={subjects[0].id}>
          {subjects.map((subject) => (
            <option key={subject.id} value={subject.id}>
              {subject.name}
            </option>
          ))}
        </Select>
      </div>

      <SubmitButton idle="Read the note" busy="Reading…" />
      {state.message && <span className="text-ui text-ink-muted">{state.message}</span>}
      {state.error && <span className="text-ui text-danger">{state.error}</span>}
    </form>
  );
}
