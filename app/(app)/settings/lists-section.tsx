'use client';

import { useActionState, useEffect, useState } from 'react';
import {
  createItemList,
  deleteItemList,
  renameItemList,
  type ListActionState,
} from '@/app/(app)/settings/actions';
import { Button } from '@/components/ui/button';
import { FieldError, Input } from '@/components/ui/field';
import { listSwatchStyle } from '@/lib/lists/gradients';

const initial: ListActionState = {};

export type SettingsList = {
  id: string;
  name: string;
  slug: string;
  color: string | null;
};

export function ListsSection({ lists }: { lists: SettingsList[] }) {
  const [createState, createAction, createPending] = useActionState(createItemList, initial);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (createState.message) setCreating(false);
  }, [createState.message]);

  return (
    <div className="space-y-5">
      <p className="text-sm text-ink-muted">
        Lists are personal trackers — gifts to wrap, things to return, a trip packing set —
        not taxonomy like categories. Filter inventory by a list anytime.
      </p>

      <div>
        <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
          Your lists
        </h3>
        {lists.length === 0 && !creating ? (
          <p className="text-sm text-ink-faint">None yet — create one below.</p>
        ) : lists.length > 0 ? (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {lists.map((list) => (
              <ListRow key={list.id} list={list} />
            ))}
          </ul>
        ) : null}
      </div>

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
          <Button type="button" size="sm" variant="secondary" onClick={() => setCreating(true)}>
            New list
          </Button>
          {createState.message && (
            <p className="text-sm text-positive">{createState.message}</p>
          )}
        </div>
      )}
    </div>
  );
}

function ListRow({ list }: { list: SettingsList }) {
  const [renameState, renameAction, renamePending] = useActionState(renameItemList, initial);

  return (
    <li className="flex flex-col gap-2 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
      <form action={renameAction} className="flex min-w-0 flex-1 items-center gap-2">
        <input type="hidden" name="id" value={list.id} />
        <span
          className="size-2.5 shrink-0 rounded-full"
          style={listSwatchStyle(list.color)}
          aria-hidden
        />
        <Input
          name="name"
          required
          maxLength={40}
          defaultValue={list.name}
          aria-label={`Rename ${list.name}`}
          className="h-9"
        />
        <Button type="submit" variant="ghost" size="sm" disabled={renamePending}>
          {renamePending ? 'Saving…' : 'Rename'}
        </Button>
      </form>
      <div className="flex items-center gap-2">
        {renameState.error && <p className="text-[12px] text-red-600">{renameState.error}</p>}
        {renameState.message && (
          <p className="text-[12px] text-positive">{renameState.message}</p>
        )}
        <form action={deleteItemList}>
          <input type="hidden" name="id" value={list.id} />
          <Button type="submit" variant="ghost" size="sm">
            Delete
          </Button>
        </form>
      </div>
    </li>
  );
}
