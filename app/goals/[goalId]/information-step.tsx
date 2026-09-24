'use client';

import { useActionState, useId, useState } from 'react';
import { ActionMenu, type ActionMenuItem } from '@/components/ui/action-menu';
import { AddTrigger } from '@/components/ui/add-trigger';
import { Button } from '@/components/ui/button';
import { Field, Input, Select, Textarea } from '@/components/ui/field';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { useToast } from '@/components/ui/toast';
import { liveFields, type CollectionField, type FieldValue } from '@/lib/goals/collections';
import type { Collection, CollectionRecord } from '@/lib/goals/collections-store';
import {
  SOURCE_LABELS,
  VALUE_PREFIX,
  askedFields,
  displayValue,
  informationProgress,
  inputValue,
  missingFields,
  progressLine,
  sourceHref,
  unfinishedReason,
} from '@/lib/goals/information';
import type { StepNode } from '@/lib/goals/steps';
import {
  archiveRecordAction,
  confirmRecordAction,
  finishListAction,
  saveRecordAction,
  type InformationActionState,
} from './information-actions';

/**
 * The form or table on an information step (plan #954; docs/GOALS-SPEC.md,
 * "Information steps and collections"). A one-record collection is a form;
 * a list is a table with a row per item, which the table primitive stacks
 * into label and value pairs on a phone. Rows found for you are drafts,
 * marked with where they came from, until one tap confirms them.
 */

const initial: InformationActionState = {};

export function InformationStep({
  node,
  collection,
  records,
}: {
  node: StepNode;
  collection: Collection;
  records: CollectionRecord[];
}) {
  const asked = askedFields(collection.fields, node.asksFor ?? null);
  const progress = informationProgress(collection.shape, asked, records);
  const line = progressLine(collection.shape, progress);
  const open = node.status === 'open';

  return (
    <div className="mt-2 space-y-2 px-1">
      {line && <p className="text-small text-ink-muted">{line}</p>}
      {collection.shape === 'one' ? (
        <OneRecord node={node} collection={collection} record={records[0] ?? null} asked={asked} />
      ) : (
        <RecordTable
          node={node}
          collection={collection}
          records={records}
          asked={asked}
          canFinish={open && unfinishedReason(progress) === null}
        />
      )}
    </div>
  );
}

function OneRecord({
  node,
  collection,
  record,
  asked,
}: {
  node: StepNode;
  collection: Collection;
  record: CollectionRecord | null;
  asked: CollectionField[];
}) {
  return (
    <div className="space-y-2">
      {record?.draft && <DraftNote stepId={node.id} record={record} />}
      <RecordForm
        stepId={node.id}
        collection={collection}
        record={record}
        asked={asked}
        key={record ? `${record.id}-${record.updatedAt}` : 'new'}
      />
    </div>
  );
}

function RecordTable({
  node,
  collection,
  records,
  asked,
  canFinish,
}: {
  node: StepNode;
  collection: Collection;
  records: CollectionRecord[];
  asked: CollectionField[];
  canFinish: boolean;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [finishState, finish, finishing] = useActionState(
    async (_prev: InformationActionState, form: FormData) => finishListAction(form),
    initial,
  );
  const toast = useToast();
  const fields = liveFields(collection.fields);
  const askedKeys = new Set(asked.map((f) => f.key));
  const editingRecord = records.find((r) => r.id === editing) ?? null;

  async function archive(record: CollectionRecord) {
    const form = new FormData();
    form.set('recordId', record.id);
    const result = await archiveRecordAction(form);
    if (result.error) {
      toast({ text: result.error });
      return;
    }
    if (editing === record.id) setEditing(null);
    toast({
      text: 'Row archived.',
      undo: async () => {
        const back = new FormData();
        back.set('recordId', record.id);
        back.set('restore', 'true');
        const restored = await archiveRecordAction(back);
        if (restored.error) throw new Error(restored.error);
      },
    });
  }

  return (
    <div className="space-y-2">
      {records.length > 0 && (
        <Table aria-label={collection.name}>
          <THead>
            <tr>
              {fields.map((f) => (
                <TH key={f.key} num={isNumeric(f)}>
                  {f.label}
                </TH>
              ))}
              <TH>
                <span className="sr-only">Actions</span>
              </TH>
            </tr>
          </THead>
          <TBody>
            {records.map((record) => {
              const missing = new Set(missingFields(asked, record.data).map((f) => f.key));
              const menu: ActionMenuItem[] = [
                {
                  id: 'edit',
                  label: record.draft ? 'Correct' : 'Edit',
                  onSelect: () => setEditing(record.id),
                },
                {
                  id: 'archive',
                  label: 'Archive row',
                  destructive: true,
                  onSelect: () => void archive(record),
                },
              ];
              return (
                <TR key={record.id}>
                  {fields.map((f, i) => (
                    <TD key={f.key} label={f.label} primary={i === 0} num={isNumeric(f)}>
                      <Value
                        field={f}
                        value={record.data[f.key]}
                        needed={askedKeys.has(f.key) && missing.has(f.key)}
                      />
                    </TD>
                  ))}
                  <TD className="max-md:justify-end">
                    <div className="flex items-center justify-end gap-1">
                      {record.draft && <ConfirmButton stepId={node.id} record={record} compact />}
                      <ActionMenu label={`Row ${rowName(fields, record)} actions`} items={menu} />
                    </div>
                  </TD>
                </TR>
              );
            })}
          </TBody>
        </Table>
      )}

      {editingRecord ? (
        <div className="space-y-2 rounded-control bg-sunken p-3">
          {editingRecord.draft && <DraftNote stepId={node.id} record={editingRecord} />}
          <RecordForm
            stepId={node.id}
            collection={collection}
            record={editingRecord}
            asked={asked}
            onDone={() => setEditing(null)}
            onCancel={() => setEditing(null)}
            key={`${editingRecord.id}-${editingRecord.updatedAt}`}
          />
        </div>
      ) : editing === 'new' ? (
        <div className="rounded-control bg-sunken p-3">
          <RecordForm
            stepId={node.id}
            collection={collection}
            record={null}
            asked={asked}
            onDone={() => setEditing(null)}
            onCancel={() => setEditing(null)}
          />
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <AddTrigger label="Add a row" onClick={() => setEditing('new')} />
          {canFinish && (
            <form action={finish}>
              <input type="hidden" name="stepId" value={node.id} />
              <Button type="submit" size="sm" variant="secondary" pending={finishing}>
                That is all of them
              </Button>
            </form>
          )}
          {finishState.error && <span className="text-small text-danger">{finishState.error}</span>}
        </div>
      )}
    </div>
  );
}

function isNumeric(field: CollectionField): boolean {
  return field.type === 'money' || field.type === 'number' || field.type === 'percent';
}

function rowName(fields: CollectionField[], record: CollectionRecord): string {
  const first = fields[0];
  const value = first ? displayValue(first, record.data[first.key]) : '';
  return value || 'without a name';
}

function Value({
  field,
  value,
  needed,
}: {
  field: CollectionField;
  value: FieldValue | undefined;
  needed: boolean;
}) {
  const shown = displayValue(field, value);
  if (shown) return <span className="break-words">{shown}</span>;
  return <span className="text-ink-muted">{needed ? 'Needed' : ''}</span>;
}

/** What a draft is and where it came from, with the one tap that confirms it. */
function DraftNote({ stepId, record }: { stepId: string; record: CollectionRecord }) {
  const href = sourceHref(record.source, record.sourceRef);
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-small">
      <span className="text-ink-muted">
        Draft.{' '}
        {href ? (
          <a href={href} target="_blank" rel="noreferrer" className="underline">
            {SOURCE_LABELS[record.source]}
          </a>
        ) : (
          SOURCE_LABELS[record.source]
        )}
        . Check it, then confirm.
      </span>
      <ConfirmButton stepId={stepId} record={record} />
    </div>
  );
}

function ConfirmButton({
  stepId,
  record,
  compact = false,
}: {
  stepId: string;
  record: CollectionRecord;
  compact?: boolean;
}) {
  const toast = useToast();
  const [, confirm, confirming] = useActionState(
    async (_prev: InformationActionState, form: FormData) => {
      const result = await confirmRecordAction(form);
      if (result.error) toast({ text: result.error });
      else if (result.closed)
        toast({ text: 'Confirmed. The step has what it asked for and is closed.' });
      return result;
    },
    initial,
  );
  return (
    <form action={confirm}>
      <input type="hidden" name="stepId" value={stepId} />
      <input type="hidden" name="recordId" value={record.id} />
      <Button
        type="submit"
        size="sm"
        variant="secondary"
        pending={confirming}
        aria-label={
          compact ? `Confirm draft ${SOURCE_LABELS[record.source].toLowerCase()}` : undefined
        }
        title={compact ? `Draft, ${SOURCE_LABELS[record.source].toLowerCase()}` : undefined}
      >
        Confirm
      </Button>
    </form>
  );
}

/** The fields of one record, drawn from the definition. */
function RecordForm({
  stepId,
  collection,
  record,
  asked,
  onDone,
  onCancel,
}: {
  stepId: string;
  collection: Collection;
  record: CollectionRecord | null;
  asked: CollectionField[];
  onDone?: () => void;
  onCancel?: () => void;
}) {
  const toast = useToast();
  const [state, save, saving] = useActionState(
    async (prev: InformationActionState, form: FormData) => {
      const result = await saveRecordAction(prev, form);
      if (!result.error) {
        if (result.closed) toast({ text: 'Saved. The step has what it asked for and is closed.' });
        onDone?.();
      }
      return result;
    },
    initial,
  );
  const askedKeys = new Set(asked.map((f) => f.key));
  const fields = liveFields(collection.fields);
  const formId = useId();

  return (
    <form action={save} className="space-y-3">
      <input type="hidden" name="stepId" value={stepId} />
      {record && <input type="hidden" name="recordId" value={record.id} />}
      <div className="grid gap-3 sm:grid-cols-2">
        {fields.map((field) => (
          <Field
            key={field.key}
            id={`${formId}-${field.key}`}
            label={
              askedKeys.has(field.key) || asked.length === fields.length
                ? field.label
                : `${field.label} (optional)`
            }
            error={state.field === field.key ? state.error : undefined}
            className={field.type === 'long_text' ? 'sm:col-span-2' : undefined}
          >
            <FieldInput
              id={`${formId}-${field.key}`}
              field={field}
              value={record?.data[field.key]}
            />
          </Field>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" size="sm" pending={saving}>
          {record?.draft ? 'Save and confirm' : record ? 'Save' : 'Add'}
        </Button>
        {onCancel && (
          <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        )}
        {state.error && !state.field && (
          <span className="text-small text-danger">{state.error}</span>
        )}
        {state.error && state.field && !fields.some((f) => f.key === state.field) && (
          <span className="text-small text-danger">{state.error}</span>
        )}
      </div>
    </form>
  );
}

function FieldInput({
  id,
  field,
  value,
}: {
  id: string;
  field: CollectionField;
  value: FieldValue | undefined;
}) {
  const name = `${VALUE_PREFIX}${field.key}`;
  const defaultValue = inputValue(field, value);
  switch (field.type) {
    case 'long_text':
      return <Textarea id={id} name={name} rows={2} defaultValue={defaultValue} />;
    case 'number':
    case 'money':
    case 'percent':
      return (
        <Input
          id={id}
          name={name}
          inputMode="decimal"
          autoComplete="off"
          defaultValue={defaultValue}
        />
      );
    case 'day_of_month':
      return (
        <Input
          id={id}
          name={name}
          inputMode="numeric"
          autoComplete="off"
          defaultValue={defaultValue}
        />
      );
    case 'date':
      return <Input id={id} name={name} type="date" defaultValue={defaultValue} />;
    case 'link':
      return <Input id={id} name={name} type="url" inputMode="url" defaultValue={defaultValue} />;
    case 'yes_no':
      return (
        <Select id={id} name={name} defaultValue={defaultValue}>
          <option value="">Not said</option>
          <option value="yes">Yes</option>
          <option value="no">No</option>
        </Select>
      );
    case 'choice': {
      const options = field.options ?? [];
      // A value kept from before an option was taken off stays choosable.
      const kept = defaultValue && !options.includes(defaultValue) ? [defaultValue] : [];
      return (
        <Select id={id} name={name} defaultValue={defaultValue}>
          <option value="">Not chosen</option>
          {[...kept, ...options].map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </Select>
      );
    }
    default:
      return <Input id={id} name={name} autoComplete="off" defaultValue={defaultValue} />;
  }
}
