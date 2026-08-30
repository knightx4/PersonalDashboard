'use client';

import { useState, useTransition } from 'react';
import { Select } from '@/components/ui/field';
import type { Person } from '@/lib/people/load';
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
  const [saved, setSaved] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (people.length === 0) {
    return (
      <p className="text-xs text-ink-faint">
        Add someone under People above to say whose inbox this is.
      </p>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <label htmlFor={`person-${accountId}`} className="text-xs text-ink-muted">
        Whose inbox
      </label>

      {/*
        Called out rather than left as a quiet "Nobody" in the dropdown. This
        is the one step in setting up a second mailbox that is easy to skip,
        and skipping it means everything that inbox imports arrives unlabelled
        -- which reads as the feature not working rather than as a setting not
        set. Assigning it later does relabel the back catalogue, but only if
        you notice.
      */}
      {!value && (
        <span className="rounded-full bg-accent-orange-tint px-2 py-0.5 text-[11px] font-medium text-accent-orange">
          Not assigned
        </span>
      )}
      <Select
        id={`person-${accountId}`}
        value={value}
        disabled={pending}
        className="h-8 w-auto min-w-40 text-[13px]"
        onChange={(event) => {
          const next = event.target.value;
          setValue(next);
          setSaved(null);
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
      {pending && <span className="text-xs text-ink-faint">Saving…</span>}
      {!pending && saved && <span className="text-xs text-ink-muted">{saved}</span>}
    </div>
  );
}
