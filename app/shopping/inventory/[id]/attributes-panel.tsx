'use client';

import { useActionState, useState } from 'react';
import {
  lookupItemAttributes,
  saveCategoryTemplate,
  updateItemAttributes,
  type AttributeActionState,
} from './attribute-actions';
import { Button } from '@/components/ui/button';
import { FieldError, Input, Label, Select } from '@/components/ui/field';
import {
  ATTRIBUTE_FIELD_TYPES,
  type AttributeField,
  type AttributeValues,
} from '@/lib/inventory/attributes';

const initial: AttributeActionState = {};

const TYPE_LABEL: Record<string, string> = {
  text: 'Text',
  number: 'Number',
  url: 'Link',
};

/**
 * The item's own details, the template they come from, and the search that
 * fills them in.
 *
 * Fields are per category rather than per item, so a board game asks for
 * players and a BGG link while a shirt asks for brand and size — and editing
 * the template here changes every item in that category.
 */
export function ItemAttributesPanel({
  itemId,
  categoryId,
  categoryName,
  template,
  fields,
  values,
  searchAvailable,
}: {
  itemId: string;
  categoryId: string | null;
  categoryName: string | null;
  /** The category's fields — what the template editor starts from. */
  template: AttributeField[];
  /** What to render for this item: the template plus anything it still holds. */
  fields: AttributeField[];
  values: AttributeValues;
  searchAvailable: boolean;
}) {
  const [saveState, saveAction, savePending] = useActionState(updateItemAttributes, initial);
  const [lookupState, lookupAction, lookupPending] = useActionState(
    lookupItemAttributes,
    initial,
  );
  const [editingTemplate, setEditingTemplate] = useState(false);

  return (
    <section className="space-y-4 rounded-card border border-border bg-surface p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-ink">Details</h2>
          <p className="mt-1 text-[13px] text-ink-muted">
            {categoryName
              ? `The fields ${categoryName} items carry. Change them for every item in the category below.`
              : 'Give this item a category to get a set of fields for its kind.'}
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
        <p className="text-[13px] text-ink-faint">
          Search is not set up for the {categoryName ?? 'uncategorized'} category yet — board
          games look themselves up on BoardGameGeek.
        </p>
      )}
      {lookupState.message && <p className="text-sm text-positive">{lookupState.message}</p>}
      <FieldError>{lookupState.error}</FieldError>

      <form action={saveAction} className="space-y-4">
        <input type="hidden" name="id" value={itemId} />
        {fields.length > 0 ? (
          <div className="grid gap-3 sm:grid-cols-2">
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
                    className="mt-1 inline-block text-[12px] text-brand hover:underline"
                  >
                    Open link
                  </a>
                )}
              </div>
            ))}
          </div>
        ) : (
          <p className="text-[13px] text-ink-faint">
            No fields yet. Add one below, or set up the template for this category.
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
          {saveState.message && <p className="text-sm text-positive">{saveState.message}</p>}
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
        <h3 className="text-sm font-semibold text-ink">
          {categoryName ?? 'Category'} template
        </h3>
        <p className="mt-1 text-[13px] text-ink-muted">
          Every item in this category shows these fields. Clearing a name removes the field;
          values already recorded under it stay on their items.
        </p>
      </div>

      {rows.map((row, index) => (
        <div key={`${row.key}-${index}`} className="flex flex-wrap items-end gap-2">
          <input type="hidden" name="field_key" value={row.key} />
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
        </div>
      ))}

      <Button
        type="button"
        size="sm"
        variant="ghost"
        onClick={() => setRows((current) => [...current, { key: '', label: '', type: 'text' }])}
      >
        Add a field
      </Button>

      <div className="flex flex-wrap items-center gap-3 border-t border-border pt-3">
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? 'Saving…' : 'Save template'}
        </Button>
        {state.message && <p className="text-sm text-positive">{state.message}</p>}
      </div>
      <FieldError>{state.error}</FieldError>
    </form>
  );
}
