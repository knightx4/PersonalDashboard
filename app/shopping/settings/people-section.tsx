'use client';

import { useActionState, useState, useTransition } from 'react';
import { Users } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui/button';
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

/**
 * Who this account shops for.
 *
 * One login, several people. Adding somebody here is what makes their mailbox
 * assignable below, and what puts a label on the orders that come out of it.
 */
export function PeopleSection({ people }: { people: Person[] }) {
  const [state, action, pending] = useActionState(addPerson, {} as PeopleState);
  const [colour, setColour] = useState<PersonColour>('brand');

  return (
    <div className="space-y-4">
      <p className="text-sm text-ink-muted">
        Shopping is labelled by person, so two people can share this account and still see whose
        is whose. Add someone, then say which inbox is theirs below.
      </p>

      {people.length > 0 && (
        <ul className="space-y-2">
          {people.map((person) => (
            <PersonRow key={person.id} person={person} canRemove={people.length > 1} />
          ))}
        </ul>
      )}

      <form action={action} className="flex flex-wrap items-end gap-2">
        <div className="min-w-0 flex-1">
          <Input name="name" placeholder="Name" maxLength={60} required aria-label="Name" />
        </div>
        <input type="hidden" name="colour" value={colour} />
        <ColourPicker value={colour} onChange={setColour} />
        <Button type="submit" size="sm" variant="secondary" disabled={pending}>
          {pending ? 'Adding…' : 'Add person'}
        </Button>
      </form>

      <FieldError>{state.error}</FieldError>
      {state.message && <p className="text-[13px] text-brand">{state.message}</p>}
    </div>
  );
}

function PersonRow({ person, canRemove }: { person: Person; canRemove: boolean }) {
  const [name, setName] = useState(person.name);
  const [colour, setColour] = useState<PersonColour>(person.colour);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const dirty = name.trim() !== person.name || colour !== person.colour;

  const save = () =>
    startTransition(async () => {
      const result = await updatePerson({ personId: person.id, name: name.trim(), colour });
      setError(result.error);
    });

  return (
    <li className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-canvas px-3 py-2">
      <ColourPicker value={colour} onChange={(next) => setColour(next)} />

      <Input
        value={name}
        onChange={(event) => setName(event.target.value)}
        maxLength={60}
        aria-label={`Name for ${person.name}`}
        className="h-8 min-w-0 flex-1 text-[13px]"
      />

      {person.isDefault && (
        <span className="shrink-0 rounded-full bg-canvas px-2 py-0.5 text-[11px] text-ink-faint">
          default
        </span>
      )}

      {dirty && (
        <Button type="button" size="sm" disabled={pending} onClick={save}>
          {pending ? 'Saving…' : 'Save'}
        </Button>
      )}

      {canRemove &&
        (confirming ? (
          <span className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  const result = await removePerson(person.id);
                  setError(result.error);
                })
              }
              className="press rounded px-1.5 py-0.5 text-[12px] font-medium text-red-600 hover:bg-red-50"
            >
              Remove
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="press rounded px-1 py-0.5 text-[12px] text-ink-faint hover:text-ink"
            >
              Keep
            </button>
          </span>
        ) : (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            className="press shrink-0 rounded px-1.5 py-0.5 text-[12px] text-ink-faint hover:text-red-600"
          >
            Remove
          </button>
        ))}

      {confirming && (
        <p className="w-full text-[11px] text-ink-faint">
          Their shopping stays — those orders simply stop being labelled.
        </p>
      )}
      {error && <p className="w-full text-[12px] text-red-600">{error}</p>}
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
        <button
          key={entry}
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
