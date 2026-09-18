'use client';

import { useActionState, useRef, useState } from 'react';
import {
  createItemList,
  deleteItemList,
  renameItemList,
  type ListActionState,
} from '@/app/shopping/settings/actions';
import { Button } from '@/components/ui/button';
import { AddTrigger } from '@/components/ui/add-trigger';
import { FieldError, InlineInput, Input } from '@/components/ui/field';
import { Group } from '@/components/ui/disclosure';
import { listSwatchStyle } from '@/lib/lists/gradients';

const initial: ListActionState = {};

export type SettingsList = {
  id: string;
  name: string;
  slug: string;
  color: string | null;
};

export function ListsSection({ lists }: { lists: SettingsList[] }) {
  const [creating, setCreating] = useState(false);
  const [createState, createAction, createPending] = useActionState(
    async (prev: ListActionState, formData: FormData) => {
      const next = await createItemList(prev, formData);
      if (next.message) setCreating(false);
      return next;
    },
    initial,
  );

  return (
    <div className="space-y-5">
      <p className="text-body text-ink-muted">
        Lists are personal trackers — gifts to wrap, things to return, a trip packing set —
        not taxonomy like categories. Filter inventory by a list anytime.
      </p>

      <Group title="Your lists">
        {lists.length === 0 && !creating ? (
          <p className="text-body text-ink-muted">None yet — create one below.</p>
        ) : lists.length > 0 ? (
          // Divides and space, no frame: the settings card around this
          // already said these belong together. Law 11.
          <ul className="divide-y divide-border">
            {lists.map((list) => (
              <ListRow key={list.id} list={list} />
            ))}
          </ul>
        ) : null}
      </Group>

      {creating ? (
        <form action={createAction} className="flex flex-wrap items-center gap-2">
          <Input
            name="name"
            required
            maxLength={40}
            autoFocus
            placeholder="To return, Gift ideas, Cabin…"
            className="min-w-[12rem] flex-1"
            aria-label="New list name"
          />
          <Button type="submit" size="sm" disabled={createPending}>
            {createPending ? 'Adding…' : 'Add'}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setCreating(false)}
            disabled={createPending}
          >
            Cancel
          </Button>
          <FieldError>{createState.error}</FieldError>
        </form>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          {/* A trigger for a compose surface, not a button competing with the
              list above it (law 14): the form it opens is the point, and a
              bordered control standing in for one is the empty box again
              wearing a different shape. */}
          <AddTrigger label="New list" onClick={() => setCreating(true)} />
          {createState.message && (
            <p className="text-body text-positive">{createState.message}</p>
          )}
        </div>
      )}
    </div>
  );
}

/** Renamed in place, for the reasons on CustomCategoryRow. Law 12. */
function ListRow({ list }: { list: SettingsList }) {
  const [renameState, renameAction, renamePending] = useActionState(renameItemList, initial);
  const formRef = useRef<HTMLFormElement>(null);

  function commit(event: React.FocusEvent<HTMLInputElement>) {
    if (event.target.value.trim() !== list.name) formRef.current?.requestSubmit();
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Escape') {
      event.currentTarget.value = list.name;
      event.currentTarget.blur();
    }
  }

  return (
    <li className="row-pad flex flex-wrap items-center gap-2">
      <form ref={formRef} action={renameAction} className="flex min-w-0 flex-1 items-center gap-2">
        <input type="hidden" name="id" value={list.id} />
        <span
          className="size-2.5 shrink-0 rounded-full"
          style={listSwatchStyle(list.color)}
          aria-hidden
        />
        <InlineInput
          name="name"
          maxLength={40}
          defaultValue={list.name}
          key={list.name}
          aria-label={`Rename ${list.name}`}
          disabled={renamePending}
          onBlur={commit}
          onKeyDown={onKeyDown}
          className="min-w-0 flex-1 font-medium"
        />
      </form>
      {renameState.error && <p className="text-small text-danger">{renameState.error}</p>}
      <form action={deleteItemList}>
        <input type="hidden" name="id" value={list.id} />
        <Button type="submit" variant="ghost" size="sm">
          Delete
        </Button>
      </form>
    </li>
  );
}
