'use client';

import { useActionState } from 'react';
import {
  createCustomCategory,
  deleteCustomCategory,
  renameCustomCategory,
  type CategoryActionState,
} from '@/app/(app)/settings/actions';
import { Button } from '@/components/ui/button';
import { FieldError, Input, Label } from '@/components/ui/field';
import { CATEGORY_COLOR_OPTIONS } from '@/lib/categories/slugify';

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
  const [createState, createAction, createPending] = useActionState(
    createCustomCategory,
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
        {custom.length === 0 ? (
          <p className="text-sm text-ink-faint">None yet — create one below.</p>
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {custom.map((category) => (
              <CustomCategoryRow key={category.id} category={category} />
            ))}
          </ul>
        )}
      </div>

      <form action={createAction} className="space-y-3 rounded-lg border border-border p-3">
        <p className="text-sm font-medium text-ink">Add a category</p>
        <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
          <div>
            <Label htmlFor="category_name">Name</Label>
            <Input
              id="category_name"
              name="name"
              required
              maxLength={40}
              placeholder="Camping, Kids, Gifts…"
            />
          </div>
          <div>
            <Label htmlFor="category_color">Color</Label>
            <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Category color">
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
            {createPending ? 'Adding…' : 'Add category'}
          </Button>
          {createState.message && (
            <p className="text-sm text-positive">{createState.message}</p>
          )}
        </div>
        <FieldError>{createState.error}</FieldError>
      </form>

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
