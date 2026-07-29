'use client';

import { useActionState } from 'react';
import {
  createItemList,
  deleteItemList,
  renameItemList,
  type ListActionState,
} from '@/app/(app)/settings/actions';
import { Button } from '@/components/ui/button';
import { FieldError, Input, Label } from '@/components/ui/field';
import { CATEGORY_COLOR_OPTIONS } from '@/lib/categories/slugify';

const initial: ListActionState = {};

export type SettingsList = {
  id: string;
  name: string;
  slug: string;
  color: string | null;
};

export function ListsSection({ lists }: { lists: SettingsList[] }) {
  const [createState, createAction, createPending] = useActionState(createItemList, initial);

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
        {lists.length === 0 ? (
          <p className="text-sm text-ink-faint">None yet — create one below.</p>
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {lists.map((list) => (
              <ListRow key={list.id} list={list} />
            ))}
          </ul>
        )}
      </div>

      <form action={createAction} className="space-y-3 rounded-lg border border-border p-3">
        <p className="text-sm font-medium text-ink">Add a list</p>
        <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
          <div>
            <Label htmlFor="list_name">Name</Label>
            <Input
              id="list_name"
              name="name"
              required
              maxLength={40}
              placeholder="To return, Gift ideas, Cabin…"
            />
          </div>
          <div>
            <Label htmlFor="list_color">Color</Label>
            <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="List color">
              {CATEGORY_COLOR_OPTIONS.map((color, index) => (
                <label key={color} className="cursor-pointer">
                  <input
                    type="radio"
                    name="color"
                    value={color}
                    defaultChecked={index === 0}
                    className="peer sr-only"
                  />
                  <span
                    className="block size-7 rounded-full border-2 border-transparent peer-checked:border-ink peer-focus-visible:ring-2 peer-focus-visible:ring-brand/30"
                    style={{ backgroundColor: color }}
                    aria-hidden
                  />
                  <span className="sr-only">{color}</span>
                </label>
              ))}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Button type="submit" size="sm" disabled={createPending}>
            {createPending ? 'Adding…' : 'Add list'}
          </Button>
          {createState.message && (
            <p className="text-sm text-positive">{createState.message}</p>
          )}
        </div>
        <FieldError>{createState.error}</FieldError>
      </form>
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
          style={{ backgroundColor: list.color ?? '#cfcfc8' }}
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
