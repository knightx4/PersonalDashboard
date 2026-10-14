'use client';

import { useActionState, useState, useTransition } from 'react';
import { Users } from 'lucide-react';
import { cn } from '@/lib/cn';
import { AddTrigger } from '@/components/ui/add-trigger';
import { Button } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';
import { FieldError, Input } from '@/components/ui/field';
import {
  PERSON_COLOURS,
  PERSON_DOT_CLASS,
  type Person,
  type PersonColour,
} from '@/lib/people/load';
import {
  addPerson,
  removePerson,
  updatePerson,
  type PeopleState,
} from './people-actions';
import { Tooltip } from '@/components/ui/tooltip';

/**
 * Who this account shops for.
 *
 * One login, several people. Adding somebody here is what makes their mailbox
 * assignable below, and what puts a label on the orders that come out of it.
 *
 * Each person is a short row, their colour and their name, which opens for
 * editing when pressed; the form for a new one opens from "Add person" (plan
 * #1788, law 14). The sentence saying what people are for is the empty
 * state, read by someone who has none yet (law 15).
 */
export function PeopleSection({ people }: { people: Person[] }) {
  const [adding, setAdding] = useState(false);
  const [state, action, pending] = useActionState(
    async (prev: PeopleState, formData: FormData) => {
      const next = await addPerson(prev, formData);
      if (!next.error) setAdding(false);
      return next;
    },
    {} as PeopleState,
  );
  const [colour, setColour] = useState<PersonColour>('brand');

  return (
    <div className="space-y-3">
      {people.length === 0 && (
        <p className="text-body text-ink-muted">
          Shopping is labelled by person, so two people can share this account and still see
          whose is whose. Add someone, then say which inbox is theirs below.
        </p>
      )}

      {/* Divides and space, no frame: the People card already said these
          belong together, and a ground per row inside it was a second box
          arguing with the first. Law 11. */}
      {people.length > 0 && (
        <ul className="divide-y divide-border">
          {people.map((person) => (
            <PersonRow key={person.id} person={person} canRemove={people.length > 1} />
          ))}
        </ul>
      )}

      {adding ? (
        <form action={action} className="flex flex-wrap items-center gap-2">
          <ColourPicker value={colour} onChange={setColour} />
          <input type="hidden" name="colour" value={colour} />
          <Input
            name="name"
            placeholder="Name"
            maxLength={60}
            required
            autoFocus
            aria-label="Name"
            className="min-w-40 flex-1"
          />
          <Button type="submit" size="sm" pending={pending}>
            {pending ? 'Adding…' : 'Add'}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={pending}
            onClick={() => setAdding(false)}
          >
            Cancel
          </Button>
        </form>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <AddTrigger label="Add person" onClick={() => setAdding(true)} />
          {state.message && <p className="text-ui text-accent">{state.message}</p>}
        </div>
      )}

      <FieldError>{state.error}</FieldError>
    </div>
  );
}

/**
 * A person, read as their colour and name. Pressing the row opens it: the
 * colours, the name in a field, Save, and Remove.
 */
function PersonRow({ person, canRemove }: { person: Person; canRemove: boolean }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(person.name);
  const [colour, setColour] = useState<PersonColour>(person.colour);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const dirty = name.trim() !== person.name || colour !== person.colour;

  const close = () => {
    setEditing(false);
    setConfirming(false);
    setName(person.name);
    setColour(person.colour);
    setError(null);
  };

  const save = () =>
    startTransition(async () => {
      const result = await updatePerson({ personId: person.id, name: name.trim(), colour });
      setError(result.error);
      if (!result.error) setEditing(false);
    });

  if (!editing) {
    return (
      <li>
        <button
          type="button"
          onClick={() => setEditing(true)}
          aria-label={`Edit ${person.name}`}
          className="press row-pad flex w-full min-w-0 items-center gap-2.5 text-left"
        >
          <span
            className={cn('size-3 shrink-0 rounded-full', PERSON_DOT_CLASS[person.colour])}
            aria-hidden
          />
          <span className="min-w-0 flex-1 truncate text-body font-medium text-ink">
            {person.name}
          </span>
          {person.isDefault && (
            <Chip>default</Chip>
          )}
        </button>
      </li>
    );
  }

  return (
    <li className="row-pad space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <ColourPicker value={colour} onChange={setColour} />
        <Input
          value={name}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') close();
            if (event.key === 'Enter' && dirty) save();
          }}
          maxLength={60}
          autoFocus
          aria-label={`Name for ${person.name}`}
          className="min-w-40 flex-1"
        />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" pending={pending} disabled={!dirty} onClick={save}>
          {pending ? 'Saving…' : 'Save'}
        </Button>
        <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={close}>
          Cancel
        </Button>
        {canRemove &&
          (confirming ? (
            <span className="ml-auto flex shrink-0 items-center gap-1">
              <Button
                type="button"
                variant="danger"
                size="xs"
                disabled={pending}
                onClick={() =>
                  startTransition(async () => {
                    const result = await removePerson(person.id);
                    setError(result.error);
                  })
                }
              >
                Remove
              </Button>
              <Button type="button" variant="ghost" size="xs" onClick={() => setConfirming(false)}>
                Keep
              </Button>
            </span>
          ) : (
            <Button
              type="button"
              variant="ghost"
              size="xs"
              onClick={() => setConfirming(true)}
              className="ml-auto shrink-0 hover:text-danger"
            >
              Remove
            </Button>
          ))}
      </div>
      {confirming && (
        <p className="text-small text-ink-muted">
          Their shopping stays. Those orders simply stop being labelled.
        </p>
      )}
      {error && <p className="text-small text-danger">{error}</p>}
    </li>
  );
}

function ColourPicker({
  value,
  onChange,
}: {
  value: PersonColour;
  onChange: (colour: PersonColour) => void;
}) {
  return (
    <span className="flex shrink-0 items-center gap-1" role="group" aria-label="Colour">
      {PERSON_COLOURS.map((entry) => (
        <Tooltip key={entry} label={entry}>
          <button
            type="button"
            onClick={() => onChange(entry)}
            aria-label={entry}
            aria-pressed={value === entry}
            className={cn(
              'size-4 rounded-full ring-offset-1 transition-shadow',
              PERSON_DOT_CLASS[entry],
              value === entry ? 'ring-2 ring-ink' : 'hover:ring-2 hover:ring-border-strong',
            )}
          />
        </Tooltip>
      ))}
    </span>
  );
}

export function PeopleTitle() {
  return (
    <span className="flex items-center gap-2">
      <Users className="size-4 text-ink-muted" strokeWidth={1.75} />
      People
    </span>
  );
}
