'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Field, Input, Textarea } from '@/components/ui/field';
import { formatMoney } from '@/lib/money';
import { confirmImport, previewImport, type NewTrackState, type PreviewRow } from './actions';

/**
 * Paste, then confirm.
 *
 * Two forms rather than one screen with a spinner in the middle, because the
 * middle takes real time -- one searching call per reference -- and pretending
 * otherwise makes the wait feel broken instead of busy.
 */

const ACCESS_NOTE: Record<string, string | null> = {
  open: null,
  paywalled: 'Paywalled',
  purchase: 'Buy',
  library: 'Library',
  unknown: 'Access unknown',
};

function SubmitButton({ idle, busy }: { idle: string; busy: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? busy : idle}
    </Button>
  );
}

function ResolvedRow({ row, index }: { row: PreviewRow; index: number }) {
  if (!row.resolved) {
    // A citation that could not be placed. Shown rather than dropped: knowing
    // the resolver failed on this one is what stops you assuming the list was
    // complete.
    return (
      <li className="flex gap-3 px-4 py-3">
        <span className="pt-0.5">
          <AlertTriangle className="size-4 text-caution" strokeWidth={2} aria-hidden />
        </span>
        <span className="min-w-0">
          <span className="block text-body text-ink-muted line-through decoration-border">
            {row.raw}
          </span>
          <span className="mt-0.5 block text-ui text-ink-muted">
            {row.error ?? 'Could not be found.'}
          </span>
        </span>
      </li>
    );
  }

  const resolved = row.resolved;
  const access = ACCESS_NOTE[resolved.access] ?? null;
  const price =
    resolved.price_cents !== null && resolved.price_cents !== undefined
      ? formatMoney(resolved.price_cents)
      : null;
  const id = `row-${index}`;

  return (
    <li className="flex gap-3 px-4 py-3">
      <input
        type="checkbox"
        id={id}
        name="row"
        value={JSON.stringify({ resolved, why: row.why })}
        defaultChecked
        className="mt-1 size-4 shrink-0 accent-[var(--color-accent)]"
      />
      <label htmlFor={id} className="min-w-0 flex-1 cursor-pointer">
        <span className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <span className="text-body font-medium text-ink">{resolved.title}</span>
          {resolved.author && <span className="text-ui text-ink-muted">{resolved.author}</span>}
          {access && (
            <span className="rounded-pill border border-border px-1.5 py-0.5 text-caption text-ink-muted">
              {price ? `${access} · ${price}` : access}
            </span>
          )}
        </span>

        {resolved.locator_label && (
          <span className="mt-0.5 block text-ui text-ink">{resolved.locator_label}</span>
        )}

        {/* The basis, on the confirm screen and not only after saving: this is
            the moment to untick a chapter number nobody checked. */}
        <span className="mt-0.5 block text-ui text-ink-muted">{resolved.locator_basis}</span>

        {resolved.canonical_url ? (
          <span className="mt-0.5 block truncate text-caption text-ink-muted">
            {resolved.canonical_url}
          </span>
        ) : (
          <span className="mt-0.5 block text-caption text-ink-muted">
            No free link found — the location still tells you where to look.
          </span>
        )}
      </label>
    </li>
  );
}

export function ImportForm() {
  const [previewState, preview] = useActionState<NewTrackState, FormData>(previewImport, {});
  const [confirmState, confirm] = useActionState<NewTrackState, FormData>(confirmImport, {});

  if (previewState.preview) {
    const found = previewState.preview.rows.filter((row) => row.resolved).length;

    return (
      <form action={confirm}>
        <input type="hidden" name="rawText" value={previewState.preview.rawText} />
        <input type="hidden" name="question" value={previewState.preview.question ?? ''} />
        <input type="hidden" name="sourceHint" value={previewState.preview.sourceHint ?? ''} />

        <Field label="Call this track" id="title">
          <Input id="title" name="title" defaultValue={previewState.preview.title} required />
        </Field>

        <p className="mb-2 mt-5 text-body text-ink-muted">
          {found} of {previewState.preview.rows.length} placed. Untick anything you do not want.
        </p>

        <ul className="divide-y divide-border overflow-hidden rounded-card border border-border bg-surface">
          {previewState.preview.rows.map((row, index) => (
            <ResolvedRow key={`${row.raw}-${index}`} row={row} index={index} />
          ))}
        </ul>

        <div className="mt-4 flex items-center gap-3">
          <SubmitButton idle="Save this track" busy="Saving…" />
          {confirmState.error && <span className="text-ui text-danger">{confirmState.error}</span>}
        </div>
      </form>
    );
  }

  return (
    <form action={preview}>
      <Field
        label="What are you trying to work out?"
        id="question"
        hint="Optional, and the most useful thing here. A specific question gets a better answer than a topic — and it is what each source gets aimed at when you open it."
      >
        <Textarea
          id="question"
          name="question"
          rows={3}
          placeholder="Price is supposed to quantify value, but it only reports an equilibrium — and the equilibrium depends on how much money everyone started with."
        />
      </Field>

      <Field
        label="Paste what you were told to read"
        id="text"
        hint="A reply from a chat, a syllabus, a footnote, a friend's text message. Anything."
      >
        <Textarea id="text" name="text" rows={10} required />
      </Field>

      <Field label="Where did it come from?" id="sourceHint" hint="Optional.">
        <Input id="sourceHint" name="sourceHint" placeholder="claude" />
      </Field>

      <div className="mt-4 flex items-center gap-3">
        <SubmitButton idle="Find these" busy="Searching…" />
        {previewState.error && <span className="text-ui text-danger">{previewState.error}</span>}
      </div>

      <p className="mt-3 text-caption text-ink-muted">
        This searches for each item, which takes a moment. Nothing is saved until you confirm.
      </p>
    </form>
  );
}
