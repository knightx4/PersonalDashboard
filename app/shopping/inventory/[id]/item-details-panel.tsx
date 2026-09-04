'use client';

import { useActionState, useState, type ReactNode } from 'react';
import { lookupItemAttributes, saveCategoryTemplate } from './attribute-actions';
import type { AttributeActionState } from './attribute-actions';
import { updateInventoryItem, type ActionState } from '@/app/shopping/inventory/actions';
import { Button } from '@/components/ui/button';
import { FieldError, Input, Label, Select, Textarea } from '@/components/ui/field';
import {
  ATTRIBUTE_FIELD_TYPES,
  type AttributeField,
  type AttributeValues,
} from '@/lib/inventory/attributes';

const initial: AttributeActionState = {};
const initialSave: ActionState = {};

const TYPE_LABEL: Record<string, string> = {
  text: 'Text',
  number: 'Number',
  url: 'Link',
};

/**
 * Everything the page knows about the item, in one box.
 *
 * What it is called and what category it is in used to live in a separate
 * "Edit" card further down the page, while the fields describing it lived up
 * here — two panels editing one row, each with its own Save button. They are
 * one form now; the category's own fields are just the second half of it.
 *
 * The catalog's own identity block — "Book details", "Game details" — used to
 * be a third box above this one, which left the reader deciding which of two
 * panels a given fact was in and reading "Players" twice. It is the top of this
 * box now: catalog identity, then what the item is, then the fields its
 * category says it carries.
 *
 * The search and the category-template editor stay separate forms, because
 * they act on something other than this item: a catalog, and every item in the
 * category.
 */
export function ItemDetailsPanel({
  itemId,
  item,
  categories,
  categoryId,
  categoryName,
  template,
  fields,
  values,
  searchAvailable,
  catalog,
  catalogAnsweredLabels = [],
}: {
  itemId: string;
  item: {
    name: string;
    variant: string | null;
    notes: string | null;
  };
  categories: { id: string; name: string }[];
  categoryId: string | null;
  categoryName: string | null;
  /** The category's fields — what the template editor starts from. */
  template: AttributeField[];
  /** What to render for this item: the template plus anything it still holds. */
  fields: AttributeField[];
  values: AttributeValues;
  searchAvailable: boolean;
  /** The book or game identity block, rendered as the top of this box. */
  catalog?: ReactNode;
  /**
   * Labels of the template fields left out because the identity block above
   * already answers them. Named rather than silently dropped, so a field that
   * is in the category template but not on screen explains itself.
   */
  catalogAnsweredLabels?: string[];
}) {
  const [saveState, saveAction, savePending] = useActionState(updateInventoryItem, initialSave);
  const [lookupState, lookupAction, lookupPending] = useActionState(
    lookupItemAttributes,
    initial,
  );
  const [editingTemplate, setEditingTemplate] = useState(false);

  return (
    <section className="space-y-4 rounded-card border border-border bg-surface p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-body font-semibold text-ink">Details</h2>
          <p className="mt-1 text-ui text-ink-muted">
            {categoryName
              ? `What this is, and the fields ${categoryName} items carry. Change those for every item in the category below.`
              : 'What this is. Give it a category to get a set of fields for its kind.'}
          </p>
        </div>
        <form action={lookupAction}>
          <input type="hidden" name="id" value={itemId} />
          <Button type="submit" size="sm" variant="secondary" disabled={lookupPending}>
            {lookupPending ? 'Searching…' : 'Search'}
          </Button>
        </form>
      </div>

      {!searchAvailable && (
        <p className="text-ui text-ink-muted">
          Search is not set up for the {categoryName ?? 'uncategorized'} category yet — board
          games look themselves up on BoardGameGeek.
        </p>
      )}
      {lookupState.message && <p className="text-body text-positive">{lookupState.message}</p>}
      <FieldError>{lookupState.error}</FieldError>

      {catalog && <div className="border-t border-border pt-4">{catalog}</div>}

      <form action={saveAction} className="space-y-4 border-t border-border pt-4">
        <input type="hidden" name="id" value={itemId} />

        <div>
          <Label htmlFor="name">Name</Label>
          <Input id="name" name="name" required defaultValue={item.name} />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor="variant">Variant</Label>
            <Input id="variant" name="variant" defaultValue={item.variant ?? ''} />
          </div>
          <div>
            <Label htmlFor="category_id">Category</Label>
            <Select id="category_id" name="category_id" defaultValue={categoryId ?? ''}>
              <option value="">Uncategorized</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </Select>
          </div>
        </div>
        <div>
          <Label htmlFor="notes">Notes</Label>
          <Textarea
            id="notes"
            name="notes"
            defaultValue={item.notes ?? ''}
            placeholder="Where it lives, warranty info, anything useful…"
          />
        </div>

        {fields.length > 0 ? (
          <div className="grid gap-3 border-t border-border pt-4 sm:grid-cols-2">
            {fields.map((field) => (
              <div key={field.key}>
                <Label htmlFor={`attr_${field.key}`}>{field.label}</Label>
                <Input
                  id={`attr_${field.key}`}
                  name={`attr_${field.key}`}
                  defaultValue={values[field.key] ?? ''}
                  inputMode={field.type === 'number' ? 'decimal' : undefined}
                  type={field.type === 'url' ? 'url' : 'text'}
                  placeholder={field.type === 'url' ? 'https://…' : undefined}
                />
                {field.type === 'url' && values[field.key] && (
                  <a
                    href={values[field.key]}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-1 inline-block text-small text-accent hover:underline"
                  >
                    Open link
                  </a>
                )}
              </div>
            ))}
          </div>
        ) : (
          <p className="border-t border-border pt-4 text-ui text-ink-muted">
            No category fields yet. Add one below, or set up the template for this category.
          </p>
        )}

        {catalogAnsweredLabels.length > 0 && (
          <p className="text-ui text-ink-muted">
            {catalogAnsweredLabels.join(' and ')}{' '}
            {catalogAnsweredLabels.length === 1 ? 'comes' : 'come'} from the catalog above, so{' '}
            {catalogAnsweredLabels.length === 1 ? 'it is' : 'they are'} not repeated here.
          </p>
        )}

        <div className="grid gap-3 border-t border-border pt-3 sm:grid-cols-2">
          <div>
            <Label htmlFor="new_label">Add a field (this item only)</Label>
            <Input id="new_label" name="new_label" placeholder="Expansion, condition…" />
          </div>
          <div>
            <Label htmlFor="new_value">Value</Label>
            <Input id="new_value" name="new_value" />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" size="sm" disabled={savePending}>
            {savePending ? 'Saving…' : 'Save details'}
          </Button>
          {categoryId && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setEditingTemplate((open) => !open)}
            >
              {editingTemplate ? 'Hide template' : `Edit ${categoryName ?? 'category'} template`}
            </Button>
          )}
          {saveState.message && <p className="text-body text-positive">{saveState.message}</p>}
        </div>
        <FieldError>{saveState.error}</FieldError>
      </form>

      {editingTemplate && categoryId && (
        <CategoryTemplateForm
          categoryId={categoryId}
          categoryName={categoryName}
          template={template}
        />
      )}
    </section>
  );
}

function CategoryTemplateForm({
  categoryId,
  categoryName,
  template,
}: {
  categoryId: string;
  categoryName: string | null;
  template: AttributeField[];
}) {
  const [state, action, pending] = useActionState(saveCategoryTemplate, initial);
  // Blank rows are the way to add fields; empty labels are dropped on save.
  const [rows, setRows] = useState<AttributeField[]>(() => [...template]);

  return (
    <form action={action} className="space-y-3 rounded-card border border-border bg-canvas p-4">
      <input type="hidden" name="category_id" value={categoryId} />
      <div>
        <h3 className="text-body font-semibold text-ink">
          {categoryName ?? 'Category'} template
        </h3>
        <p className="mt-1 text-ui text-ink-muted">
          Every item in this category shows these fields. Clearing a name removes the field;
          values already recorded under it stay on their items. Tick “In eBay search” for a
          detail that decides which listing is the right one — an edition, a pressing, a model
          number — and it joins the search alongside the title.
        </p>
      </div>

      {rows.map((row, index) => (
        <div key={`${row.key}-${index}`} className="flex flex-wrap items-end gap-2">
          <input type="hidden" name="field_key" value={row.key} />
          {/* A hidden input carries the flag rather than the checkbox itself:
              an unchecked box submits nothing, and these four lists are read
              back positionally, so a missing entry would shift every field
              below it onto the wrong row. */}
          <input type="hidden" name="field_in_search" value={row.inSearch ? '1' : '0'} />
          <div className="min-w-[10rem] flex-1">
            <Label htmlFor={`field_label_${index}`}>Field</Label>
            <Input
              id={`field_label_${index}`}
              name="field_label"
              defaultValue={row.label}
              placeholder="Players, Brand, Size…"
            />
          </div>
          <div>
            <Label htmlFor={`field_type_${index}`}>Kind</Label>
            <Select id={`field_type_${index}`} name="field_type" defaultValue={row.type}>
              {ATTRIBUTE_FIELD_TYPES.map((type) => (
                <option key={type} value={type}>
                  {TYPE_LABEL[type] ?? type}
                </option>
              ))}
            </Select>
          </div>
          <label
            className="flex h-9 items-center gap-2 text-ui text-ink-muted"
            title="Add this field’s value to the eBay search for the item"
          >
            <input
              type="checkbox"
              checked={row.inSearch}
              disabled={row.type === 'url'}
              onChange={(event) =>
                setRows((current) =>
                  current.map((entry, at) =>
                    at === index ? { ...entry, inSearch: event.target.checked } : entry,
                  ),
                )
              }
              className="size-4 accent-[var(--c-accent)]"
            />
            In eBay search
          </label>
        </div>
      ))}

      <Button
        type="button"
        size="sm"
        variant="ghost"
        onClick={() =>
          setRows((current) => [...current, { key: '', label: '', type: 'text', inSearch: false }])
        }
      >
        Add a field
      </Button>

      <div className="flex flex-wrap items-center gap-3 border-t border-border pt-3">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? 'Saving…' : 'Save template'}
        </Button>
        {state.message && <p className="text-body text-positive">{state.message}</p>}
      </div>
      <FieldError>{state.error}</FieldError>
    </form>
  );
}
