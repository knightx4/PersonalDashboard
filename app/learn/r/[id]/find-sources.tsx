'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { formatMoney } from '@/lib/money';
import type { ResolvedSource } from '@/lib/learn/import/resolve-payload';
import {
  attachSource,
  findSources,
  type FindState,
  type ReadingActionState,
  type RootingNote,
} from './actions';
import { cardVariants } from '@/components/ui/card';
import { cn } from '@/lib/cn';

/**
 * Turning a subject you wrote down into something you can open.
 *
 * Pick one. Not several: this row is one specific thing you wanted to
 * understand, and it gets one answer. Handing back four and attaching all of
 * them would turn a queue you can work through into a pile you have to sort,
 * which is the thing the whole module exists to prevent.
 *
 * The rest are discarded on purpose. If a subject genuinely needs three
 * sources, it is three subjects.
 */

const ACCESS_NOTE: Record<string, string | null> = {
  open: null,
  paywalled: 'Paywalled',
  purchase: 'Buy',
  library: 'Library',
  unknown: 'Access unknown',
};

/**
 * Whether the search knew where you stand, in one line.
 *
 * Shown only for a reading queued from a gap. The unrooted case is the one
 * worth the space: early on the graph holds nothing settled, and a suggestion
 * that let you assume it was pitched at your level would be exactly the guess
 * this was built to replace.
 */
function Rooting({ note }: { note: RootingNote }) {
  if (!note.rooted) {
    return (
      <p className="mb-2 text-ui text-ink-muted">
        Nothing in {note.subject} is settled yet, so this is not rooted in what you know — it is a
        search on the claim alone. Probe the subject and it gets better.
      </p>
    );
  }

  return (
    <p className="mb-2 text-ui text-ink-muted">
      Searched against {note.subject}: the {note.settled}{' '}
      {note.settled === 1 ? 'claim' : 'claims'} you have settled there, and what you are ready for
      next. Nothing here only re-teaches them or assumes what you have not got to.
    </p>
  );
}

function SearchButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="secondary" disabled={pending}>
      <Search className="size-4" strokeWidth={2} aria-hidden />
      {pending ? 'Searching…' : 'Find something to read'}
    </Button>
  );
}

function AttachButton({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending || disabled}>
      {pending ? 'Attaching…' : 'Use this one'}
    </Button>
  );
}

function Candidate({
  source,
  index,
  checked,
  onChoose,
}: {
  source: ResolvedSource;
  index: number;
  checked: boolean;
  onChoose: () => void;
}) {
  const access = ACCESS_NOTE[source.access] ?? null;
  const price =
    source.price_cents !== null && source.price_cents !== undefined
      ? formatMoney(source.price_cents)
      : null;
  const id = `candidate-${index}`;

  return (
    <li className="flex gap-3 px-4 py-3">
      <input
        type="radio"
        id={id}
        name="chosen"
        value={JSON.stringify(source)}
        checked={checked}
        onChange={onChoose}
        className="mt-1 size-4 shrink-0 accent-accent"
      />
      <label htmlFor={id} className="min-w-0 flex-1 cursor-pointer">
        <span className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <span className="text-body font-medium text-ink">{source.title}</span>
          {source.author && <span className="text-ui text-ink-muted">{source.author}</span>}
          {access && (
            <span className="rounded-pill bg-sunken px-1.5 py-0.5 text-small text-ink-muted">
              {price ? `${access} · ${price}` : access}
            </span>
          )}
        </span>

        {source.why && <span className="mt-0.5 block text-ui text-ink">{source.why}</span>}

        {source.locator_label && (
          <span className="mt-0.5 block text-ui text-ink">{source.locator_label}</span>
        )}

        {/* The basis here, before anything is saved. This is the moment to
            reject a chapter number nobody checked. */}
        <span className="mt-0.5 block text-ui text-ink-muted">{source.locator_basis}</span>

        {source.canonical_url ? (
          <span className="mt-0.5 block truncate text-small text-ink-muted">
            {source.canonical_url}
          </span>
        ) : (
          <span className="mt-0.5 block text-small text-ink-muted">
            No free link — you would need a copy.
          </span>
        )}
      </label>
    </li>
  );
}

export function FindSources({ readingId }: { readingId: string }) {
  const [findState, find] = useActionState<FindState, FormData>(findSources, {});
  const [attachState, attach] = useActionState<ReadingActionState, FormData>(attachSource, {});
  const [chosen, setChosen] = useState<number | null>(null);

  if (findState.candidates && findState.candidates.length > 0) {
    return (
      <form action={attach}>
        <input type="hidden" name="readingId" value={readingId} />

        {findState.rooting && <Rooting note={findState.rooting} />}

        <p className="mb-2 text-body text-ink-muted">
          {findState.candidates.length === 1
            ? 'One thing worth reading. Nothing is saved until you pick it.'
            : `${findState.candidates.length} worth reading. Pick the one for this — nothing is saved until you do.`}
        </p>

        <ul className={cn(cardVariants(), 'divide-y divide-border overflow-hidden')}>
          {findState.candidates.map((source, index) => (
            <Candidate
              key={`${source.title}-${index}`}
              source={source}
              index={index}
              checked={chosen === index}
              onChoose={() => setChosen(index)}
            />
          ))}
        </ul>

        <div className="mt-4 flex items-center gap-3">
          <AttachButton disabled={chosen === null} />
          {attachState.error && <span className="text-ui text-danger">{attachState.error}</span>}
        </div>
      </form>
    );
  }

  return (
    <form action={find}>
      <input type="hidden" name="readingId" value={readingId} />
      {/* After a search that found nothing, the rooting still explains what it
          was looking with -- which is half of why it came back empty. */}
      {findState.rooting && <Rooting note={findState.rooting} />}
      <div className="flex flex-wrap items-center gap-3">
        <SearchButton />
        {findState.error && <span className="text-ui text-danger">{findState.error}</span>}
      </div>
      <p className="mt-2 text-small text-ink-muted">
        Searches for the few things worth reading on this. Takes a moment, and saves nothing until
        you choose.
      </p>
    </form>
  );
}
