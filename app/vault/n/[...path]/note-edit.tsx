'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useActionState, useRef, useState, useTransition } from 'react';
import { ArrowRight, Pencil } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ComposeBody, ComposeBox, FieldError } from '@/components/ui/field';
import { saveNoteEdit, type SaveNoteState } from './actions';

/**
 * Editing a note in place on its page (plan #1425).
 *
 * At rest this is the note as the page renders it, with an Edit button beside
 * the title. Edit swaps the rendered body for a markdown text box holding the
 * note's text, in the same place, with Save and Cancel under it; the title and
 * the properties stay as they are, because the save keeps the frontmatter it
 * opened with and only the body is edited.
 *
 * A save goes through `saveNoteEdit`, which commits to the vault repository
 * and revalidates this page, so the rendered note that comes back is the
 * saved one. The two failures with a way forward say so: a note changed in
 * Obsidian since the editor opened offers a reload, and a token that cannot
 * write (or no usable token) links to vault settings.
 */

/** Where the person goes to give the vault a token that can save. */
const SETTINGS_HREF = '/vault/settings';

export function NoteEdit({
  notePath,
  body,
  blobSha,
  heading,
  properties,
  children,
}: {
  notePath: string;
  /** The note's body as stored: the text the editor opens with. */
  body: string;
  /** The version of the note the page rendered; the save is refused if it has moved on. */
  blobSha: string;
  heading: React.ReactNode;
  properties: React.ReactNode;
  /** The rendered note, shown while not editing. */
  children: React.ReactNode;
}) {
  const [editing, setEditing] = useState(false);
  // The version a reload was asked for after a refused save. While the page
  // still shows that version, the app has not pulled Obsidian's one yet.
  const [staleAt, setStaleAt] = useState<string | null>(null);
  const [reloading, startReload] = useTransition();
  const router = useRouter();

  function reload() {
    setStaleAt(blobSha);
    setEditing(false);
    startReload(() => router.refresh());
  }

  return (
    <>
      <div className="mb-5 flex items-start justify-between gap-3">
        <div className="min-w-0">{heading}</div>
        {!editing && (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="shrink-0"
            onClick={() => setEditing(true)}
          >
            <Pencil className="size-3.5" strokeWidth={1.75} aria-hidden />
            Edit
          </Button>
        )}
      </div>

      {properties}

      {editing ? (
        <EditForm
          notePath={notePath}
          body={body}
          blobSha={blobSha}
          onDone={() => setEditing(false)}
          onReload={reload}
        />
      ) : (
        <>
          {staleAt === blobSha && !reloading && (
            <p className="mb-4 text-ui text-ink-muted">
              The app has not fetched the version from Obsidian yet. It arrives with the next
              sync, or you can sync now from{' '}
              <Link href={SETTINGS_HREF} className="font-medium text-accent hover:underline">
                vault settings
              </Link>
              .
            </p>
          )}
          {children}
        </>
      )}
    </>
  );
}

/**
 * The editor itself. Mounted only while editing, so a refused save's message
 * goes with it when the editor closes and is not there when it opens again.
 */
export function EditForm({
  notePath,
  body,
  blobSha,
  onDone,
  onReload,
}: {
  notePath: string;
  body: string;
  blobSha: string;
  onDone: () => void;
  onReload: () => void;
}) {
  // Held here rather than left to the textarea: React resets a form's fields
  // after its action runs, and a refused save must not empty the box.
  const [draft, setDraft] = useState(body);
  const form = useRef<HTMLFormElement>(null);

  const [state, save, pending] = useActionState<SaveNoteState, FormData>(
    async (prev, formData) => {
      const result = await saveNoteEdit(prev, formData);
      if (result.savedBlobSha) onDone();
      return result;
    },
    {},
  );

  const dirty = draft !== body;

  return (
    <form ref={form} action={save}>
      <input type="hidden" name="notePath" value={notePath} />
      <input type="hidden" name="blobSha" value={blobSha} />
      <ComposeBox>
        <ComposeBody
          name="text"
          autoFocus
          aria-label="Note text, in markdown"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              form.current?.requestSubmit();
            } else if (event.key === 'Escape' && !dirty) {
              // Only an untouched box closes on Escape: a stray key must not
              // throw away a paragraph.
              event.preventDefault();
              onDone();
            }
          }}
          spellCheck
          // The box lights up around it, which already says where the typing goes.
          data-focus-ring="none"
          // Short enough that Save is on screen when the editor opens, at both widths.
          className="max-h-[60dvh] min-h-48 font-mono"
        />
      </ComposeBox>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button type="submit" size="sm" pending={pending}>
          {pending ? 'Saving…' : 'Save'}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onDone} pending={pending}>
          Cancel
        </Button>
      </div>

      <SaveError state={state} onReload={onReload} />
    </form>
  );
}

export function SaveError({ state, onReload }: { state: SaveNoteState; onReload: () => void }) {
  if (!state.reason || state.savedBlobSha) return null;

  if (state.reason === 'changed') {
    return (
      <div role="alert" className="mt-3 space-y-2">
        <p className="text-ui text-danger">
          This note changed in Obsidian since you opened it, so your edit was not saved.
          Reloading shows that version and drops what you typed here, so copy anything you want
          to keep first.
        </p>
        <Button type="button" size="sm" variant="secondary" onClick={onReload}>
          Reload the note
        </Button>
      </div>
    );
  }

  if (state.reason === 'read-only' || state.reason === 'reconnect') {
    return (
      <div role="alert" className="mt-3 space-y-1">
        <p className="text-ui text-danger">
          {state.reason === 'read-only'
            ? 'The vault token can read notes but not save them, so your edit was not saved. Add a token that can write in vault settings.'
            : 'The vault needs reconnecting before notes can be saved, so your edit was not saved.'}
        </p>
        <Link
          href={SETTINGS_HREF}
          className="inline-flex items-center gap-1 text-ui font-medium text-accent hover:underline"
        >
          Open vault settings
          <ArrowRight className="size-3.5" strokeWidth={2} aria-hidden />
        </Link>
      </div>
    );
  }

  return <FieldError>{state.error}</FieldError>;
}
