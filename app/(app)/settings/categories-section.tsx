'use client';

import { useActionState, useState } from 'react';
import {
  createCustomCategory,
  deleteCustomCategory,
  renameCustomCategory,
  type CategoryActionState,
} from '@/app/(app)/settings/actions';
import { Button } from '@/components/ui/button';
import { FieldError, Input } from '@/components/ui/field';

const initial: CategoryActionState = {};

export type SettingsCategory = {
  id: string;
  name: string;
  slug: string;
  color: string | null;
  user_id: string | null;
};

export function CategoriesSection({ categories }: { categories: SettingsCategory[] }) {
  const system = categories.filter((c) => !c.user_id);
  const custom = categories.filter((c) => c.user_id);
  const [creating, setCreating] = useState(false);
  const [createState, createAction, createPending] = useActionState(
    async (prev: CategoryActionState, formData: FormData) => {
      const next = await createCustomCategory(prev, formData);
      if (next.message) setCreating(false);
      return next;
    },
    initial,
  );

  return (
    <div className="space-y-5">
      <p className="text-sm text-ink-muted">
        Built-in categories are shared and read-only. Add your own — email import will consider
        them when auto-categorizing new items.
      </p>

      <div>
        <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
          Your categories
        </h3>
        {custom.length === 0 && !creating ? (
          <p className="text-sm text-ink-faint">None yet — create one below.</p>
        ) : custom.length > 0 ? (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {custom.map((category) => (
              <CustomCategoryRow key={category.id} category={category} />
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
            placeholder="Camping, Kids, Gifts…"
            className="min-w-[12rem] flex-1"
            aria-label="New category name"
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
            New category
          </Button>
          {createState.message && (
            <p className="text-sm text-positive">{createState.message}</p>
          )}
        </div>
      )}

      <div>
        <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
          Built-in
        </h3>
        <ul className="flex flex-wrap gap-2">
          {system.map((category) => (
            <li
              key={category.id}
              className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-2.5 py-1 text-[13px] text-ink-muted"
            >
              <span
                className="size-2 rounded-full"
                style={{ backgroundColor: category.color ?? '#cfcfc8' }}
                aria-hidden
              />
              {category.name}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function CustomCategoryRow({ category }: { category: SettingsCategory }) {
  const [renameState, renameAction, renamePending] = useActionState(
    renameCustomCategory,
    initial,
  );

  return (
    <li className="flex flex-col gap-2 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
      <form action={renameAction} className="flex min-w-0 flex-1 items-center gap-2">
        <input type="hidden" name="id" value={category.id} />
        <span
          className="size-2.5 shrink-0 rounded-full"
          style={{ backgroundColor: category.color ?? '#cfcfc8' }}
          aria-hidden
        />
        <Input
          name="name"
          required
          maxLength={40}
          defaultValue={category.name}
          aria-label={`Rename ${category.name}`}
          className="h-9"
        />
        <Button type="submit" variant="ghost" size="sm" disabled={renamePending}>
          {renamePending ? 'Saving…' : 'Rename'}
        </Button>
      </form>
      <div className="flex items-center gap-2">
        {renameState.error && (
          <p className="text-[12px] text-red-600">{renameState.error}</p>
        )}
        {renameState.message && (
          <p className="text-[12px] text-positive">{renameState.message}</p>
        )}
        <form action={deleteCustomCategory}>
          <input type="hidden" name="id" value={category.id} />
          <Button type="submit" variant="ghost" size="sm">
            Delete
          </Button>
        </form>
      </div>
    </li>
  );
}
