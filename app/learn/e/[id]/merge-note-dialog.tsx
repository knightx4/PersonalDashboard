'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { FieldError, Input, Label } from '@/components/ui/field';
import { LinkedText } from '@/components/ui/linked-text';
import { Segmented } from '@/components/ui/segmented';
import { useToast } from '@/components/ui/toast';
import { cn } from '@/lib/cn';
import { deviceTimeZone, zoneDay } from '@/lib/core/when';
import { previewParts } from '@/lib/learn/essays/merge-preview';
import type { EssayPlan } from '@/lib/learn/essays/plan';
import { vaultNoteHref, type VaultNoteMatch } from '@/lib/learn/essays/vault-notes';
import { searchEssayVaultNotes } from './attached-actions';
import { addVaultNoteToNotes, previewVaultNoteInNotes } from './bring-note-actions';
import { addEssayNotesToVaultNote, previewEssayNotesInVaultNote } from './notes-to-vault-actions';

/** How long after the last keystroke the vault is searched. */
const SEARCH_MS = 250;

export type MergeDirection = 'into-notes' | 'into-vault';

export type MergeSearch =
  | { kind: 'idle' }
  | { kind: 'searching' }
  | { kind: 'found'; notes: readonly VaultNoteMatch[] }
  | { kind: 'failed'; error: string };

export type MergePreview =
  | { kind: 'loading' }
  | {
      kind: 'ready';
      before: string;
      after: string;
      /** Adding would change nothing: the text is already the last thing there. */
      unchanged: boolean;
      /** The vault note's version, which the add into the vault must name. */
      blobSha: string | null;
    }
  | { kind: 'failed'; error: string };

/** Everything the dialog shows; the gallery passes one to draw a state. */
export type MergeDialogState = {
  query: string;
  search: MergeSearch;
  picked: VaultNoteMatch | null;
  direction: MergeDirection;
  preview: MergePreview | null;
  saving: boolean;
  error: string | null;
};

const CLOSED: MergeDialogState = {
  query: '',
  search: { kind: 'idle' },
  picked: null,
  direction: 'into-notes',
  preview: null,
  saving: false,
  error: null,
};

const DIRECTIONS: ReadonlyArray<{ value: MergeDirection; label: string }> = [
  { value: 'into-notes', label: 'Into my notes' },
  { value: 'into-vault', label: 'Into the vault note' },
];

/** A note's name: its title, or its path when it has none. */
function noteName(note: VaultNoteMatch): string {
  return note.title.trim() || note.path;
}

/** The folder under a titled note's name; none for an untitled one, whose name is already its path. */
function noteFolder(note: VaultNoteMatch): string {
  if (!note.title.trim()) return '';
  return note.path.split('/').slice(0, -1).join('/');
}

/**
 * Merge with a vault note, on the essay's Prepare tab (plan #2357.5): search
 * the vault by title, pick a note, choose which way the text goes, see what
 * will be added and where, and confirm. Into my notes adds the note's text to
 * the end of the essay's notes, saves them and moves to the Notes tab; into
 * the vault note adds the notes to the end of that note as one commit, and a
 * toast links to it. Nothing is saved until the confirm.
 *
 * Both merges read the essay's saved notes, so `saveNotes` saves whatever the
 * notes editor holds first. `onAddedToNotes` gets the plan the merge left,
 * whose `notes` the editor must take, or its next save would undo the merge.
 * `shown` opens the dialog on a fixed state and calls nothing, for the gallery.
 */
export function MergeVaultNote({
  essayId,
  saveNotes,
  onAddedToNotes,
  shown,
}: {
  essayId: string;
  saveNotes: () => Promise<boolean>;
  onAddedToNotes: (plan: EssayPlan) => void;
  shown?: MergeDialogState;
}) {
  const frozen = shown !== undefined;
  const [open, setOpen] = useState(frozen);
  const [state, setState] = useState<MergeDialogState>(shown ?? CLOSED);
  const toast = useToast();
  const searchTicket = useRef(0);
  const previewTicket = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const patch = useCallback(
    (next: Partial<MergeDialogState>) => setState((now) => ({ ...now, ...next })),
    [],
  );

  const close = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    searchTicket.current += 1;
    previewTicket.current += 1;
    setOpen(false);
    setState(CLOSED);
    triggerRef.current?.focus();
  }, []);

  const search = (query: string) => {
    patch({ query });
    if (frozen) return;
    if (timer.current) clearTimeout(timer.current);
    const ticket = ++searchTicket.current;
    if (!query.trim()) {
      patch({ search: { kind: 'idle' } });
      return;
    }
    patch({ search: { kind: 'searching' } });
    timer.current = setTimeout(async () => {
      const result = await searchEssayVaultNotes(essayId, query).catch(() => undefined);
      if (ticket !== searchTicket.current) return;
      patch({
        search: !result
          ? { kind: 'failed', error: 'The connection dropped. Try again in a moment.' }
          : result.ok
            ? { kind: 'found', notes: result.notes }
            : { kind: 'failed', error: result.error },
      });
    }, SEARCH_MS);
  };

  /** Ask for the preview of `note` going `direction`, after saving any notes still being typed. */
  const loadPreview = async (
    note: VaultNoteMatch,
    direction: MergeDirection,
    error: string | null = null,
  ) => {
    const ticket = ++previewTicket.current;
    patch({ preview: { kind: 'loading' }, error });
    if (frozen) return;
    const saved = await saveNotes();
    if (ticket !== previewTicket.current) return;
    if (!saved) {
      patch({
        preview: {
          kind: 'failed',
          error: 'Dash could not save your notes first. Try again in a moment.',
        },
      });
      return;
    }
    let preview: MergePreview;
    if (direction === 'into-notes') {
      const r = await previewVaultNoteInNotes(essayId, note.id, today()).catch(() => undefined);
      preview = !r
        ? { kind: 'failed', error: 'The connection dropped. Try again in a moment.' }
        : r.ok
          ? {
              kind: 'ready',
              before: r.before,
              after: r.after,
              unchanged: !r.changed,
              blobSha: null,
            }
          : { kind: 'failed', error: r.error };
    } else {
      const r = await previewEssayNotesInVaultNote(essayId, note.id, deviceTimeZone()).catch(
        () => undefined,
      );
      preview = !r
        ? { kind: 'failed', error: 'The connection dropped. Try again in a moment.' }
        : r.ok
          ? {
              kind: 'ready',
              before: r.before,
              after: r.after,
              unchanged: r.unchanged,
              blobSha: r.blobSha,
            }
          : { kind: 'failed', error: r.error };
    }
    if (ticket !== previewTicket.current) return;
    patch({ preview });
  };

  const pick = (note: VaultNoteMatch) => {
    patch({ picked: note });
    void loadPreview(note, state.direction);
  };

  const turn = (direction: MergeDirection) => {
    if (direction === state.direction) return;
    patch({ direction });
    if (state.picked) void loadPreview(state.picked, direction);
  };

  const unpick = () => {
    previewTicket.current += 1;
    patch({ picked: null, preview: null, error: null });
  };

  const confirm = async () => {
    const note = state.picked;
    const preview = state.preview;
    if (frozen || !note || preview?.kind !== 'ready' || preview.unchanged || state.saving) return;
    patch({ saving: true, error: null });
    const name = noteName(note);
    if (state.direction === 'into-notes') {
      const r = await addVaultNoteToNotes(essayId, note.id, today()).catch(() => undefined);
      if (!r || !r.ok) {
        patch({ saving: false, error: r ? r.error : 'The connection dropped. Nothing was added.' });
        return;
      }
      close();
      if (r.changed) {
        onAddedToNotes(r.plan);
        toast({ text: `Added ${name} to your notes` });
      } else {
        toast({ text: `${name} is already at the end of your notes` });
      }
      return;
    }
    const r = await addEssayNotesToVaultNote(
      essayId,
      note.id,
      preview.blobSha ?? '',
      deviceTimeZone(),
    ).catch(() => undefined);
    if (!r || !r.ok) {
      patch({ saving: false });
      const error = r ? r.error : 'The connection dropped. Nothing was added.';
      if (r?.reason === 'changed') void loadPreview(note, 'into-vault', error);
      else patch({ error });
      return;
    }
    close();
    toast({
      text: `Added your notes to ${name}`,
      link: { label: 'Open note', href: vaultNoteHref(r.path) },
    });
  };

  return (
    <>
      <Button
        ref={triggerRef}
        type="button"
        variant="secondary"
        size="sm"
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
      >
        Merge with a vault note
      </Button>
      {open && (
        <MergeDialog
          state={state}
          onClose={close}
          onSearch={search}
          onPick={pick}
          onUnpick={unpick}
          onTurn={turn}
          onConfirm={() => void confirm()}
        />
      )}
    </>
  );
}

function today(): string {
  return zoneDay(new Date(), deviceTimeZone() ?? 'UTC');
}

/**
 * The dialog itself. A native modal dialog, so the page behind is inert and
 * focus stays inside; Escape and a press on the backdrop close it, except
 * while a merge is saving.
 */
function MergeDialog({
  state,
  onClose,
  onSearch,
  onPick,
  onUnpick,
  onTurn,
  onConfirm,
}: {
  state: MergeDialogState;
  onClose: () => void;
  onSearch: (query: string) => void;
  onPick: (note: VaultNoteMatch) => void;
  onUnpick: () => void;
  onTurn: (direction: MergeDirection) => void;
  onConfirm: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const titleId = useId();
  const searchId = useId();
  const { picked, preview, saving } = state;

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);
  useEffect(() => {
    if (!picked) searchRef.current?.focus();
  }, [picked]);

  const ready = preview?.kind === 'ready' && !preview.unchanged;
  const intoNotes = state.direction === 'into-notes';

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        if (!saving) onClose();
      }}
      onClick={(event) => {
        if (event.target === ref.current && !saving) onClose();
      }}
      /* ui-ok: the popup's own edge, a floating panel that has nothing behind it to separate it from */
      className="m-auto max-h-[calc(100dvh-2rem)] w-[min(34rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-card border border-border bg-surface text-ink shadow-lg backdrop:bg-black/40 open:flex"
    >
      {/* The body scrolls; the error and the buttons stay at the foot, in view on a phone. */}
      <div className="min-h-0 overflow-y-auto px-5 pt-5">
        <h2 id={titleId} className="font-display text-title font-semibold tracking-tight text-ink">
          Merge with a vault note
        </h2>

        {!picked ? (
          <div className="mt-3">
            <Label htmlFor={searchId}>Find a note by its title</Label>
            <Input
              ref={searchRef}
              id={searchId}
              type="search"
              autoComplete="off"
              value={state.query}
              onChange={(event) => onSearch(event.target.value)}
              onKeyDown={(event) => {
                if (
                  event.key === 'Enter' &&
                  state.search.kind === 'found' &&
                  state.search.notes[0]
                ) {
                  event.preventDefault();
                  onPick(state.search.notes[0]);
                }
              }}
              className="w-full max-sm:min-h-11"
            />
            <SearchResults search={state.search} query={state.query} onPick={onPick} />
          </div>
        ) : (
          <div className="mt-3 flex flex-col gap-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-ui font-medium text-ink [overflow-wrap:anywhere]">
                  {noteName(picked)}
                </p>
                {noteFolder(picked) && (
                  <p className="text-small text-ink-muted [overflow-wrap:anywhere]">
                    {noteFolder(picked)}
                  </p>
                )}
              </div>
              <Button type="button" variant="ghost" size="sm" disabled={saving} onClick={onUnpick}>
                Change
              </Button>
            </div>
            <Segmented
              label="Which way the text goes"
              value={state.direction}
              options={DIRECTIONS}
              onChange={onTurn}
              disabled={saving}
              className="self-start"
            />
            <PreviewBox preview={preview} intoNotes={intoNotes} name={noteName(picked)} />
          </div>
        )}
      </div>

      <div className="shrink-0 px-5 pt-3 pb-5">
        {state.error && (
          <div className="mb-3">
            <FieldError>{state.error}</FieldError>
          </div>
        )}
        <div className="flex flex-wrap justify-end gap-2">
          <Button type="button" variant="secondary" disabled={saving} onClick={onClose}>
            Cancel
          </Button>
          {picked && (
            <Button type="button" pending={saving} disabled={!ready} onClick={onConfirm}>
              {saving ? 'Adding…' : intoNotes ? 'Add to my notes' : 'Add to the vault note'}
            </Button>
          )}
        </div>
      </div>
    </dialog>
  );
}

function SearchResults({
  search,
  query,
  onPick,
}: {
  search: MergeSearch;
  query: string;
  onPick: (note: VaultNoteMatch) => void;
}) {
  if (search.kind === 'idle') {
    return <p className="mt-2 text-small text-ink-muted">Type part of a note’s title.</p>;
  }
  if (search.kind === 'searching') {
    return (
      <p role="status" aria-busy className="mt-2 text-small text-ink-muted">
        Searching your vault…
      </p>
    );
  }
  if (search.kind === 'failed') {
    return (
      <div className="mt-2">
        <FieldError>{search.error}</FieldError>
      </div>
    );
  }
  if (search.notes.length === 0) {
    return (
      <div role="status" className="mt-3 rounded-card bg-sunken px-3 py-3">
        <p className="text-ui text-ink">No notes match “{query.trim()}”</p>
        <p className="mt-0.5 text-small text-ink-muted">
          The search looks at note titles. Try a shorter part of one.
        </p>
      </div>
    );
  }
  return (
    <ul className="-mx-2 mt-2 flex flex-col">
      {search.notes.map((note) => (
        <li key={note.id}>
          <button
            type="button"
            onClick={() => onPick(note)}
            className="press flex min-h-11 w-full flex-col items-start justify-center rounded-control px-2 py-1.5 text-left hover:bg-sunken lg:min-h-9"
          >
            <span className="text-ui text-ink [overflow-wrap:anywhere]">{noteName(note)}</span>
            {noteFolder(note) && (
              <span className="text-small text-ink-muted [overflow-wrap:anywhere]">
                {noteFolder(note)}
              </span>
            )}
          </button>
        </li>
      ))}
    </ul>
  );
}

function PreviewBox({
  preview,
  intoNotes,
  name,
}: {
  preview: MergePreview | null;
  intoNotes: boolean;
  name: string;
}) {
  const heading = intoNotes ? 'Added to the end of your notes' : `Added to the end of ${name}`;
  return (
    <section aria-label="What will be added" aria-busy={preview?.kind === 'loading' || undefined}>
      <p className="text-small font-medium text-ink-muted [overflow-wrap:anywhere]">{heading}</p>
      <div className="mt-1.5 rounded-card bg-sunken px-3 py-2.5 text-ui">
        {!preview || preview.kind === 'loading' ? (
          <p className="text-ink-muted">
            {intoNotes ? 'Reading the note…' : 'Reading your notes and the note…'}
          </p>
        ) : preview.kind === 'failed' ? (
          <FieldError>{preview.error}</FieldError>
        ) : preview.unchanged ? (
          <p className="text-ink-muted">
            {intoNotes
              ? 'This note is already at the end of your notes, so there is nothing to add.'
              : 'Your notes are already at the end of this note, so there is nothing to add.'}
          </p>
        ) : (
          <PreviewText {...previewParts(preview.before, preview.after)} />
        )}
      </div>
    </section>
  );
}

function PreviewText({ context, added }: { context: string; added: string }) {
  return (
    <div className="flex flex-col gap-2 whitespace-pre-wrap [overflow-wrap:anywhere]">
      {context && (
        <p className="text-ink-muted">
          <LinkedText text={context} refs={false} />
        </p>
      )}
      <p className={cn('text-ink', context && 'border-l-2 border-accent pl-3')}>
        <LinkedText text={added} refs={false} />
      </p>
    </div>
  );
}
