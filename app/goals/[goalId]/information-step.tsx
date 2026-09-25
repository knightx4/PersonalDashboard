'use client';

import { useActionState, useId, useState } from 'react';
import { ActionMenu, type ActionMenuItem } from '@/components/ui/action-menu';
import { AddTrigger } from '@/components/ui/add-trigger';
import { Button } from '@/components/ui/button';
import { Disclosure, Group } from '@/components/ui/disclosure';
import { Field, Input } from '@/components/ui/field';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { useToast } from '@/components/ui/toast';
import { ValueList, ValueRow } from '@/components/ui/value-row';
import {
  MAX_QUESTION_LENGTH,
  QUESTION_PREFIX,
  sourcesLine,
  type StepAnswer,
  type StepQuestion,
} from '@/lib/goals/answers';
import { idField, liveFields, type CollectionField } from '@/lib/goals/collections';
import type { Collection, CollectionRecord } from '@/lib/goals/collections-store';
import {
  SOURCE_LABELS,
  askedFields,
  displayValue,
  informationProgress,
  missingFields,
  progressLine,
  sourceHref,
  sourceLabel,
  unfinishedReason,
} from '@/lib/goals/information';
import type { StepNode } from '@/lib/goals/steps';
import {
  archiveRecordAction,
  confirmRecordAction,
  saveQuestionsAction,
  saveRecordAction,
  type InformationActionState,
} from './information-actions';
import { FieldInput } from './field-input';
import { FillFromDocument } from './fill-from-document';
import { RecordValue } from './record-value';

/**
 * The record or table on an information step (plan #954; docs/GOALS-SPEC.md,
 * "Information steps and collections"). A one-record collection is a list of
 * its values; a list is a table with a row per item, which the table
 * primitive stacks into label and value pairs on a phone. Either way the
 * values are text, and each one is changed where it is read (plan #1040).
 * Only the fields the step asks for are out: a one-record step folds the
 * rest, and a list shows them for one row at a time. Rows found for you are
 * drafts, marked with where they came from, until one tap confirms them.
 * Pasted text or a document fills the form in as a preview first (plan
 * #955), and the full form is kept for adding a record.
 */

const initial: InformationActionState = {};

/**
 * A list step's state on arrival, for the gallery: a row's other fields
 * showing, and one value's editor open. Nothing in the app passes it.
 */
export type InformationSeam = {
  openRow?: string;
  editing?: { recordId: string; key: string };
};

export function InformationStep({
  node,
  collection,
  records,
  answers,
  seam,
}: {
  node: StepNode;
  collection: Collection;
  records: CollectionRecord[];
  /** What the goals routine worked out from these records (plan #989). */
  answers: StepAnswer[];
  seam?: InformationSeam;
}) {
  const asked = askedFields(collection.fields, node.asksFor ?? null);
  const questions = node.questions ?? [];
  const progress = informationProgress(asked, records, questions, answers);
  const line = progressLine(collection.shape, progress);
  const reason = node.status === 'open' ? unfinishedReason(progress) : null;

  return (
    <div className="mt-2 space-y-2 px-1">
      <Questions
        stepId={node.id}
        questions={questions}
        answers={answers}
        fields={collection.fields}
        records={records}
      />
      {line && <p className="text-small text-ink-muted">{line}</p>}
      {reason && <p className="text-small text-ink-muted">{reason}</p>}
      {collection.shape === 'one' ? (
        <OneRecord node={node} collection={collection} record={records[0] ?? null} asked={asked} />
      ) : (
        <RecordTable
          node={node}
          collection={collection}
          records={records}
          asked={asked}
          seam={seam}
        />
      )}
    </div>
  );
}

/**
 * What the step has to answer, above the figures that answer it (plans #989,
 * #991): each question with the answer the goals routine worked out, and a
 * line naming the rows it read and the date of their figures, or that it is
 * not answered yet. An answer whose rows have changed since says so until the
 * morning run works it again. An answer to a question the step no longer
 * lists is still shown, after the rest. The questions are edited here.
 */
function Questions({
  stepId,
  questions,
  answers,
  fields,
  records,
}: {
  stepId: string;
  questions: StepQuestion[];
  answers: StepAnswer[];
  fields: CollectionField[];
  records: CollectionRecord[];
}) {
  const [editing, setEditing] = useState(false);
  const byKey = new Map(answers.map((a) => [a.key, a]));
  const listed = new Set(questions.map((q) => q.key));
  const rows = [
    ...questions.map((q) => ({ key: q.key, question: q.question, answer: byKey.get(q.key) })),
    ...answers
      .filter((a) => !listed.has(a.key))
      .map((a) => ({ key: a.key, question: a.question, answer: a })),
  ];

  if (editing) {
    return (
      <QuestionsForm stepId={stepId} questions={questions} onDone={() => setEditing(false)} />
    );
  }
  return (
    <div className="space-y-1">
      {rows.length > 0 && (
        <ValueList>
          {rows.map(({ key, question, answer }) => (
            <ValueRow
              key={key}
              label={question}
              value={
                answer ? (
                  <div className="space-y-0.5">
                    <p>{answer.answer}</p>
                    <p className="text-small text-ink-muted">
                      {sourcesLine(answer.sources, fields, records)}
                    </p>
                    {answer.outOfDateAt && (
                      <p className="text-small text-caution">
                        Out of date: a row it used has changed. The morning run works it out again.
                      </p>
                    )}
                  </div>
                ) : (
                  <p className="text-ink-muted">Not answered yet</p>
                )
              }
            />
          ))}
        </ValueList>
      )}
      <AddTrigger
        label={questions.length > 0 ? 'Edit the questions' : 'Add the questions it answers'}
        onClick={() => setEditing(true)}
      />
    </div>
  );
}

/**
 * The step's questions as inputs, one per question and one blank for a new
 * one. Clearing a question's text takes it off the step. Escape or Cancel
 * closes it.
 */
function QuestionsForm({
  stepId,
  questions,
  onDone,
}: {
  stepId: string;
  questions: StepQuestion[];
  onDone: () => void;
}) {
  const toast = useToast();
  const formId = useId();
  const [state, save, saving] = useActionState(
    async (prev: InformationActionState, form: FormData) => {
      const result = await saveQuestionsAction(prev, form);
      if (!result.error) {
        toast({
          text: result.closed
            ? 'Saved. Every question has its answer, so the step is closed.'
            : 'Questions saved.',
        });
        onDone();
      }
      return result;
    },
    initial,
  );
  return (
    <form
      action={save}
      onKeyDown={(event) => {
        if (event.key === 'Escape') onDone();
      }}
      className="space-y-3 rounded-control bg-sunken p-3"
    >
      <input type="hidden" name="stepId" value={stepId} />
      {questions.map((q, i) => (
        <Field key={q.key} id={`${formId}-${q.key}`} label={`Question ${i + 1}`}>
          <Input
            id={`${formId}-${q.key}`}
            name={`${QUESTION_PREFIX}${q.key}`}
            defaultValue={q.question}
            maxLength={MAX_QUESTION_LENGTH}
          />
        </Field>
      ))}
      <Field
        id={`${formId}-new`}
        label={questions.length > 0 ? 'Another question (optional)' : 'What does this step answer?'}
      >
        <Input
          id={`${formId}-new`}
          name={`${QUESTION_PREFIX}new`}
          maxLength={MAX_QUESTION_LENGTH}
          placeholder="When does my first payment fall due?"
        />
      </Field>
      <p className="text-small text-ink-muted">
        The step closes once each question has an answer with the rows it came from. Clear a
        question to take it off.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" size="sm" pending={saving}>
          Save
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        {state.error && <span className="text-small text-danger">{state.error}</span>}
      </div>
    </form>
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
  const [filling, setFilling] = useState(false);
  const [adding, setAdding] = useState(false);
  if (filling) {
    return (
      <FillFromDocument
        stepId={node.id}
        collection={collection}
        onClose={() => setFilling(false)}
      />
    );
  }
  if (adding && !record) {
    return (
      <AddRecordForm
        stepId={node.id}
        collection={collection}
        asked={asked}
        onDone={() => setAdding(false)}
        onCancel={() => setAdding(false)}
      />
    );
  }
  const askedKeys = new Set(asked.map((f) => f.key));
  const rest = liveFields(collection.fields).filter((f) => !askedKeys.has(f.key));
  return (
    <div className="space-y-2">
      {record?.draft ? (
        <DraftNote stepId={node.id} record={record} />
      ) : (
        record && <SourceNote record={record} />
      )}
      {record && (
        <>
          <RecordValues stepId={node.id} record={record} fields={asked} asked={asked} />
          {rest.length > 0 && (
            <Disclosure title="Other fields" meta={filledCount(rest, record)}>
              <OtherValues stepId={node.id} record={record} fields={rest} asked={asked} />
            </Disclosure>
          )}
        </>
      )}
      {(!record || node.status === 'open') && (
        <div className="flex flex-wrap items-center gap-3">
          {!record && <AddTrigger label="Fill in by hand" onClick={() => setAdding(true)} />}
          {node.status === 'open' && (
            <AddTrigger label="Fill in from text or a document" onClick={() => setFilling(true)} />
          )}
        </div>
      )}
    </div>
  );
}

/** How many of these fields a record has a value for, as a fold's meta. */
function filledCount(fields: CollectionField[], record: CollectionRecord): string {
  const filled = fields.filter((f) => displayValue(f, record.data[f.key]) !== '').length;
  return `${filled} of ${fields.length} filled`;
}

/** A record's values as labelled text, each changed where it is read. */
function RecordValues({
  stepId,
  record,
  fields,
  asked,
}: {
  stepId: string;
  record: CollectionRecord;
  fields: CollectionField[];
  asked: CollectionField[];
}) {
  const missing = new Set(missingFields(asked, record.data).map((f) => f.key));
  return (
    <ValueList>
      {fields.map((f) => (
        <ValueRow
          key={f.key}
          label={f.label}
          value={
            <RecordValue
              stepId={stepId}
              recordId={record.id}
              field={f}
              value={record.data[f.key]}
              needed={missing.has(f.key)}
            />
          }
        />
      ))}
    </ValueList>
  );
}

/**
 * The fields a step does not ask for, those with a value first. Four or more
 * with none fold under one line: a loan's paperwork has a dozen fields, and a
 * dozen rows of "Not set" was most of what Show other fields drew (plan
 * #1043). Fewer than four stay out, since a fold costs a line of its own.
 */
const FOLD_UNSET_FROM = 4;

function OtherValues({
  stepId,
  record,
  fields,
  asked,
}: {
  stepId: string;
  record: CollectionRecord;
  fields: CollectionField[];
  asked: CollectionField[];
}) {
  const unset = fields.filter((f) => displayValue(f, record.data[f.key]) === '');
  if (unset.length < FOLD_UNSET_FROM) {
    return <RecordValues stepId={stepId} record={record} fields={fields} asked={asked} />;
  }
  const set = fields.filter((f) => !unset.includes(f));
  return (
    <div className="space-y-2">
      {set.length > 0 && (
        <RecordValues stepId={stepId} record={record} fields={set} asked={asked} />
      )}
      <Disclosure title="Not set" meta={`${unset.length} fields`}>
        <RecordValues stepId={stepId} record={record} fields={unset} asked={asked} />
      </Disclosure>
    </div>
  );
}

function RecordTable({
  node,
  collection,
  records,
  asked,
  seam,
}: {
  node: StepNode;
  collection: Collection;
  records: CollectionRecord[];
  asked: CollectionField[];
  seam?: InformationSeam;
}) {
  const [adding, setAdding] = useState(false);
  const [opened, setOpened] = useState<string | null>(seam?.openRow ?? null);
  const [filling, setFilling] = useState(false);
  const toast = useToast();
  const askedKeys = new Set(asked.map((f) => f.key));
  const id = idField(collection.fields);
  // The columns are what the step asks for, with the ID field that tells rows
  // apart. The rest are shown for one row at a time.
  const columns = liveFields(collection.fields).filter(
    (f) => askedKeys.has(f.key) || f.key === id?.key,
  );
  const columnKeys = new Set(columns.map((f) => f.key));
  const rest = liveFields(collection.fields).filter((f) => !columnKeys.has(f.key));
  const openedRecord = records.find((r) => r.id === opened) ?? null;

  async function archive(record: CollectionRecord) {
    const form = new FormData();
    form.set('recordId', record.id);
    const result = await archiveRecordAction(form);
    if (result.error) {
      toast({ text: result.error });
      return;
    }
    if (opened === record.id) setOpened(null);
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
        <Table aria-label={collection.name} flush>
          <THead>
            <tr>
              {columns.map((f) => (
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
                ...(rest.length > 0
                  ? [
                      {
                        id: 'fields',
                        label: opened === record.id ? 'Hide other fields' : 'Show other fields',
                        onSelect: () => setOpened(opened === record.id ? null : record.id),
                      },
                    ]
                  : []),
                {
                  id: 'archive',
                  label: 'Archive row',
                  destructive: true,
                  onSelect: () => void archive(record),
                },
              ];
              return (
                <TR key={record.id}>
                  {columns.map((f, i) => (
                    <TD key={f.key} label={f.label} primary={i === 0} num={isNumeric(f)}>
                      <RecordValue
                        stepId={node.id}
                        recordId={record.id}
                        field={f}
                        value={record.data[f.key]}
                        needed={missing.has(f.key)}
                        align={isNumeric(f) ? 'right' : 'left'}
                        inTable
                        startEditing={
                          seam?.editing?.recordId === record.id && seam.editing.key === f.key
                        }
                      />
                    </TD>
                  ))}
                  <TD className="max-md:justify-end">
                    <div className="flex items-center justify-end gap-1">
                      {!record.draft && <SourceLink record={record} truncate />}
                      {record.draft && <ConfirmButton stepId={node.id} record={record} compact />}
                      <ActionMenu label={`Row ${rowName(columns, record)} actions`} items={menu} />
                    </div>
                  </TD>
                </TR>
              );
            })}
          </TBody>
        </Table>
      )}

      {openedRecord && rest.length > 0 && (
        <Group
          title={rowName(columns, openedRecord)}
          action={
            <Button type="button" size="sm" variant="ghost" onClick={() => setOpened(null)}>
              Hide
            </Button>
          }
          className="rounded-control bg-sunken p-3"
        >
          <OtherValues stepId={node.id} record={openedRecord} fields={rest} asked={asked} />
        </Group>
      )}

      {filling ? (
        <FillFromDocument
          stepId={node.id}
          collection={collection}
          onClose={() => setFilling(false)}
        />
      ) : adding ? (
        <div className="rounded-control bg-sunken p-3">
          <AddRecordForm
            stepId={node.id}
            collection={collection}
                asked={asked}
            onDone={() => setAdding(false)}
            onCancel={() => setAdding(false)}
          />
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <AddTrigger label="Add a row" onClick={() => setAdding(true)} />
          <AddTrigger label="Fill in from text or a document" onClick={() => setFilling(true)} />
        </div>
      )}
    </div>
  );
}

function isNumeric(field: CollectionField): boolean {
  // A day of the month is a number too ("1st", "15th"), and set left beside a
  // right-set payment it read as part of the column before it.
  return (
    field.type === 'money' ||
    field.type === 'number' ||
    field.type === 'percent' ||
    field.type === 'day_of_month'
  );
}

function rowName(fields: CollectionField[], record: CollectionRecord): string {
  const first = fields[0];
  const value = first ? displayValue(first, record.data[first.key]) : '';
  return value || 'without a name';
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
            {sourceLabel(record.source, record.sourceRef)}
          </a>
        ) : (
          sourceLabel(record.source, record.sourceRef)
        )}
        . Check it, then confirm.
      </span>
      <ConfirmButton stepId={stepId} record={record} />
    </div>
  );
}

/** Where a confirmed record's values came from, when it was not typed. */
function SourceNote({ record }: { record: CollectionRecord }) {
  if (record.source === 'typed') return null;
  return (
    <p className="text-small text-ink-muted">
      <SourceLink record={record} />
    </p>
  );
}

/**
 * A record's source, linked to the email or stored file when there is one.
 * Cut short in a table's action cell, where it shares the width with the
 * row's buttons; whole on a line of its own.
 */
function SourceLink({ record, truncate = false }: { record: CollectionRecord; truncate?: boolean }) {
  if (record.source === 'typed') return null;
  const label = sourceLabel(record.source, record.sourceRef);
  const href = sourceHref(record.source, record.sourceRef);
  if (!href) return <span className="text-small text-ink-muted">{label}</span>;
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className={
        truncate
          ? 'inline-block max-w-40 truncate align-middle text-small text-ink-muted underline'
          : 'text-small [overflow-wrap:anywhere] text-ink-muted underline'
      }
      title={label}
    >
      {label}
    </a>
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

/**
 * Every field of a new record, drawn from the definition: the one place the
 * whole form stays, since the values of a record arrive together when it is
 * added (law 12). Escape or Cancel closes it.
 */
function AddRecordForm({
  stepId,
  collection,
  asked,
  onDone,
  onCancel,
}: {
  stepId: string;
  collection: Collection;
  asked: CollectionField[];
  onDone: () => void;
  onCancel: () => void;
}) {
  const [state, save, saving] = useActionState(
    async (prev: InformationActionState, form: FormData) => {
      const result = await saveRecordAction(prev, form);
      if (!result.error) onDone();
      return result;
    },
    initial,
  );
  const askedKeys = new Set(asked.map((f) => f.key));
  const fields = liveFields(collection.fields);
  const formId = useId();

  return (
    <form
      action={save}
      onKeyDown={(event) => {
        if (event.key === 'Escape') onCancel();
      }}
      className="space-y-3"
    >
      <input type="hidden" name="stepId" value={stepId} />
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
            <FieldInput id={`${formId}-${field.key}`} field={field} value={undefined} />
          </Field>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" size="sm" pending={saving}>
          Add
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
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
