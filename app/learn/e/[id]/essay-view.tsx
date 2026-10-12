'use client';

import { useActionState, useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, ChevronLeft } from 'lucide-react';
import { MainRail } from '@/components/patterns/main-rail';
import { MarkdownEditor } from '@/components/learn/markdown-editor';
import { Button } from '@/components/ui/button';
import { Card, CardSection } from '@/components/ui/card';
import { InlineInput } from '@/components/ui/field';
import { Meter } from '@/components/ui/meter';
import { cn } from '@/lib/cn';
import { countWords, essayTitle, wordCountLabel, type Essay } from '@/lib/learn/essays/model';
import { essayNoteBody } from '@/lib/learn/essays/note';
import type { EssayVaultFailure } from '@/lib/learn/essays/vault';
import {
  reloadEssayFromVault,
  saveEssayDraft,
  saveEssayToVaultAction,
  setEssayWordTarget,
  type TargetState,
  type VaultSaveResult,
} from './actions';

/** How long after the last keystroke the draft is saved. */
const SAVE_AFTER_MS = 800;
/** How long to wait before trying a failed save again. */
const RETRY_AFTER_MS = 5000;
/** Five minutes without typing writes unsaved changes to the vault (spec, "Saving"). */
const VAULT_AFTER_MS = 5 * 60_000;

const SETTINGS_HREF = '/vault/settings';

type SaveState =
  | { kind: 'saved'; at: string | null }
  | { kind: 'pending' }
  | { kind: 'failed'; error: string };

/** The essay's note in the vault, as this visit has seen it. */
export type VaultState =
  | { kind: 'idle' }
  | { kind: 'saving' }
  | { kind: 'saved'; at: string }
  | { kind: 'failed'; reason: EssayVaultFailure; error: string };

function clock(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

function saveLine(draft: SaveState, vault: VaultState): string {
  if (draft.kind === 'failed') return `Not saved: ${draft.error} Trying again.`;
  if (vault.kind === 'saving') return 'Saving to your vault…';
  if (vault.kind === 'failed') return 'Not saved to your vault';
  if (draft.kind === 'pending') return 'Saving…';
  if (vault.kind === 'saved') return `Saved to your vault at ${clock(vault.at)}`;
  return draft.at ? `Saved at ${clock(draft.at)}` : 'Saved';
}

function sentence(text: string): string {
  return /[.!?]$/.test(text) ? text : `${text}.`;
}

function browserTimeZone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    return null;
  }
}

/**
 * The essay's two saves (plans #1865 and #1866).
 *
 * The draft saves to the database a moment after you stop typing, when the
 * tab is hidden and when you leave. The vault note is written on Cmd-S, when
 * you leave the page, and after five minutes without typing if the draft is
 * ahead of it; each is one commit, and its write carries the draft with it.
 *
 * Both run through one queue, one at a time, and each sends the newest text
 * when it starts, so an older draft never lands after a newer one and a
 * draft save never crosses a vault save. A draft save that fails says so and
 * tries again. A vault save that fails says why; once the note has changed
 * in Obsidian nothing writes to it on its own again until you reload.
 */
function useEssaySave(essay: Essay, initialVault: VaultState, onReloaded: (body: string) => void) {
  const latest = useRef(essay.draftBody);
  const saved = useRef(essay.draftBody);
  const inVault = useRef<string | null>(essay.unsaved ? null : essay.draftBody);
  const blobSha = useRef(essay.blobSha);
  const halted = useRef(initialVault.kind === 'failed' && initialVault.reason === 'changed');
  const queue = useRef<Promise<void>>(Promise.resolve());
  const draftQueued = useRef(false);
  const vaultQueued = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const idle = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [draft, setDraft] = useState<SaveState>({ kind: 'saved', at: null });
  const [vault, setVault] = useState<VaultState>(initialVault);
  const [path, setPath] = useState<string | null>(essay.noteId ? essay.path : null);
  const [reloadError, setReloadError] = useState<string | null>(null);

  const enqueue = useCallback((task: () => Promise<void>) => {
    queue.current = queue.current.then(task).catch(() => undefined);
    return queue.current;
  }, []);

  const draftTask = useCallback(async () => {
    while (latest.current !== saved.current) {
      const body = latest.current;
      setDraft({ kind: 'pending' });
      let result: Awaited<ReturnType<typeof saveEssayDraft>>;
      try {
        result = await saveEssayDraft(essay.id, body);
      } catch {
        result = { ok: false, error: 'The connection dropped.' };
      }
      if (!result.ok) {
        setDraft({ kind: 'failed', error: sentence(result.error) });
        return;
      }
      saved.current = body;
      setDraft({ kind: 'saved', at: result.savedAt });
    }
  }, [essay.id]);

  const flush = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    if (draftQueued.current) return queue.current;
    draftQueued.current = true;
    return enqueue(async () => {
      draftQueued.current = false;
      await draftTask();
    });
  }, [draftTask, enqueue]);

  const vaultTask = useCallback(async () => {
    const body = latest.current;
    if (body === inVault.current || essayNoteBody(body) === '') {
      await draftTask();
      return;
    }
    setVault({ kind: 'saving' });
    let result: VaultSaveResult;
    try {
      result = await saveEssayToVaultAction(essay.id, body, blobSha.current, browserTimeZone());
    } catch {
      result = { ok: false, reason: 'error', error: 'The connection dropped, so the essay is not in your vault yet.' };
    }
    if (result.ok) {
      blobSha.current = result.blobSha;
      inVault.current = body;
      saved.current = body;
      setPath(result.path);
      setDraft({ kind: 'saved', at: result.savedAt });
      setVault({ kind: 'saved', at: result.savedAt });
    } else {
      if (result.reason === 'changed') halted.current = true;
      setVault({ kind: 'failed', reason: result.reason, error: result.error });
    }
    // Anything typed while it ran, or the draft a failed write did not carry.
    await draftTask();
  }, [draftTask, essay.id]);

  /** Cmd-S and the button are `asked`; leaving and the idle timer are not, and stop once the note has changed. */
  const saveToVault = useCallback(
    (asked: boolean) => {
      if (idle.current) clearTimeout(idle.current);
      idle.current = null;
      if (halted.current && !asked) return flush();
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
      if (vaultQueued.current) return queue.current;
      vaultQueued.current = true;
      return enqueue(async () => {
        vaultQueued.current = false;
        await vaultTask();
      });
    },
    [enqueue, flush, vaultTask],
  );

  const reload = useCallback(() => {
    setReloadError(null);
    void enqueue(async () => {
      let result: Awaited<ReturnType<typeof reloadEssayFromVault>>;
      try {
        result = await reloadEssayFromVault(essay.id, blobSha.current);
      } catch {
        result = { ok: false, error: 'The connection dropped. Try again in a moment.' };
      }
      if (!result.ok) {
        setReloadError(result.error);
        return;
      }
      latest.current = result.body;
      saved.current = result.body;
      inVault.current = result.body;
      blobSha.current = result.blobSha;
      halted.current = false;
      setDraft({ kind: 'saved', at: null });
      setVault({ kind: 'idle' });
      onReloaded(result.body);
    });
  }, [enqueue, essay.id, onReloaded]);

  // A failed draft save is tried again until one goes through.
  useEffect(() => {
    if (draft.kind !== 'failed') return;
    const retry = setTimeout(() => void flush(), RETRY_AFTER_MS);
    return () => clearTimeout(retry);
  }, [draft, flush]);

  const change = useCallback(
    (doc: string) => {
      latest.current = doc;
      setDraft((now) => (now.kind === 'failed' ? now : { kind: 'pending' }));
      setVault((now) => (now.kind === 'saved' ? { kind: 'idle' } : now));
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void flush(), SAVE_AFTER_MS);
      if (idle.current) clearTimeout(idle.current);
      idle.current = setTimeout(() => void saveToVault(false), VAULT_AFTER_MS);
    },
    [flush, saveToVault],
  );

  useEffect(() => {
    const hidden = () => {
      if (document.visibilityState === 'hidden') void flush();
    };
    const leaving = (event: BeforeUnloadEvent) => {
      if (latest.current === inVault.current) return;
      void saveToVault(false);
      // Only a draft the database does not have yet is worth holding the tab for.
      if (latest.current !== saved.current) event.preventDefault();
    };
    document.addEventListener('visibilitychange', hidden);
    window.addEventListener('beforeunload', leaving);
    return () => {
      document.removeEventListener('visibilitychange', hidden);
      window.removeEventListener('beforeunload', leaving);
      if (idle.current) clearTimeout(idle.current);
      // Leaving for another page in the app: write it to the vault.
      void saveToVault(false);
    };
  }, [flush, saveToVault]);

  return { draft, vault, path, reloadError, change, saveToVault, reload };
}

/**
 * Why the last write to the vault did not happen, with the way forward: a
 * note changed in Obsidian offers to reload it, and a vault that cannot be
 * written links to its settings.
 */
function VaultSaveError({
  vault,
  reloadError,
  onReload,
}: {
  vault: VaultState;
  reloadError: string | null;
  onReload: () => void;
}) {
  if (vault.kind !== 'failed') return null;
  return (
    <Card padding="standard" role="alert" className="mt-3 flex flex-col items-start gap-3">
      <p className="text-ui text-danger">
        {vault.reason === 'changed'
          ? `${vault.error} Reloading shows that version and drops what you typed here since, so copy anything you want to keep first.`
          : vault.error}
      </p>
      {vault.reason === 'changed' && (
        <Button type="button" size="sm" variant="secondary" onClick={onReload}>
          Reload the note
        </Button>
      )}
      {(vault.reason === 'read-only' || vault.reason === 'reconnect') && (
        <Link
          href={SETTINGS_HREF}
          className="inline-flex min-h-11 items-center gap-1 text-ui font-medium text-accent hover:underline"
        >
          Open vault settings
          <ArrowRight className="size-3.5" strokeWidth={2} aria-hidden />
        </Link>
      )}
      {reloadError && <p className="text-ui text-danger">{reloadError}</p>}
    </Card>
  );
}

/** A vault path that breaks after its folder rather than inside the file name. */
function NotePath({ path }: { path: string }) {
  const slash = path.lastIndexOf('/');
  if (slash < 0) return <>{path}</>;
  return (
    <>
      <span className="text-ink-muted">{path.slice(0, slash + 1)}</span>
      <wbr />
      {path.slice(slash + 1)}
    </>
  );
}

/** The length you are aiming at, in the rail. */
function TargetForm({ id, target, onSet }: { id: string; target: number | null; onSet: (t: number | null) => void }) {
  const [state, action, pending] = useActionState(async (prev: TargetState, form: FormData) => {
    const next = await setEssayWordTarget(prev, form);
    if (!next.error && next.target !== undefined) onSet(next.target);
    return next;
  }, {});

  // The target is the number itself, typed over where it is read (law 12):
  // Enter or leaving the field sets it, and clearing it removes the target.
  return (
    <form action={action} className="flex flex-col gap-1">
      <input type="hidden" name="id" value={id} />
      <div className="flex items-center justify-between gap-3 text-ui text-ink">
        <span>Target</span>
        <span className="flex items-center gap-1">
          <InlineInput
            name="target"
            inputMode="numeric"
            defaultValue={target ?? ''}
            placeholder="None"
            aria-label="Word target, 200 to 2,000 words; leave empty for none"
            aria-invalid={state.error ? true : undefined}
            aria-describedby={state.error ? 'essay-target-error' : undefined}
            aria-busy={pending || undefined}
            onBlur={(event) => {
              const form = event.currentTarget.form;
              if (event.currentTarget.value !== String(target ?? '')) form?.requestSubmit();
            }}
            className="min-h-11 w-20 text-right tabular-nums lg:min-h-0"
          />
          <span className="text-ink-muted">words</span>
        </span>
      </div>
      {state.error && (
        <p id="essay-target-error" role="alert" className="text-small text-danger">
          {state.error}
        </p>
      )}
    </form>
  );
}

/**
 * One essay in the quiet editor (plan #1865; docs/LEARN-ESSAYS-SPEC.md, "The
 * writing surface"), on the main-plus-rail pattern.
 *
 * The column you write in is about 66 characters at 19px. Typing hides the
 * tools above it and the rail beside it; moving the mouse, or Escape, brings
 * them back. Focus mode dims every paragraph but the one you are in. The
 * word count stays at the foot, against the target when there is one, beside
 * where the essay was last saved.
 *
 * The rail holds the length and the vault note (plan #1866); later steps add
 * the margin notes and what you studied. On a phone it follows the text, so
 * the vault note and its save are there too; focus mode is laptop only.
 *
 * `initialVault` is for the gallery, which draws a save that stopped.
 */
export function EssayView({ essay, initialVault = { kind: 'idle' } }: { essay: Essay; initialVault?: VaultState }) {
  const [doc, setDoc] = useState({ text: essay.draftBody, version: 0 });
  const [words, setWords] = useState(() => countWords(essay.draftBody));
  const [title, setTitle] = useState(() => essayTitle(essay.draftBody, essay.path));
  const [target, setTarget] = useState(essay.wordTarget);
  const [typing, setTyping] = useState(false);
  const [focusMode, setFocusMode] = useState(false);

  // A reload puts the vault's version in a fresh editor.
  const onReloaded = useCallback(
    (body: string) => {
      setDoc((now) => ({ text: body, version: now.version + 1 }));
      setWords(countWords(body));
      setTitle(essayTitle(body, essay.path));
    },
    [essay.path],
  );
  const { draft, vault, path, reloadError, change, saveToVault, reload } = useEssaySave(
    essay,
    initialVault,
    onReloaded,
  );

  const onChange = useCallback(
    (text: string) => {
      setWords(countWords(text));
      setTitle(essayTitle(text, essay.path));
      change(text);
    },
    [change, essay.path],
  );
  const onTyping = useCallback(() => setTyping(true), []);
  const onSaveNow = useCallback(() => void saveToVault(true), [saveToVault]);

  // The tools come back when the mouse moves or Escape is pressed.
  useEffect(() => {
    if (!typing) return;
    const show = () => setTyping(false);
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setTyping(false);
    };
    window.addEventListener('mousemove', show, { once: true });
    window.addEventListener('keydown', key);
    return () => {
      window.removeEventListener('mousemove', show);
      window.removeEventListener('keydown', key);
    };
  }, [typing]);

  const quiet = cn(
    'transition-opacity duration-quick focus-within:opacity-100',
    typing && 'pointer-events-none opacity-0 focus-within:pointer-events-auto',
  );
  const countLabel = wordCountLabel(words, target);

  const main = (
    // As wide as the 33em text column at 19px plus the panel's inset, so the
    // panel ends where the text does.
    <div className="flex max-w-2xl flex-col">
      <h1 className="sr-only">{title}</h1>
      <div className={cn('mb-6 flex min-h-11 items-center justify-between gap-3', quiet)}>
        <Link
          href="/learn/essays"
          className="inline-flex min-h-11 items-center gap-1 text-ui text-ink-muted hover:text-ink"
        >
          <ChevronLeft className="size-4" strokeWidth={2} aria-hidden />
          Essays
        </Link>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-pressed={focusMode}
          onClick={() => setFocusMode((on) => !on)}
          className="hidden lg:inline-flex"
        >
          {focusMode ? 'Focus on' : 'Focus'}
        </Button>
      </div>
      <Card padding="standard">
        <MarkdownEditor
          key={doc.version}
          initialDoc={doc.text}
          label={`Essay: ${title}`}
          placeholder="Start with a title, like # Why money is the odd good out"
          focusMode={focusMode}
          autoFocus={essay.draftBody === ''}
          onChange={onChange}
          onTyping={onTyping}
          onSaveNow={onSaveNow}
        />
      </Card>
      <div className="mt-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-1 text-small text-ink-muted">
        <span className="tabular-nums">{countLabel}</span>
        <span role="status" className={cn(draft.kind === 'failed' && 'text-danger')}>
          {saveLine(draft, vault)}
        </span>
      </div>
      <VaultSaveError vault={vault} reloadError={reloadError} onReload={reload} />
    </div>
  );

  const rail = (
    <div className={quiet}>
      <Card padding="none">
        <CardSection title="Length">
          {target !== null && (
            <Meter value={Math.min(words, target)} max={target} label={countLabel} className="mb-3" />
          )}
          <TargetForm id={essay.id} target={target} onSet={setTarget} />
        </CardSection>
        <CardSection title="Vault">
          <p className="text-ui text-ink [overflow-wrap:anywhere]">
            {path ? <NotePath path={path} /> : 'Not in your vault yet'}
          </p>
          <p className="mt-1 text-small text-ink-muted">
            Saved as a note on Cmd-S, when you leave, and after five minutes without typing.
          </p>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="mt-3"
            disabled={vault.kind === 'saving'}
            onClick={() => void saveToVault(true)}
          >
            Save to vault
          </Button>
        </CardSection>
      </Card>
    </div>
  );

  return <MainRail main={main} rail={rail} />;
}
