'use client';

import { useActionState, useId, useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { Disclosure } from '@/components/ui/disclosure';
import { Field, FieldError, Input, Textarea } from '@/components/ui/field';
import { useToast } from '@/components/ui/toast';
import { liveFields, type CollectionField } from '@/lib/goals/collections';
import { formatDay } from '@/lib/goals/dates';
import {
  KIND_NAME_MAX,
  KIND_NOTE_PREFIX,
  RECOGNISE_MAX,
  FIELD_NOTE_MAX,
  type LearnedKind,
} from '@/lib/goals/document-kinds';
import {
  forgetDocumentKindAction,
  saveDocumentKindAction,
  type KindActionState,
} from './document-actions';

/**
 * The kinds of document an information step's form has learned (plan #987):
 * for each, what it is called, how to recognise another one, the note for
 * each field that the reader follows, and the suggestions left out. Each can
 * be edited or forgotten here. Folded, since it is read rarely, with the
 * kinds' names on the closed line.
 */
export function DocumentKinds({
  stepId,
  kinds,
  fields,
}: {
  stepId: string;
  kinds: LearnedKind[];
  fields: CollectionField[];
}) {
  if (kinds.length === 0) return null;
  return (
    <Disclosure title="Documents it has learned" meta={kinds.map((k) => k.name).join(', ')}>
      <ul className="space-y-3">
        {kinds.map((kind) => (
          <KindRow key={kind.id} stepId={stepId} kind={kind} fields={fields} />
        ))}
      </ul>
    </Disclosure>
  );
}

function KindRow({
  stepId,
  kind,
  fields,
}: {
  stepId: string;
  kind: LearnedKind;
  fields: CollectionField[];
}) {
  const [editing, setEditing] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();
  const live = liveFields(fields);
  const notes = live.filter((f) => kind.fieldNotes[f.key]);

  if (editing) {
    return (
      <li>
        <KindForm stepId={stepId} kind={kind} fields={live} onDone={() => setEditing(false)} />
      </li>
    );
  }

  const forget = () =>
    start(async () => {
      const form = new FormData();
      form.set('kindId', kind.id);
      const result = await forgetDocumentKindAction(form);
      if (result.error) setError(result.error);
      else toast({ text: `Forgot ${kind.name}. The next one is read as new.` });
    });

  return (
    <li className="space-y-1">
      <p className="text-body font-medium text-ink">
        {kind.name}
        {kind.lastReadAt && (
          <span className="text-small font-normal text-ink-muted">
            {' '}
            · last read {formatDay(kind.lastReadAt.slice(0, 10))}
          </span>
        )}
      </p>
      {kind.recognise && (
        <p className="text-small text-ink-muted">Recognised by: {kind.recognise}</p>
      )}
      {kind.senders.length > 0 && (
        <p className="text-small text-ink-muted">
          Comes from: {kind.senders.join(', ')}. Dash looks for new ones in Gmail each morning.
        </p>
      )}
      {notes.length > 0 && (
        <ul className="space-y-0.5">
          {notes.map((field) => (
            <li key={field.key} className="text-small text-ink">
              <span className="font-medium">{field.label}:</span> {kind.fieldNotes[field.key]}
            </li>
          ))}
        </ul>
      )}
      {kind.skipped.length > 0 && (
        <p className="text-small text-ink-muted">Not suggested again: {kind.skipped.join(', ')}</p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(true)}>
          Edit
        </Button>
        <Button type="button" size="sm" variant="ghost" pending={pending} onClick={forget}>
          Forget
        </Button>
      </div>
      <FieldError>{error}</FieldError>
    </li>
  );
}

function KindForm({
  stepId,
  kind,
  fields,
  onDone,
}: {
  stepId: string;
  kind: LearnedKind;
  fields: CollectionField[];
  onDone: () => void;
}) {
  const formId = useId();
  const toast = useToast();
  const [state, save, saving] = useActionState(
    async (prev: KindActionState, form: FormData) => {
      const result = await saveDocumentKindAction(prev, form);
      if (!result.error) {
        toast({ text: 'Saved. The next document of this kind is read with it.' });
        onDone();
      }
      return result;
    },
    {},
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
      <input type="hidden" name="kindId" value={kind.id} />
      <Field id={`${formId}-name`} label="Name">
        <Input
          id={`${formId}-name`}
          name="name"
          defaultValue={kind.name}
          maxLength={KIND_NAME_MAX}
          required
        />
      </Field>
      <Field
        id={`${formId}-recognise`}
        label="How to recognise it"
        hint="Its title or header, who sends it, its layout. The reader judges each new document against this."
      >
        <Textarea
          id={`${formId}-recognise`}
          name="recognise"
          rows={2}
          defaultValue={kind.recognise}
          maxLength={RECOGNISE_MAX}
        />
      </Field>
      <Field
        id={`${formId}-senders`}
        label="Who sends it"
        hint="An address, a domain or a name, one a line. Dash searches Gmail for new ones from these each morning. Leave it empty for a document that is not emailed."
      >
        <Textarea
          id={`${formId}-senders`}
          name="senders"
          rows={1}
          defaultValue={kind.senders.join('\n')}
        />
      </Field>
      {fields.map((field) => (
        <Field
          key={field.key}
          id={`${formId}-${field.key}`}
          label={`${field.label}: where it comes from`}
        >
          <Textarea
            id={`${formId}-${field.key}`}
            name={`${KIND_NOTE_PREFIX}${field.key}`}
            rows={1}
            defaultValue={kind.fieldNotes[field.key] ?? ''}
            maxLength={FIELD_NOTE_MAX}
          />
        </Field>
      ))}
      <Field
        id={`${formId}-skipped`}
        label="Not suggested again"
        hint="One label a line. Clear one to have it suggested next time."
      >
        <Textarea
          id={`${formId}-skipped`}
          name="skipped"
          rows={2}
          defaultValue={kind.skipped.join('\n')}
        />
      </Field>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" size="sm" pending={saving}>
          Save
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>
      <FieldError>{state.error}</FieldError>
    </form>
  );
}
