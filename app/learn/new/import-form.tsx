'use client';

import { useActionState, useEffect, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Field, Input, Textarea } from '@/components/ui/field';
import { formatMoney } from '@/lib/money';
import {
  confirmImport,
  parseImport,
  resolveCandidate,
  type NewTrackState,
  type ParsedImport,
  type ParseState,
  type PreviewRow,
} from './actions';
import { cardVariants } from '@/components/ui/card';
import { cn } from '@/lib/cn';

/**
 * Paste, watch it fill in, confirm.
 *
 * The screen used to make one request that parsed the paste and then searched
 * for every citation before answering, which meant a minute of spinner saying
 * nothing and, on a long list, a request the platform would eventually cut off
 * -- losing all of it.
 *
 * Now the paste is parsed on its own, which takes a second, and the list
 * appears straight away. Each citation is then searched for in its own
 * request, a few at a time, and each row replaces its own spinner as it lands.
 * The total work is identical. The difference is that you can see it
 * happening, and that no single request is long enough to be worth cutting off.
 */

/** How many searches run at once. Enough to feel parallel, not enough to be rude. */
const CONCURRENCY = 5;

const ACCESS_NOTE: Record<string, string | null> = {
  open: null,
  paywalled: 'Paywalled',
  purchase: 'Buy',
  library: 'Library',
  unknown: 'Access unknown',
};

/** A row that has not come back yet. */
type PendingRow = { raw: string; why: string | null };
type Slot = { state: 'pending'; row: PendingRow } | { state: 'done'; row: PreviewRow };

function SubmitButton({ idle, busy }: { idle: string; busy: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? busy : idle}
    </Button>
  );
}

function PendingCard({ row }: { row: PendingRow }) {
  return (
    <li className="flex gap-3 px-4 py-3">
      <span className="pt-0.5">
        <Loader2 className="size-4 animate-spin text-ink-muted" strokeWidth={2} aria-hidden />
      </span>
      <span className="min-w-0">
        <span className="block truncate text-body text-ink-muted">{row.raw}</span>
        <span className="mt-0.5 block text-ui text-ink-muted">Looking…</span>
      </span>
    </li>
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
        className="mt-1 size-4 shrink-0 accent-accent"
      />
      <label htmlFor={id} className="min-w-0 flex-1 cursor-pointer">
        <span className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <span className="text-body font-medium text-ink">{resolved.title}</span>
          {resolved.author && <span className="text-ui text-ink-muted">{resolved.author}</span>}
          {access && (
            <span className="rounded-pill bg-sunken px-1.5 py-0.5 text-small text-ink-muted">
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
          <span className="mt-0.5 block truncate text-small text-ink-muted">
            {resolved.canonical_url}
          </span>
        ) : (
          <span className="mt-0.5 block text-small text-ink-muted">
            No free link found — the location still tells you where to look.
          </span>
        )}
      </label>
    </li>
  );
}

/**
 * The list, filling in.
 *
 * Its own component, keyed on the paste, so a second import starts from a
 * clean slate by being remounted rather than by an effect resetting state --
 * which is both the React-sanctioned way to do it and the one that cannot
 * leave a stale row from the previous list on screen.
 *
 * The searches run a few at a time. A twenty-item paste opening twenty
 * requests would be rude to the search behind them and gain nothing: the
 * first five already saturate the wait.
 */
function ResolvingList({ parsed }: { parsed: ParsedImport }) {
  const [slots, setSlots] = useState<Slot[]>(() =>
    parsed.candidates.map((candidate) => ({
      state: 'pending' as const,
      row: { raw: candidate.raw, why: candidate.why },
    })),
  );

  useEffect(() => {
    let cancelled = false;
    const candidates = parsed.candidates;
    let next = 0;

    async function worker() {
      for (;;) {
        const index = next;
        next += 1;
        if (index >= candidates.length || cancelled) return;

        let row: PreviewRow;
        try {
          row = await resolveCandidate({
            candidate: candidates[index]!,
            question: parsed.question,
          });
        } catch {
          // The request itself failed. One row says so; the rest carry on.
          row = {
            raw: candidates[index]!.raw,
            why: candidates[index]!.why,
            resolved: null,
            error: 'That lookup did not come back. Save the rest and try this one later.',
          };
        }
        if (cancelled) return;
        setSlots((current) => {
          const copy = [...current];
          copy[index] = { state: 'done', row };
          return copy;
        });
      }
    }

    void Promise.all(
      Array.from({ length: Math.min(CONCURRENCY, candidates.length) }, () => worker()),
    );

    return () => {
      cancelled = true;
    };
  }, [parsed]);

  const done = slots.filter((slot) => slot.state === 'done');
  const stillGoing = slots.length - done.length;
  const found = done.filter((slot) => slot.state === 'done' && slot.row.resolved).length;

  return (
    <>
      <p className="mb-2 mt-5 text-body text-ink-muted">
        {stillGoing > 0
          ? `${found} of ${slots.length} found, ${stillGoing} still looking. You can save as soon as the ones you want are in.`
          : `${found} of ${slots.length} placed. Untick anything you do not want.`}
      </p>

      <ul className={cn(cardVariants(), 'divide-y divide-border overflow-hidden')}>
        {slots.map((slot, index) =>
          slot.state === 'done' ? (
            <ResolvedRow key={`${slot.row.raw}-${index}`} row={slot.row} index={index} />
          ) : (
            <PendingCard key={`${slot.row.raw}-${index}`} row={slot.row} />
          ),
        )}
      </ul>
    </>
  );
}

export function ImportForm() {
  const [parseState, parse] = useActionState<ParseState, FormData>(parseImport, {});
  const [confirmState, confirm] = useActionState<NewTrackState, FormData>(confirmImport, {});
  const parsed = parseState.parsed;

  if (parsed) {
    return (
      <form action={confirm}>
        <input type="hidden" name="rawText" value={parsed.rawText} />
        <input type="hidden" name="question" value={parsed.question ?? ''} />
        <input type="hidden" name="sourceHint" value={parsed.sourceHint ?? ''} />

        <Field label="Call this track" id="title">
          <Input id="title" name="title" defaultValue={parsed.title} required />
        </Field>

        <ResolvingList key={parsed.rawText} parsed={parsed} />

        <div className="mt-4 flex items-center gap-3">
          {/* Deliberately not disabled while rows are still landing. If the
              three you wanted are already in, there is no reason to make you
              wait on a fourth you were going to untick anyway. */}
          <SubmitButton idle="Save this track" busy="Saving…" />
          {confirmState.error && <span className="text-ui text-danger">{confirmState.error}</span>}
        </div>
      </form>
    );
  }

  return (
    <form action={parse}>
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
        {/* ui-ok: composer-always-open -- the create. The pasted text is the
          * whole point of the page and there is nothing to read before it. */}
        <Textarea id="text" name="text" rows={10} required />
      </Field>

      <Field label="Where did it come from?" id="sourceHint" hint="Optional.">
        <Input id="sourceHint" name="sourceHint" placeholder="claude" />
      </Field>

      <div className="mt-4 flex items-center gap-3">
        <SubmitButton idle="Read the list" busy="Reading…" />
        {parseState.error && <span className="text-ui text-danger">{parseState.error}</span>}
      </div>

      <p className="mt-3 text-small text-ink-muted">
        The list appears straight away, then each item is looked up one at a time. Nothing is saved
        until you confirm.
      </p>
    </form>
  );
}
