'use client';

import { useState, useTransition } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Chip } from '@/components/ui/chip';
import { Select } from '@/components/ui/field';
import { PERSON_DOT_CLASS, type Person } from '@/lib/people/load';
import { assignInboxToPerson } from './people-actions';

/**
 * Whose mailbox this is.
 *
 * The most load-bearing setting in the people feature: every order imported
 * from here inherits it, which is what makes the split happen without anybody
 * labelling a single order by hand. Changing it also re-labels what this
 * mailbox has already imported, so setting the people up after the first sync
 * works the way you would expect rather than leaving that sync unattributed.
 *
 * Read as the owner's dot and name; pressing it opens the choice of person, so
 * no form field is drawn around a value nobody is changing (plan #1788, law
 * 14).
 *
 * Its own file because the inbox section is a server component -- it reads the
 * Gmail environment -- and this needs local state.
 */
export function InboxPerson({
  accountId,
  people,
  personId,
}: {
  accountId: string;
  people: Person[];
  personId: string | null;
}) {
  const [value, setValue] = useState(personId ?? '');
  const [editing, setEditing] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (people.length === 0) {
    return (
      <p className="text-small text-ink-muted">
        Add someone under People above to say whose inbox this is.
      </p>
    );
  }

  const owner = people.find((person) => person.id === value) ?? null;

  if (editing) {
    return (
      <Select
        aria-label="Whose inbox"
        value={value}
        disabled={pending}
        autoFocus
        className="w-auto min-w-40"
        onBlur={() => setEditing(false)}
        onChange={(event) => {
          const next = event.target.value;
          setValue(next);
          setSaved(null);
          setEditing(false);
          startTransition(async () => {
            const result = await assignInboxToPerson({ accountId, personId: next });
            setSaved(result.error ?? 'Saved, and past orders relabelled.');
          });
        }}
      >
        <option value="">Nobody</option>
        {people.map((person) => (
          <option key={person.id} value={person.id}>
            {person.name}
          </option>
        ))}
      </Select>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={() => setEditing(true)}
        aria-label={`Whose inbox: ${owner?.name ?? 'not assigned'}. Change`}
        className="press -ml-1.5 inline-flex min-w-0 items-center gap-1.5 rounded-control px-1.5 py-0.5 text-ui text-ink hover:bg-sunken"
      >
        {owner ? (
          <>
            <span
              className={cn('size-2.5 shrink-0 rounded-full', PERSON_DOT_CLASS[owner.colour])}
              aria-hidden
            />
            <span className="truncate">{owner.name}</span>
          </>
        ) : (
          // Called out rather than left as a quiet "Nobody". This is the one
          // step in setting up a second mailbox that is easy to skip, and
          // skipping it means everything that inbox imports arrives
          // unlabelled -- which reads as the feature not working rather than
          // as a setting not set.
          <Chip tone="caution" size="sm">
            Not assigned
          </Chip>
        )}
        <ChevronDown className="size-3.5 shrink-0 text-ink-muted" strokeWidth={1.75} aria-hidden />
      </button>
      {pending && <span className="text-small text-ink-muted">Saving…</span>}
      {!pending && saved && <span className="text-small text-ink-muted">{saved}</span>}
    </div>
  );
}
