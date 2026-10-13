'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import Link, { linkVariants } from '@/components/ui/link';
import { FilePlus2, Search } from 'lucide-react';
import { Deck, type DeckItem } from '@/components/patterns/deck';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { Card, cardVariants } from '@/components/ui/card';
import { SectionFold } from '@/components/ui/disclosure';
import { EmptyState } from '@/components/ui/empty-state';
import { FieldError, Input } from '@/components/ui/field';
import { LinkedText } from '@/components/ui/linked-text';
import { useToast } from '@/components/ui/toast';
import { cn } from '@/lib/cn';
import {
  fileQuickNoteAction,
  searchTriagePlaces,
  type FileQuickNoteState,
  type TriagePlace,
} from '@/app/vault/triage/actions';

export type { TriagePlace };

/**
 * Quick note triage (plan #1729, feature #1726): every quick note waiting in
 * the vault's Inbox, one at a time, as a deck. Each one offers the notes it
 * was suggested for, a search for any other, and a note of its own; the
 * deck's forward press leaves it for later and changes nothing. A filed note
 * leaves the deck at once, so the next one takes its place.
 *
 * The suggestions arrive without their scores (law 3): only the order says
 * which is nearest.
 */

export type TriageNote = {
  id: string;
  path: string;
  title: string;
  body: string;
  /** The blob SHA the note was read at, so an edit since is refused. */
  blobSha: string;
  /** When the app saw it written, already formatted, or null. */
  written: string | null;
  href: string;
  excerpt: string;
  suggestions: readonly TriagePlace[];
};

export type TriageActions = {
  file: (prev: FileQuickNoteState, formData: FormData) => Promise<FileQuickNoteState>;
  search: (query: string) => Promise<TriagePlace[]>;
};

const REAL_ACTIONS: TriageActions = { file: fileQuickNoteAction, search: searchTriagePlaces };

/** How long typing has to pause before the search is asked. */
const SEARCH_PAUSE_MS = 250;

export function QuickNoteTriage({
  notes,
  writable,
  actions = REAL_ACTIONS,
}: {
  notes: readonly TriageNote[];
  /** Whether the vault token can write; without it nothing can be filed. */
  writable: boolean;
  actions?: TriageActions;
}) {
  const toast = useToast();
  const [filed, setFiled] = useState<ReadonlySet<string>>(new Set());
  const [warnings, setWarnings] = useState<readonly string[]>([]);
  const [pass, setPass] = useState(0);
  const waiting = notes.filter((note) => !filed.has(note.id));

  const onFiled = (note: TriageNote, into: TriagePlace | null, state: FileQuickNoteState) => {
    setFiled((current) => new Set(current).add(note.id));
    const warning = state.warning;
    if (warning) setWarnings((current) => [...current, warning]);
    const title = state.filedTitle ?? into?.title ?? note.title;
    toast({ text: into ? `Added to ${title}` : `${title} is a note of its own now` });
  };

  const items: DeckItem[] = waiting.map((note) => ({
    key: note.id,
    body: (
      <QuickNoteCard
        note={note}
        writable={writable}
        actions={actions}
        onFiled={(into, state) => onFiled(note, into, state)}
      />
    ),
  }));

  return (
    <div className="space-y-5">
      {warnings.map((warning) => (
        <Banner key={warning} tone="warn">
          {warning}
        </Banner>
      ))}

      {waiting.length > 0 && (
        <SectionFold
          title="Waiting in your Inbox"
          count={waiting.length}
          remember="vault.triage.waiting"
          defaultOpen={false}
        >
          <ul className={cn(cardVariants(), 'divide-y divide-border overflow-hidden')}>
            {waiting.map((note) => (
              <li key={note.id}>
                <Link
                  href={note.href}
                  className="block px-4 py-3 transition-colors duration-quick hover:bg-canvas"
                >
                  <span className="block truncate text-body font-medium text-ink">
                    {note.title}
                  </span>
                  {note.excerpt && (
                    <span className="mt-0.5 block truncate text-ui text-ink-muted">
                      {note.excerpt}
                    </span>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        </SectionFold>
      )}

      <Deck
        key={pass}
        items={items}
        forward="Leave for later"
        done={
          waiting.length === 0 ? (
            <Card padding="standard">
              <EmptyState
                tone="finished"
                title="Quick note triage is empty"
                description="Every quick note has been sorted. New ones from the capture box wait here."
                action={{ label: 'Back to the vault', href: '/vault' }}
              />
            </Card>
          ) : (
            <Card padding="standard">
              <EmptyState
                tone="finished"
                title="That is every quick note"
                description={`${waiting.length} left for later ${waiting.length === 1 ? 'stays' : 'stay'} in your Inbox.`}
                secondaryAction={{ label: 'Back to the vault', href: '/vault' }}
              >
                <Button variant="secondary" size="sm" onClick={() => setPass((p) => p + 1)}>
                  Go through them again
                </Button>
              </EmptyState>
            </Card>
          )
        }
      />
    </div>
  );
}

/** One quick note and the places it can go. */
function QuickNoteCard({
  note,
  writable,
  actions,
  onFiled,
}: {
  note: TriageNote;
  writable: boolean;
  actions: TriageActions;
  onFiled: (into: TriagePlace | null, state: FileQuickNoteState) => void;
}) {
  const [pending, startTransition] = useTransition();
  const [pressed, setPressed] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  /** `target` null makes it a note of its own. */
  const file = (target: TriagePlace | null) => {
    const key = target?.path ?? '';
    setPressed(key);
    setError(null);
    const form = new FormData();
    form.set('quickPath', note.path);
    form.set('quickBlobSha', note.blobSha);
    if (target) form.set('targetPath', target.path);
    startTransition(async () => {
      const state = await actions.file({}, form);
      if (state.error) {
        setError(state.error);
        setPressed(null);
        return;
      }
      onFiled(target, state);
    });
  };

  const placeButton = (place: TriagePlace) => (
    <li key={place.path}>
      <Button
        variant="secondary"
        className="h-auto min-h-(--control-h) w-full justify-start py-2 text-left"
        pending={pending && pressed === place.path}
        disabled={pending && pressed !== place.path}
        onClick={() => file(place)}
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium">{place.title}</span>
          <span className="block truncate text-small text-ink-muted">
            {folderLabel(place.path)}
          </span>
        </span>
      </Button>
    </li>
  );

  return (
    <Card padding="standard" className="space-y-4">
      <div data-triage-text className="space-y-1.5">
        {note.written && <p className="text-small text-ink-muted">Written {note.written}</p>}
        <h2 className="font-display text-title tracking-tight text-ink [overflow-wrap:anywhere]">{note.title}</h2>
        <p className="whitespace-pre-wrap text-body text-ink [overflow-wrap:anywhere]">
          <LinkedText text={note.body} />
        </p>
      </div>

      {writable ? (
        <div className="space-y-3 border-t border-border pt-4">
          <h3 className="text-ui font-semibold text-ink-muted">Add it to</h3>
          {note.suggestions.length > 0 ? (
            <ul className="space-y-2">{note.suggestions.map(placeButton)}</ul>
          ) : (
            <p className="text-ui text-ink-muted">
              No note is close enough to suggest one. Search for it instead.
            </p>
          )}
          <PlaceSearch
            noteId={note.id}
            search={actions.search}
            exclude={note.suggestions}
            render={(places) =>
              places.length > 0 ? <ul className="space-y-2">{places.map(placeButton)}</ul> : null
            }
          />
          <Button
            variant="secondary"
            pending={pending && pressed === ''}
            disabled={pending && pressed !== ''}
            onClick={() => file(null)}
          >
            <FilePlus2 className="size-4" strokeWidth={1.75} aria-hidden />
            {pending && pressed === '' ? 'Making it a note…' : 'Make it a note of its own'}
          </Button>
          <FieldError>{error}</FieldError>
        </div>
      ) : (
        <div className="space-y-2 border-t border-border pt-4">
          <p className="text-ui text-ink-muted">
            Your vault token can read notes but not write them, so a quick note cannot be filed from
            here.{' '}
            <Link href="/vault/settings" className={linkVariants()}>
              Vault settings
            </Link>
          </p>
          {note.suggestions.length > 0 && (
            <p className="text-ui text-ink-muted">
              It may belong in{' '}
              {note.suggestions.map((place, i) => (
                <span key={place.path}>
                  {i > 0 && (i === note.suggestions.length - 1 ? ' or ' : ', ')}
                  <Link href={place.href} className={linkVariants()}>
                    {place.title}
                  </Link>
                </span>
              ))}
              .
            </p>
          )}
        </div>
      )}
    </Card>
  );
}

/** The folder a note sits in, as the list under a place reads it. */
function folderLabel(path: string): string {
  const cut = path.lastIndexOf('/');
  return cut === -1 ? 'Vault root' : path.slice(0, cut);
}

/** A search for any other note to add the quick note to. */
function PlaceSearch({
  noteId,
  search,
  exclude,
  render,
}: {
  noteId: string;
  search: TriageActions['search'];
  exclude: readonly TriagePlace[];
  render: (places: readonly TriagePlace[]) => React.ReactNode;
}) {
  const [query, setQuery] = useState('');
  const [found, setFound] = useState<{ query: string; places: readonly TriagePlace[] } | null>(
    null,
  );
  const asked = useRef(0);

  useEffect(() => {
    const q = query.trim();
    if (!q) return;
    const ask = ++asked.current;
    const timer = window.setTimeout(async () => {
      try {
        const places = await search(q);
        if (ask === asked.current) setFound({ query: q, places });
      } catch {
        if (ask === asked.current) setFound({ query: q, places: [] });
      }
    }, SEARCH_PAUSE_MS);
    return () => window.clearTimeout(timer);
  }, [query, search]);

  const q = query.trim();
  const skip = new Set(exclude.map((place) => place.path));
  const places =
    found && q && found.query === q ? found.places.filter((p) => !skip.has(p.path)) : null;

  return (
    <div className="space-y-2">
      <div className="relative">
        <Search
          className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-ink-muted"
          strokeWidth={1.75}
          aria-hidden
        />
        <Input
          type="search"
          id={`triage-search-${noteId}`}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search for another note"
          aria-label="Search for another note"
          // A text field takes no ::after press area, so on a phone it is drawn
          // at the 44px a finger needs, and at the control height from sm.
          className="h-11 pl-8 sm:h-(--control-h)" /* ui-ok: 44px press target on a phone */
        />
      </div>
      {places &&
        (places.length > 0 ? (
          render(places)
        ) : (
          <p className="text-ui text-ink-muted">No note matches “{q}”.</p>
        ))}
    </div>
  );
}
