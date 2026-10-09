'use client';

import { useState, useTransition } from 'react';
import { Trash2 } from 'lucide-react';
import { AddTrigger } from '@/components/ui/add-trigger';
import { Button } from '@/components/ui/button';
import { PaidHint } from '@/components/ui/paid-hint';
import { cardVariants } from '@/components/ui/card';
import { SectionFold } from '@/components/ui/disclosure';
import { Field, FieldError, Input, Textarea } from '@/components/ui/field';
import { Segmented } from '@/components/ui/segmented';
import { useToast } from '@/components/ui/toast';
import { cn } from '@/lib/cn';
import { formatDay } from '@/lib/goals/dates';
import {
  NOTE_MAX,
  TEST_NAME_MAX,
  TYPED_KINDS,
  TYPED_VALUE_MAX,
  type TypedKind,
  type TypedResult,
} from '@/lib/learn/personality/model';
import { deleteTypedAction, restoreTypedAction, saveTypedAction } from './actions';

/**
 * Types from other tests (plan #1633): a Myers-Briggs type, an Enneagram
 * number or another test's result, typed in as the person has it. Myers-
 * Briggs questions are copyrighted, so those types are entered, never
 * tested. Nothing is scored or checked against a list.
 *
 * The list is newest first by the day taken. A delete happens at once and
 * the toast offers it back for six seconds.
 */

type FieldName = 'testName' | 'typedValue' | 'takenAt' | 'note';

function byDay(a: TypedResult, b: TypedResult): number {
  return b.takenAt.localeCompare(a.takenAt) || b.createdAt.localeCompare(a.createdAt);
}

export function OtherTests({
  results,
  today,
  initialOpen = false,
}: {
  results: readonly TypedResult[];
  /** The person's own day, `YYYY-MM-DD`: the form's default and its latest. */
  today: string;
  /** The gallery's way in, to draw the form open. */
  initialOpen?: boolean;
}) {
  const toast = useToast();
  const [rows, setRows] = useState<TypedResult[]>(() => [...results].sort(byDay));

  function remove(row: TypedResult) {
    setRows((current) => current.filter((r) => r.id !== row.id));
    void deleteTypedAction(row.id).then((outcome) => {
      if ('error' in outcome) {
        setRows((current) => [...current, row].sort(byDay));
        toast({ text: outcome.error });
        return;
      }
      toast({
        text: `Deleted ${row.typedValue} from ${row.testName}`,
        undone: `${row.typedValue} is back`,
        undo: async () => {
          const back = await restoreTypedAction(outcome.removed);
          if ('error' in back) throw new Error(back.error);
          setRows((current) => [...current, back.result].sort(byDay));
        },
      });
    });
  }

  const adding = (
    <div className="mt-3">
      <TypedCompose
        today={today}
        initialOpen={initialOpen}
        onSaved={(result) => setRows((current) => [...current, result].sort(byDay))}
      />
    </div>
  );

  // With nothing kept, the heading says what the section is for once; with
  // types kept, it folds by its heading and the closed line carries the count.
  if (rows.length === 0) {
    return (
      <section
        id="other-tests"
        aria-labelledby="other-tests-title"
        className="max-w-2xl scroll-mt-24"
      >
        <h2 id="other-tests-title" className="text-body font-semibold text-ink">
          From other tests
        </h2>
        <p className="mt-0.5 text-small text-ink-muted">
          A Myers-Briggs type, an Enneagram number or another test&rsquo;s result, kept as you write
          it.
        </p>
        {adding}
      </section>
    );
  }

  return (
    <section id="other-tests" className="max-w-2xl scroll-mt-24">
      <SectionFold
        title="From other tests"
        count={rows.length}
        remember="learn-personality-other-tests"
      >
        <ul className={cn(cardVariants(), 'divide-y divide-border')}>
          {rows.map((row) => (
            <li key={row.id} className="flex items-start gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-baseline gap-x-2">
                  <span className="break-words text-body font-medium text-ink">
                    {row.typedValue}
                  </span>
                  <span className="break-words text-small text-ink-muted">{row.testName}</span>
                </p>
                <p className="mt-0.5 text-small text-ink-muted">
                  Taken {formatDay(row.takenAt, true)}
                </p>
                {row.note ? (
                  <p className="mt-1 break-words text-small text-ink">{row.note}</p>
                ) : null}
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="shrink-0"
                onClick={() => remove(row)}
                aria-label={`Delete ${row.typedValue} from ${row.testName}`}
              >
                <Trash2 className="size-4" strokeWidth={1.75} aria-hidden />
              </Button>
            </li>
          ))}
        </ul>
        {adding}
      </SectionFold>
    </section>
  );
}

/**
 * The way to add one: the AddTrigger line until it is pressed, then the
 * form, which closes again on save or cancel (law 14).
 */
function TypedCompose({
  today,
  initialOpen,
  onSaved,
}: {
  today: string;
  initialOpen: boolean;
  onSaved: (result: TypedResult) => void;
}) {
  const [open, setOpen] = useState(initialOpen);
  if (!open) {
    return <AddTrigger label="Add a type from another test" onClick={() => setOpen(true)} />;
  }
  return (
    <TypedForm
      today={today}
      onSaved={(result) => {
        onSaved(result);
        setOpen(false);
      }}
      onCancel={() => setOpen(false)}
    />
  );
}

function TypedForm({
  today,
  onSaved,
  onCancel,
}: {
  today: string;
  onSaved: (result: TypedResult) => void;
  onCancel: () => void;
}) {
  const [kind, setKind] = useState<TypedKind>('mbti');
  const [testName, setTestName] = useState('');
  const [typedValue, setTypedValue] = useState('');
  const [takenAt, setTakenAt] = useState(today);
  const [note, setNote] = useState('');
  const [error, setError] = useState<{ text: string; field?: FieldName } | null>(null);
  const [pending, startTransition] = useTransition();

  const choice = TYPED_KINDS.find((k) => k.kind === kind) ?? TYPED_KINDS[0];
  const errorFor = (field: FieldName) => (error?.field === field ? error.text : undefined);

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    startTransition(async () => {
      const outcome = await saveTypedAction({ kind, testName, typedValue, takenAt, note });
      if ('error' in outcome) {
        setError({ text: outcome.error, field: outcome.field });
        return;
      }
      onSaved(outcome.result);
    });
  }

  return (
    <form
      onSubmit={submit}
      className={cn(cardVariants({ padding: 'standard' }), 'space-y-4')}
      aria-label="Add a type from another test"
    >
      <div>
        <p className="mb-1 text-small font-medium text-ink-muted">Which test</p>
        <Segmented
          value={kind}
          options={TYPED_KINDS.map((k) => ({ value: k.kind, label: k.label }))}
          onChange={(value) => {
            setKind(value);
            setError(null);
          }}
          label="Which test"
          disabled={pending}
        />
      </div>

      {choice.testName === null ? (
        <Field id="typed-test-name" label="The test's name" error={errorFor('testName')}>
          <Input
            id="typed-test-name"
            value={testName}
            onChange={(event) => setTestName(event.target.value)}
            maxLength={TEST_NAME_MAX}
            placeholder="16Personalities, DISC, StrengthsFinder…"
            disabled={pending}
            autoComplete="off"
          />
        </Field>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="typed-value" label="Your result" error={errorFor('typedValue')}>
          <Input
            id="typed-value"
            value={typedValue}
            onChange={(event) => setTypedValue(event.target.value)}
            maxLength={TYPED_VALUE_MAX}
            placeholder={choice.example}
            disabled={pending}
            autoComplete="off"
            autoFocus
          />
        </Field>
        <Field id="typed-taken" label="Taken on" error={errorFor('takenAt')}>
          <Input
            id="typed-taken"
            type="date"
            value={takenAt}
            max={today}
            onChange={(event) => setTakenAt(event.target.value)}
            disabled={pending}
          />
        </Field>
      </div>

      <Field id="typed-note" label="A line of your own, if you like" error={errorFor('note')}>
        <Textarea
          id="typed-note"
          value={note}
          onChange={(event) => setNote(event.target.value)}
          maxLength={NOTE_MAX}
          rows={2}
          placeholder="Where you took it, or how well it fits"
          disabled={pending}
        />
      </Field>

      {error && !error.field ? <FieldError>{error.text}</FieldError> : null}

      <div className="flex items-center gap-2">
        <Button type="submit" pending={pending}>
          {pending ? 'Saving…' : 'Save'}
        </Button>
        <PaidHint
          action="app/learn/know/personality/actions.ts#saveTypedAction"
          what="Cost of Dash reading your type against your notes"
        />
        <Button type="button" variant="ghost" onClick={onCancel} disabled={pending}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
