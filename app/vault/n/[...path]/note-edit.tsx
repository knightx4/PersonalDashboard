'use client';

import Link, { linkVariants } from '@/components/ui/link';
import { useRouter } from 'next/navigation';
import {
  useActionState,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  useTransition,
  type Ref,
} from 'react';
import { ArrowRight, Pencil } from 'lucide-react';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { cardVariants } from '@/components/ui/card';
import { FieldError, InlineInput } from '@/components/ui/field';
import { NoteEditor } from '@/components/vault/note-editor';
import { cn } from '@/lib/cn';
import { buildLinkIndex, parseWikiLink, resolveWikiLink } from '@/lib/vault/markdown/obsidian';
import type { DraftFailure } from '@/lib/vault/notes/drafts';
import { basenameOf, noteHref } from '@/lib/vault/paths';
import {
  dropNoteDraft,
  renameNoteAction,
  saveNoteDraft,
  sendNoteDraft,
  type DraftSaveState,
  type RenameNoteState,
  type SaveNoteState,
} from './actions';

/**
 * Editing a note in place on its page (plan #1425).
 *
 * At rest this is the note as the page renders it, with an Edit button beside
 * the title. Edit, or a click into the note itself (note 469f3771), swaps the
 * rendered body for a live-preview editor on the same card, in the same type,
 * with the caret where the click landed (note of 20 October 2026). The note
 * saves itself as you write, and Done (or Escape) goes back to the rendered
 * note. The title and the properties stay as they are, because the save keeps
 * the frontmatter it opened with and only the body is edited.
 *
 * A save keeps the text as the note's draft, which the page shows from then
 * on; the vault gets it as one commit ten minutes after the last change. When
 * that commit is refused, the note at rest says why and what can be done: a
 * note changed in Obsidian meanwhile offers to keep either version, and a
 * token that cannot write links to vault settings and offers to try again.
 */

/** Where the person goes to give the vault a token that can save. */
const SETTINGS_HREF = '/vault/settings';

export function NoteEdit({
  notePath,
  body,
  blobSha,
  linkPaths = [],
  draft = null,
  heading,
  properties,
  children,
}: {
  notePath: string;
  /** The note's draft waiting for its commit, if it has one. */
  draft?: { failure: DraftFailure | null } | null;
  /** Every note's path in the vault, which wikilinks in the editor resolve against. */
  linkPaths?: string[];
  /** The text the editor opens with: the note's draft if it has one, else its body. */
  body: string;
  /** The version of the note the page rendered; the save is refused if it has moved on. */
  blobSha: string;
  heading: React.ReactNode;
  properties: React.ReactNode;
  /** The rendered note, shown while not editing. */
  children: React.ReactNode;
}) {
  const [editing, setEditing] = useState(false);
  const [caretAt, setCaretAt] = useState<{ x: number; y: number } | null>(null);
  const [status, setStatus] = useState<SaveStatus>('idle');
  const editor = useRef<EditFormHandle>(null);
  const [renaming, setRenaming] = useState(false);
  // The version a reload was asked for after a refused save. While the page
  // still shows that version, the app has not pulled Obsidian's one yet.
  const [staleAt, setStaleAt] = useState<string | null>(null);
  const [reloading, startReload] = useTransition();
  const router = useRouter();

  function reload() {
    setStaleAt(blobSha);
    stopEditing();
    startReload(() => router.refresh());
  }

  function startEditing(at: { x: number; y: number } | null) {
    setCaretAt(at);
    setStatus('idle');
    setEditing(true);
  }

  // Each save revalidates the page, so the rendered note is already the saved one.
  function stopEditing() {
    setEditing(false);
  }

  return (
    <>
      <div className="mb-5 flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          {renaming ? (
            <RenameForm notePath={notePath} blobSha={blobSha} onDone={() => setRenaming(false)} />
          ) : (
            heading
          )}
        </div>
        {!editing && !renaming && (
          <div className="flex shrink-0 items-center gap-2">
            {/* The file's name is the note's name in Obsidian, so this moves the file (note 69c302f1). */}
            <Button type="button" variant="ghost" size="sm" onClick={() => setRenaming(true)}>
              Rename
            </Button>
            <Button type="button" variant="secondary" size="sm" onClick={() => startEditing(null)}>
              <Pencil className="size-3.5" strokeWidth={1.75} aria-hidden />
              Edit
            </Button>
          </div>
        )}
        {editing && (
          <div className="flex shrink-0 items-center gap-3">
            <SaveStatusText status={status} />
            <Button type="button" variant="secondary" size="sm" onClick={() => editor.current?.close()}>
              Done
            </Button>
          </div>
        )}
      </div>

      {properties}

      {editing ? (
        <EditForm
          notePath={notePath}
          body={body}
          linkPaths={linkPaths}
          caretAt={caretAt}
          handle={editor}
          onStatus={setStatus}
          onDone={stopEditing}
          onReload={reload}
        />
      ) : (
        <>
          {draft && <DraftNotice notePath={notePath} failure={draft.failure} />}
          {staleAt === blobSha && !reloading && (
            <p className="mb-4 text-ui text-ink-muted">
              The app has not fetched the version from Obsidian yet. It arrives with the next
              sync, or you can sync now from{' '}
              <Link href={SETTINGS_HREF} className={linkVariants()}>
                vault settings
              </Link>
              .
            </p>
          )}
          {/* A click into the note edits it, as the essay editor does, but a
              click on a link or a control inside it still does what that
              does, and so does selecting text to copy. Keyboard and screen
              reader users have the Edit button above. */}
          <div
            className="cursor-text"
            onClick={(event) => {
              const target = event.target as HTMLElement;
              if (target.closest('a, button, input, select, textarea, summary, label, video, audio')) return;
              if (window.getSelection()?.toString()) return;
              startEditing({ x: event.clientX, y: event.clientY });
            }}
          >
            {children}
          </div>
        </>
      )}
    </>
  );
}

/**
 * Renaming the note in place of its title (note 69c302f1). The box holds the
 * file's name without `.md`; Save moves the file in the vault and opens the
 * note at its new address, Escape or Cancel leaves it as it was.
 */
export function RenameForm({
  notePath,
  blobSha,
  onDone,
}: {
  notePath: string;
  blobSha: string;
  onDone: () => void;
}) {
  const router = useRouter();
  const [name, setName] = useState(() => basenameOf(notePath));
  const [state, rename, pending] = useActionState<RenameNoteState, FormData>(async (prev, formData) => {
    const result = await renameNoteAction(prev, formData);
    if (result.renamedPath) router.replace(noteHref(result.renamedPath));
    return result;
  }, {});

  return (
    <form action={rename} className="space-y-2">
      <input type="hidden" name="notePath" value={notePath} />
      <input type="hidden" name="blobSha" value={blobSha} />
      <InlineInput
        name="name"
        value={name}
        onChange={(event) => setName(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            onDone();
          }
        }}
        aria-label="Note name"
        autoFocus
        onFocus={(event) => event.currentTarget.select()}
        // The title's own size and weight, in the title's place (law 12).
        className="-mx-1 min-h-11 font-display text-title font-semibold tracking-tight sm:text-title"
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" size="sm" pending={pending} disabled={!name.trim()}>
          {pending ? 'Renaming…' : 'Rename'}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onDone} disabled={pending}>
          Cancel
        </Button>
      </div>
      {!state.renamedPath && <FieldError>{state.error}</FieldError>}
    </form>
  );
}

/** How long typing has to pause before the draft is saved. A save makes no commit. */
const AUTOSAVE_MS = 1500;

export type SaveStatus = 'idle' | 'unsaved' | 'saving' | 'saved' | 'failed';

/** What the header's Done button asks of the editor. */
export type EditFormHandle = { close: () => void };

/**
 * The editor itself, saving as you go (note of 20 October 2026): a pause in
 * typing, leaving the editor, Cmd-S, Done, Escape and following a link each
 * keep what has changed as the note's draft, and leaving the page does too.
 * A draft is not a commit: the vault gets one commit for the sitting, ten
 * minutes after the last change (lib/vault/notes/drafts.ts).
 *
 * Saves run one at a time, each saying what text it last saved, so the save
 * is refused when the note changed somewhere else meanwhile. That refusal, and
 * a note that is gone, stop the saving and say so; any other failure is tried
 * again with the next edit. Mounted only while editing, so the message goes
 * with the editor when it closes.
 */
export function EditForm({
  notePath,
  body,
  linkPaths = [],
  caretAt = null,
  handle,
  onStatus,
  onDone,
  onReload,
}: {
  notePath: string;
  /** The text the editor opens with: the note's draft if it has one, else its body. */
  body: string;
  /** Every note's path in the vault, which the editor's wikilinks resolve against. */
  linkPaths?: string[];
  /** Where the click that opened the editor landed. */
  caretAt?: { x: number; y: number } | null;
  handle?: Ref<EditFormHandle>;
  onStatus?: (status: SaveStatus) => void;
  onDone: () => void;
  onReload: () => void;
}) {
  const router = useRouter();
  const index = useMemo(() => buildLinkIndex(linkPaths.map((path) => ({ path, title: '' }))), [linkPaths]);
  const [state, setState] = useState<SaveNoteState>({});
  const saved = useRef(body);
  const latest = useRef(body);
  const running = useRef<Promise<void> | null>(null);
  const blocked = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const status = useRef<(next: SaveStatus) => void>(() => {});
  useEffect(() => {
    status.current = (next) => onStatus?.(next);
  });

  async function flush(): Promise<void> {
    clearTimeout(timer.current);
    while (running.current) await running.current;
    if (blocked.current || latest.current === saved.current) return;
    const text = latest.current;
    const run = (async () => {
      status.current('saving');
      let result: DraftSaveState;
      try {
        result = await saveNoteDraft({ notePath, text, from: saved.current });
      } catch {
        result = { ok: false, reason: 'error', error: 'The note could not be saved. Check your connection.' };
      }
      if (result.ok) {
        saved.current = text;
        setState({});
      } else {
        if (result.reason !== 'error') blocked.current = true;
        setState({ reason: result.reason, error: result.error });
      }
      status.current(!result.ok ? 'failed' : latest.current === saved.current ? 'saved' : 'unsaved');
    })();
    running.current = run;
    try {
      await run;
    } finally {
      running.current = null;
    }
  }

  async function close() {
    await flush();
    // A refusal that stops saving lets the editor close: its message said the edit was not saved.
    if (latest.current !== saved.current && !blocked.current) return;
    onDone();
    // The rendered note is drawn from the page, which has not seen the draft yet.
    router.refresh();
  }

  useImperativeHandle(handle, () => ({ close: () => void close() }));

  // Leaving the page with an edit not yet kept: the browser asks first, and a
  // move within the app keeps it on the way out.
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (latest.current !== saved.current && !blocked.current) event.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => {
      window.removeEventListener('beforeunload', warn);
      clearTimeout(timer.current);
      if (latest.current !== saved.current && !blocked.current && !running.current)
        void saveNoteDraft({ notePath, text: latest.current, from: saved.current });
    };
    // Mount and unmount only; the refs hold what changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div>
      <div className={cn(cardVariants({ padding: 'standard' }), 'cursor-text')}>
        <NoteEditor
          initialDoc={body}
          label="Note text, in markdown"
          autoFocus
          caretAt={caretAt}
          linkExists={(target) => resolveWikiLink(parseWikiLink(target, false), index) !== null}
          onOpenLink={(target) => {
            const path = resolveWikiLink(parseWikiLink(target, false), index);
            if (!path) return;
            void flush().then(() => router.push(noteHref(path)));
          }}
          onChange={(doc) => {
            latest.current = doc;
            if (blocked.current) return;
            status.current('unsaved');
            clearTimeout(timer.current);
            timer.current = setTimeout(() => void flush(), AUTOSAVE_MS);
          }}
          onBlur={() => void flush()}
          onSaveNow={() => void flush()}
          onClose={() => void close()}
        />
      </div>
      <SaveError state={state} onReload={onReload} />
    </div>
  );
}

/**
 * A draft waiting at rest: when it goes to Obsidian, or why it did not and
 * what can be done about it.
 */
export function DraftNotice({ notePath, failure }: { notePath: string; failure: DraftFailure | null }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function send(overwrite: boolean) {
    startTransition(async () => {
      const result = await sendNoteDraft({ notePath, overwrite });
      setError(result.reason ? (result.error ?? null) : null);
    });
  }

  function drop() {
    startTransition(async () => {
      const result = await dropNoteDraft({ notePath });
      setError(result.error ?? null);
    });
  }

  if (!failure) {
    return (
      <p className="mb-4 text-ui text-ink-muted">
        Your edits go to Obsidian ten minutes after the last change.{' '}
        <button type="button" className={linkVariants()} onClick={() => send(false)} disabled={pending}>
          {pending ? 'Sending…' : 'Send now'}
        </button>
        {error && <FieldError>{error}</FieldError>}
      </p>
    );
  }

  return (
    <Banner tone="bad" role="alert" className="mb-4">
      <div className="space-y-2">
        <p className="text-ui">
          {failure === 'changed'
            ? 'This note changed in Obsidian after you edited it here, so your edits have not gone to Obsidian. The note below is your version.'
            : failure === 'read-only'
              ? 'The vault token can read notes but not save them, so your edits have not gone to Obsidian. Add a token that can write, then try again.'
              : failure === 'reconnect'
                ? 'The vault needs reconnecting, so your edits have not gone to Obsidian. Reconnect it, then try again.'
                : failure === 'too-large'
                  ? 'The note is too large to save from here, so your edits have not gone to Obsidian.'
                  : 'This note is not in the vault any more, so your edits have nowhere to go.'}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          {failure === 'changed' ? (
            <>
              <Button type="button" size="sm" variant="secondary" onClick={() => send(true)} pending={pending}>
                Keep my version
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={drop} pending={pending}>
                Use the Obsidian version
              </Button>
            </>
          ) : failure === 'read-only' || failure === 'reconnect' ? (
            <>
              <Button type="button" size="sm" variant="secondary" onClick={() => send(false)} pending={pending}>
                Try again
              </Button>
              <Link href={SETTINGS_HREF} className={`inline-flex items-center gap-1 text-ui ${linkVariants()}`}>
                Open vault settings
                <ArrowRight className="size-3.5" strokeWidth={1.75} aria-hidden />
              </Link>
            </>
          ) : (
            <Button type="button" size="sm" variant="ghost" onClick={drop} pending={pending}>
              Throw away my edits
            </Button>
          )}
        </div>
        {error && <FieldError>{error}</FieldError>}
      </div>
    </Banner>
  );
}

/** The editor's saving, said quietly where the Edit button was. */
export function SaveStatusText({ status }: { status: SaveStatus }) {
  const text = { idle: '', unsaved: 'Edited', saving: 'Saving…', saved: 'Saved', failed: 'Not saved' }[
    status
  ];
  return (
    <span role="status" className="text-ui text-ink-muted">
      {text}
    </span>
  );
}

export function SaveError({ state, onReload }: { state: SaveNoteState; onReload: () => void }) {
  if (!state.reason || state.savedBlobSha) return null;

  if (state.reason === 'changed') {
    return (
      <Banner tone="bad" role="alert" className="mt-3">
        <div className="space-y-2">
        <p className="text-ui">
          This note changed in Obsidian since you opened it, so your edit was not saved.
          Reloading shows that version and drops what you typed here, so copy anything you want
          to keep first.
        </p>
        <Button type="button" size="sm" variant="secondary" onClick={onReload}>
          Reload the note
        </Button>
        </div>
      </Banner>
    );
  }

  if (state.reason === 'read-only' || state.reason === 'reconnect') {
    return (
      <Banner tone="bad" role="alert" className="mt-3">
        <div className="space-y-1">
        <p className="text-ui">
          {state.reason === 'read-only'
            ? 'The vault token can read notes but not save them, so your edit was not saved. Add a token that can write in vault settings.'
            : 'The vault needs reconnecting before notes can be saved, so your edit was not saved.'}
        </p>
        <Link
          href={SETTINGS_HREF}
          className={`inline-flex items-center gap-1 text-ui ${linkVariants()}`}
        >
          Open vault settings
          <ArrowRight className="size-3.5" strokeWidth={1.75} aria-hidden />
        </Link>
        </div>
      </Banner>
    );
  }

  return <FieldError>{state.error}</FieldError>;
}
