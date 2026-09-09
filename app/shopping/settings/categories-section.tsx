'use client';

import { useActionState, useRef, useState } from 'react';
import {
  createCustomCategory,
  deleteCustomCategory,
  renameCustomCategory,
  type CategoryActionState,
} from '@/app/shopping/settings/actions';
import { Button } from '@/components/ui/button';
import { FieldError, InlineInput, Input } from '@/components/ui/field';
import { Group } from '@/components/ui/disclosure';
import { UNSET_SWATCH } from '@/lib/lists/gradients';

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
      <p className="text-body text-ink-muted">
        Built-in categories are shared and read-only. Add your own — email import will consider
        them when auto-categorizing new items.
      </p>

      <Group title="Your categories">
        {custom.length === 0 && !creating ? (
          <p className="text-body text-ink-muted">None yet — create one below.</p>
        ) : custom.length > 0 ? (
          // Divides and space, no frame: the settings card around this
          // already said these belong together. Law 11.
          <ul className="divide-y divide-border">
            {custom.map((category) => (
              <CustomCategoryRow key={category.id} category={category} />
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
            <p className="text-body text-positive">{createState.message}</p>
          )}
        </div>
      )}

      <Group title="Built-in">
        <ul className="flex flex-wrap gap-2">
          {system.map((category) => (
            <li
              key={category.id}
              className="inline-flex items-center gap-1.5 rounded-full bg-sunken px-2.5 py-1 text-ui text-ink-muted"
            >
              <span
                className="size-2 rounded-full"
                style={{ backgroundColor: category.color ?? UNSET_SWATCH }}
                aria-hidden
              />
              {category.name}
            </li>
          ))}
        </ul>
      </Group>
    </div>
  );
}

/**
 * A category is renamed by typing over its name.
 *
 * It used to be a bordered field and a Rename button per row, which made a
 * list of four names into a page of four forms — and the field was the widest
 * thing in the card, so what the section looked like was inputs rather than
 * categories. Law 12, and the same shape the return policies list below it
 * already uses.
 *
 * Blur commits, and only when the name actually changed; Escape puts it back.
 * Safe here for the usual three reasons: one short string, reversible from the
 * same row, and nothing half-valid to save by accident. Only the error is
 * reported — the row showing the new name is the confirmation, so "Category
 * renamed." was a second one.
 */
function CustomCategoryRow({ category }: { category: SettingsCategory }) {
  const [renameState, renameAction, renamePending] = useActionState(
    renameCustomCategory,
    initial,
  );
  const formRef = useRef<HTMLFormElement>(null);

  function commit(event: React.FocusEvent<HTMLInputElement>) {
    if (event.target.value.trim() !== category.name) formRef.current?.requestSubmit();
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Escape') {
      event.currentTarget.value = category.name;
      event.currentTarget.blur();
    }
  }

  return (
    <li className="row-pad flex flex-wrap items-center gap-2">
      <form ref={formRef} action={renameAction} className="flex min-w-0 flex-1 items-center gap-2">
        <input type="hidden" name="id" value={category.id} />
        <span
          className="size-2.5 shrink-0 rounded-full"
          style={{ backgroundColor: category.color ?? UNSET_SWATCH }}
          aria-hidden
        />
        <InlineInput
          name="name"
          maxLength={40}
          defaultValue={category.name}
          key={category.name}
          aria-label={`Rename ${category.name}`}
          disabled={renamePending}
          onBlur={commit}
          onKeyDown={onKeyDown}
          className="min-w-0 flex-1 font-medium"
        />
      </form>
      {renameState.error && <p className="text-small text-danger">{renameState.error}</p>}
      <form action={deleteCustomCategory}>
        <input type="hidden" name="id" value={category.id} />
        <Button type="submit" variant="ghost" size="sm">
          Delete
        </Button>
      </form>
    </li>
  );
}
