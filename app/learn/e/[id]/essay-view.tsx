'use client';

import { useActionState, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link, { linkVariants } from '@/components/ui/link';
import { ArrowRight } from 'lucide-react';
import { PageColumn } from '@/components/shell/page-width';
import { MarkdownEditor, type MarkdownEditorHandle } from '@/components/learn/markdown-editor';
import { TextSizeControl, useTextScale } from '@/components/learn/text-size';
import { DashAction } from '@/components/ui/dash-action';
import { Button } from '@/components/ui/button';
import { Card, CardSection } from '@/components/ui/card';
import { InlineInput } from '@/components/ui/field';
import { Meter } from '@/components/ui/meter';
import { cn } from '@/lib/cn';
import {
  countWords,
  essayTitle,
  retitleEssay,
  wordCountLabel,
  type Essay,
  type EssayBrief,
} from '@/lib/learn/essays/model';
import { essayNoteBody, type EssayStage } from '@/lib/learn/essays/note';
import { essayParagraphs } from '@/lib/learn/essays/checks';
import type { EssayNotes } from '@/lib/learn/essays/notes-store';
import {
  draftMarksJson,
  yourWords,
  YOUR_WORDS_RULE,
  type AuthorMark,
} from '@/lib/learn/essays/authorship';
import type { Suggestion } from '@/lib/learn/essays/authorship-editor';
import type { EssayVaultFailure } from '@/lib/learn/essays/vault';
import {
  finishEssay,
  publishEssay,
  rephraseEssaySelection,
  reloadEssayFromVault,
  saveEssayDraft,
  saveEssayToVaultAction,
  setEssayWordTarget,
  type FinishResult,
  type PublishResult,
  type TargetState,
  type VaultSaveResult,
} from './actions';
import { EssayBriefFold } from './essay-brief';
import { EssayNotesCard, noteRangesIn, useEssayNotes } from './essay-notes';
import { EssayStudyCard, useEssayStudy, type StudyState } from './essay-study';
import { EssayResearchCard, useEssayResearch } from './essay-research';
import { logEssayView } from './guide-actions';
import {
  FromNotesCard,
  ModelDraftPanel,
  NoteMapCard,
  NotesEditor,
  useEssayPlan,
} from './essay-notebook';
import { EMPTY_PLAN } from '@/lib/learn/essays/plan';
import { Segmented } from '@/components/ui/segmented';
import { MODELS } from '@/lib/core/models';
import { EssayFinishCard, type FinishView } from './essay-finish';
import { EssayPublishCard, type PublishView } from './essay-publish';
import { NO_RESEARCH, type EssayResearchRuns } from '@/lib/learn/essays/research';
import { Tooltip } from '@/components/ui/tooltip';
import { PathLine } from '@/components/shell/back-link';
import { parentCrumb } from '@/lib/core/back-from';
import type { Subject as PageSubject } from '@/components/shell/page-header';
import { deviceTimeZone, whenTime } from '@/lib/core/when';
import { AttachedNotesCard } from './attached-notes';
import type { AttachedNote } from '@/lib/learn/essays/vault-notes';

/** How long after the last keystroke the draft is saved. */
const SAVE_AFTER_MS = 800;
/** How long to wait before trying a failed save again. */
const RETRY_AFTER_MS = 5000;
/** Five minutes without typing writes unsaved changes to the vault (spec, "Saving"). */
const VAULT_AFTER_MS = 5 * 60_000;

const SETTINGS_HREF = '/vault/settings';

const NO_NOTES: EssayNotes = { notes: [], stopped: [] };

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
  return whenTime(iso, { timeZone: deviceTimeZone() ?? 'UTC' });
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

/** What Finish and Publish both answer: the vault save they made, or why they stopped. */
type VaultPress =
  | { ok: true; savedAt: string; path: string; blobSha: string }
  | {
      ok: false;
      error: string;
      saved?: { savedAt: string; path: string; blobSha: string };
      reason?: EssayVaultFailure;
    };

/** The draft as the saves send it: the text and who wrote which runs of it. */
type Draft = { text: string; marks: AuthorMark[] };

/** One string for a draft, so "has this been saved" is one comparison. */
function draftKey(draft: Draft): string {
  return `${draft.text}\u0000${JSON.stringify(draftMarksJson(draft.marks))}`;
}

function browserTimeZone(): string | null {
  return deviceTimeZone();
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
 *
 * Who wrote which runs of the text (plan #1868) travels with it in both
 * saves, so a change to the marks alone, such as clearing them, is saved too.
 */
function useEssaySave(
  essay: Essay,
  initialVault: VaultState,
  onReloaded: (draft: Draft, askMarks: boolean) => void,
) {
  const first: Draft = { text: essay.draftBody, marks: essay.marks };
  const latest = useRef(first);
  const saved = useRef(draftKey(first));
  const inVault = useRef<string | null>(essay.unsaved ? null : draftKey(first));
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
    while (draftKey(latest.current) !== saved.current) {
      const body = latest.current;
      setDraft({ kind: 'pending' });
      let result: Awaited<ReturnType<typeof saveEssayDraft>>;
      try {
        result = await saveEssayDraft(essay.id, body.text, draftMarksJson(body.marks));
      } catch {
        result = { ok: false, error: 'The connection dropped.' };
      }
      if (!result.ok) {
        setDraft({ kind: 'failed', error: sentence(result.error) });
        return;
      }
      saved.current = draftKey(body);
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
    const key = draftKey(body);
    if (key === inVault.current || essayNoteBody(body.text) === '') {
      await draftTask();
      return;
    }
    setVault({ kind: 'saving' });
    let result: VaultSaveResult;
    try {
      result = await saveEssayToVaultAction(
        essay.id,
        body.text,
        draftMarksJson(body.marks),
        blobSha.current,
        browserTimeZone(),
      );
    } catch {
      result = {
        ok: false,
        reason: 'error',
        error: 'The connection dropped, so the essay is not in your vault yet.',
      };
    }
    if (result.ok) {
      blobSha.current = result.blobSha;
      inVault.current = key;
      saved.current = key;
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

  /**
   * Finish (plan #1873) and Publish (plan #1863.11): each a vault save with
   * more after it. They go through the same queue as the other saves and
   * keep the same blob SHA, so what they wrote is what the next save starts from.
   */
  const vaultPress = useCallback(
    <R extends FinishResult | PublishResult>(
      call: (body: Draft) => Promise<R>,
      empty: string,
      dropped: string,
    ) =>
      new Promise<R | { ok: false; error: string }>((resolve) => {
        void enqueue(async () => {
          const body = latest.current;
          const key = draftKey(body);
          if (essayNoteBody(body.text) === '') {
            resolve({ ok: false, error: empty });
            return;
          }
          setVault({ kind: 'saving' });
          let result: R | { ok: false; error: string };
          try {
            result = await call(body);
          } catch {
            result = { ok: false, error: dropped };
          }
          const outcome: VaultPress = result;
          const kept = outcome.ok ? outcome : outcome.saved;
          if (kept) {
            blobSha.current = kept.blobSha;
            inVault.current = key;
            saved.current = key;
            setPath(kept.path);
            setDraft({ kind: 'saved', at: kept.savedAt });
            setVault({ kind: 'saved', at: kept.savedAt });
          } else if (!outcome.ok && outcome.reason) {
            if (outcome.reason === 'changed') halted.current = true;
            setVault({ kind: 'failed', reason: outcome.reason, error: outcome.error });
          } else {
            setVault({ kind: 'idle' });
          }
          resolve(result);
          await draftTask();
        });
      }),
    [draftTask, enqueue],
  );

  const finish = useCallback(
    () =>
      vaultPress<FinishResult>(
        (body) =>
          finishEssay(
            essay.id,
            body.text,
            draftMarksJson(body.marks),
            blobSha.current,
            browserTimeZone(),
          ),
        'Write something first; there is nothing to finish yet.',
        'The connection dropped, so the essay is not finished yet.',
      ),
    [essay.id, vaultPress],
  );

  const publish = useCallback(
    () =>
      vaultPress<PublishResult>(
        (body) =>
          publishEssay(
            essay.id,
            body.text,
            draftMarksJson(body.marks),
            blobSha.current,
            browserTimeZone(),
          ),
        'Write something first; there is nothing to publish yet.',
        'The connection dropped, so the essay is not published yet.',
      ),
    [essay.id, vaultPress],
  );

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
      const reloaded: Draft = { text: result.body, marks: result.marks };
      latest.current = reloaded;
      saved.current = draftKey(reloaded);
      inVault.current = draftKey(reloaded);
      blobSha.current = result.blobSha;
      halted.current = false;
      setDraft({ kind: 'saved', at: null });
      setVault({ kind: 'idle' });
      onReloaded(reloaded, result.askMarks);
    });
  }, [enqueue, essay.id, onReloaded]);

  // A failed draft save is tried again until one goes through.
  useEffect(() => {
    if (draft.kind !== 'failed') return;
    const retry = setTimeout(() => void flush(), RETRY_AFTER_MS);
    return () => clearTimeout(retry);
  }, [draft, flush]);

  const change = useCallback(
    (doc: Draft) => {
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
      const key = draftKey(latest.current);
      if (key === inVault.current) return;
      void saveToVault(false);
      // Only a draft the database does not have yet is worth holding the tab for.
      if (key !== saved.current) event.preventDefault();
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

  return { draft, vault, path, reloadError, change, saveToVault, reload, finish, publish };
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
          className={cn(
            'inline-flex min-h-11 items-center gap-1 text-ui font-medium',
            linkVariants(),
          )}
        >
          Open vault settings
          <ArrowRight className="size-3.5" strokeWidth={1.75} aria-hidden />
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
function TargetForm({
  id,
  target,
  onSet,
}: {
  id: string;
  target: number | null;
  onSet: (t: number | null) => void;
}) {
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
 * One essay (plan #1865; docs/LEARN-ESSAYS-SPEC.md, "Notes first" and "The
 * writing surface"), in three tabs over one column: Prepare, Notes and Draft.
 *
 * Notes and Draft are each an editor and nothing else, so the page you write
 * on holds only your text, the word count and where it was last saved. The
 * tools stay where they are while you type: hiding them on the first
 * keystroke moved the page under the person (note of 16 October 2026).
 * Focus mode dims every paragraph but the one you are in.
 *
 * Prepare holds everything that used to sit in the rail beside them, one
 * card under another at the same width: the brief, Dash's map of the notes
 * with its questions and sources, From your notes (Assemble and the model
 * draft), the checks and their margin notes (plan #1869, essay-notes.tsx),
 * From your study (plan #1863.8, essay-study.tsx), research (plan #1863.9,
 * essay-research.tsx), the length and the vault note (plan #1866), Finish
 * (plan #1873) and Publish (plan #1863.11, essay-publish.tsx).
 *
 * All three tabs stay mounted and the two away are hidden, so the editors
 * keep their cursor and history, and Prepare can still put text into the
 * draft: a study link, a quote or a footnote goes in where the cursor was
 * and the page moves to the Draft tab to show it. Pressing a margin note's
 * marker in the draft moves to Prepare with that note open.
 *
 * Select some text and Rephrase asks Dash for one rewording of it (rung 4,
 * plan #1868), shown struck through and replaced, with Accept and Reject.
 * Accepted text is marked as Dash's, and Prepare says what share of the
 * words are yours.
 *
 * `initialVault`, `briefOpen`, `initialSuggestion`, `initialAskMarks`,
 * `initialNoteOpen` and `study` are for the gallery, which draws a save that
 * stopped, the brief unfolded, a suggestion waiting, the question after a
 * reload, a note opened and the study panel in a given state.
 */
export function EssayView({
  essay,
  initialVault = { kind: 'idle' },
  briefOpen = false,
  initialSuggestion = null,
  initialAskMarks = false,
  notes = NO_NOTES,
  initialNoteOpen = null,
  study,
  research = NO_RESEARCH,
  researchRunning = null,
  finishView,
  finishStage,
  publishView,
  path: subject,
  initialView,
  planFrozen = false,
  attachedNotes = [],
}: {
  essay: Essay;
  initialVault?: VaultState;
  briefOpen?: boolean;
  initialSuggestion?: Suggestion | null;
  initialAskMarks?: boolean;
  /** The margin notes, found again in the draft on load (plan #1869). */
  notes?: EssayNotes;
  initialNoteOpen?: string | null;
  /** The study panel drawn in this state and never searching, for the gallery. */
  study?: StudyState;
  /** The newest research run of each level (plan #1863.9). */
  research?: EssayResearchRuns;
  /** A level drawn as running, for the gallery. */
  researchRunning?: 'first' | 'deeper' | null;
  /** The Finish card drawn in this state, for the gallery (plan #1873). */
  finishView?: FinishView;
  /** The stage the gallery's finished essay is at. */
  finishStage?: EssayStage;
  /** The path to the essay, from the page (rowSubject); the gallery passes none and keeps the link to Essays. */
  path?: PageSubject;
  /** The Publish card drawn in this state, for the gallery (plan #1863.11). */
  publishView?: PublishView;
  /** The view to open on: from the page's `?view=`, or the gallery's. The draft once there is one, otherwise the notes. */
  initialView?: EssayMode | null;
  /** The plan drawn and never saved, for the gallery. */
  planFrozen?: boolean;
  /** Vault notes attached to the essay's notes (attach_vault_note). */
  attachedNotes?: readonly AttachedNote[];
}) {
  const [doc, setDoc] = useState({ text: essay.draftBody, marks: essay.marks, version: 0 });
  const [words, setWords] = useState(() => countWords(essay.draftBody));
  const [share, setShare] = useState(() => yourWords(essay.draftBody, essay.marks).percent);
  const [askMarks, setAskMarks] = useState(initialAskMarks);
  const [selected, setSelected] = useState(false);
  const [rephrase, setRephrase] = useState<
    { kind: 'idle' } | { kind: 'asking' } | { kind: 'failed'; error: string }
  >({
    kind: 'idle',
  });
  const editor = useRef<MarkdownEditorHandle>(null);
  const [paragraphs, setParagraphs] = useState(() => essayParagraphs(essay.draftBody).length);
  const noteApi = useEssayNotes(essay.id, notes, editor, initialNoteOpen);
  const studyApi = useEssayStudy(essay.id, editor, study, study !== undefined);
  const onInsert = useCallback((text: string, quote?: { name: string }) => {
    editor.current?.insert(text, quote);
  }, []);
  const researchApi = useEssayResearch(
    essay.id,
    editor,
    research,
    researchRunning ? { [researchRunning]: 'running' } : {},
  );
  const onHideStudy = studyApi.hide;
  const placedNotes = noteApi.notes;
  const initialNotes = useMemo(() => noteRangesIn(doc.text, placedNotes), [doc, placedNotes]);
  const [title, setTitle] = useState(() => essayTitle(essay.draftBody, essay.path));
  const [target, setTarget] = useState(essay.wordTarget);
  // Finish in this visit makes Publish available without a reload.
  const [finishedAt, setFinishedAt] = useState(essay.finishedAt);
  const [focusMode, setFocusMode] = useState(false);
  const [textScale, stepTextScale] = useTextScale();
  const [brief, setBrief] = useState(essay.brief);
  const onBrief = useCallback((next: EssayBrief) => {
    setBrief(next);
  }, []);
  const planApi = useEssayPlan(essay.id, essay.plan ?? EMPTY_PLAN, planFrozen);
  const plan = planApi.plan;
  const notesEditor = useRef<MarkdownEditorHandle>(null);
  const [mode, setModeState] = useState<EssayMode>(
    () => initialView ?? (countWords(essay.draftBody) >= 150 ? 'draft' : 'notes'),
  );
  const [openedOn] = useState(mode);
  // What to do once a tab change has been drawn: an editor can only take the
  // cursor, and a note can only scroll into view, once its tab is showing.
  const afterSwitch = useRef<(() => void) | null>(null);
  const go = useCallback(
    (next: EssayMode, then?: () => void) => {
      afterSwitch.current = then ?? null;
      if (next === mode) {
        afterSwitch.current = null;
        then?.();
        return;
      }
      setModeState(next);
      // The log counts the notes and the draft (learn.essay_log); Prepare is not a view of the text.
      if (!planFrozen && next !== 'prepare')
        void logEssayView(essay.id, next).catch(() => undefined);
      try {
        const url = new URL(window.location.href);
        url.searchParams.set('view', next);
        window.history.replaceState(window.history.state, '', url);
      } catch {
        // The address is a convenience; the view still changes without it.
      }
    },
    [essay.id, mode, planFrozen],
  );
  useEffect(() => {
    const then = afterSwitch.current;
    afterSwitch.current = null;
    then?.();
  }, [mode]);
  // A tab pressed by the person puts the cursor back in the editor it shows.
  const setMode = useCallback(
    (next: EssayMode) =>
      go(next, () => {
        if (next === 'draft') editor.current?.focus();
        else if (next === 'notes') notesEditor.current?.focus();
      }),
    [go],
  );
  // The view the page opened on counts as a visit too.
  useEffect(() => {
    if (!planFrozen && mode !== 'prepare') void logEssayView(essay.id, mode).catch(() => undefined);
    // Once, on arrival.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  /** Text added to the end of the notes goes through the notes editor, so it saves as typing does. */
  const appendToNotes = useCallback((text: string) => {
    const handle = notesEditor.current;
    if (!handle) return;
    const end = handle.doc().length;
    handle.replace({ from: end, to: end, insert: text });
  }, []);

  // A reload puts the vault's version in a fresh editor.
  const onReloaded = useCallback(
    (next: Draft, ask: boolean) => {
      setDoc((now) => ({ text: next.text, marks: next.marks, version: now.version + 1 }));
      setWords(countWords(next.text));
      setShare(yourWords(next.text, next.marks).percent);
      setTitle(essayTitle(next.text, essay.path));
      setAskMarks(ask);
    },
    [essay.path],
  );
  const { draft, vault, path, reloadError, change, saveToVault, reload, finish, publish } =
    useEssaySave(essay, initialVault, onReloaded);

  const onChange = useCallback(
    (text: string, marks: AuthorMark[]) => {
      setWords(countWords(text));
      setParagraphs(essayParagraphs(text).length);
      setShare(yourWords(text, marks).percent);
      setTitle(essayTitle(text, essay.path));
      change({ text, marks });
    },
    [change, essay.path],
  );
  const onSelect = useCallback((on: boolean) => {
    setSelected(on);
    if (on) setRephrase((now) => (now.kind === 'failed' ? { kind: 'idle' } : now));
  }, []);

  const askRephrase = useCallback(async () => {
    const selection = editor.current?.selection();
    if (!selection) return;
    setRephrase({ kind: 'asking' });
    let result: Awaited<ReturnType<typeof rephraseEssaySelection>>;
    try {
      result = await rephraseEssaySelection(essay.id, selection.doc, selection.from, selection.to);
    } catch {
      result = { ok: false, error: 'The connection dropped. Try again in a moment.' };
    }
    if (!result.ok) {
      setRephrase({ kind: 'failed', error: result.error });
      return;
    }
    const shown = editor.current?.suggest(
      { from: result.from, to: result.to, text: result.text, name: result.name },
      result.original,
    );
    setRephrase(
      shown
        ? { kind: 'idle' }
        : {
            kind: 'failed',
            error: 'That text changed while Dash was rewording it. Select it again and ask again.',
          },
    );
  }, [essay.id]);

  // Once a draft save lands, the notes' new places go with it.
  const keepPlaces = noteApi.keepPlaces;
  useEffect(() => {
    if (draft.kind === 'saved' && draft.at) keepPlaces();
  }, [draft, keepPlaces]);

  const clearMarks = useCallback(() => {
    editor.current?.setMarks([]);
    setAskMarks(false);
  }, []);
  const onSaveNow = useCallback(() => void saveToVault(true), [saveToVault]);

  const writing = mode === 'draft';
  const [renaming, setRenaming] = useState(false);
  // Renaming rewrites the draft's title line (note 1c956878), through the
  // draft's editor, which stays mounted on every tab and hands the text up as
  // typing does.
  const rename = useCallback(
    (next: string) => {
      setRenaming(false);
      if (!next.trim() || next.trim() === title) return;
      const open = editor.current;
      if (open) open.replace(retitleEssay(open.doc(), next));
    },
    [title],
  );
  // The path ends in the essay's name as it is now, not as the page was served.
  const crumbs = subject?.path.map((crumb, i, all) =>
    i === all.length - 1 ? { ...crumb, label: title } : crumb,
  );
  const onAssemble = useCallback(
    (next: { text: string; marks: AuthorMark[] }) => {
      setDoc((now) => ({ text: next.text, marks: next.marks, version: now.version + 1 }));
      onChange(next.text, next.marks);
      go('draft');
    },
    [go, onChange],
  );
  // What Prepare puts into the draft goes in where the cursor was, and the
  // page moves to the draft to show it.
  const insertInDraft = useCallback(
    (text: string, quote?: { name: string }) => go('draft', () => onInsert(text, quote)),
    [go, onInsert],
  );
  const cite = researchApi.cite;
  const researchCard = useMemo(
    () => ({
      ...researchApi,
      cite: (...args: Parameters<typeof cite>) => go('draft', () => cite(...args)),
    }),
    [cite, go, researchApi],
  );
  const openNote = noteApi.open;
  const onOpenNote = useCallback((id: string) => go('prepare', () => openNote(id)), [go, openNote]);
  const countLabel = wordCountLabel(words, target);

  const header = (
    <div className="mb-4 flex min-h-11 items-center justify-between gap-3">
      {/* The path, workspace › Essays › this essay, and the one back link
          (plans #1931.2, #1931.3). */}
      {renaming ? (
        <InlineInput
          autoFocus
          defaultValue={title}
          aria-label="Essay name"
          onBlur={(event) => rename(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              rename(event.currentTarget.value);
            } else if (event.key === 'Escape') {
              // Put the name back first, so the blur as it closes changes nothing.
              event.currentTarget.value = title;
              setRenaming(false);
            }
          }}
          className="min-h-11 min-w-0 flex-1 lg:min-h-0"
        />
      ) : subject && crumbs ? (
        <PathLine crumbs={crumbs} fallback={parentCrumb(subject.path)} />
      ) : (
        <span />
      )}
      {!renaming && (
        <Button type="button" variant="ghost" size="sm" onClick={() => setRenaming(true)}>
          Rename
        </Button>
      )}
    </div>
  );

  // The tabs on the left; on the right, what the draft's tab can do to its text.
  const tabs = (
    <div className="mb-4 flex min-h-11 flex-wrap items-center justify-between gap-2 min-[375px]:flex-nowrap">
      <Segmented
        label="Prepare, notes or draft"
        value={mode}
        onChange={setMode}
        options={[
          { value: 'prepare', label: 'Prepare' },
          { value: 'notes', label: 'Notes' },
          { value: 'draft', label: 'Draft' },
        ]}
      />
      <div className={cn('ml-auto flex items-center gap-1 max-sm:gap-0', mode === 'prepare' && 'hidden')}>
        <TextSizeControl scale={textScale} onStep={stepTextScale} />
        <DashAction
          paid="app/learn/e/[id]/actions.ts#rephraseEssaySelection"
          what="Cost of a rephrase"
          hintFirst
          type="button"
          variant="ghost"
          size="sm"
          disabled={!selected || rephrase.kind === 'asking'}
          pending={rephrase.kind === 'asking'}
          // Keeps the editor's selection showing while the button is pressed.
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => void askRephrase()}
          title={selected ? undefined : 'Select some text to have Dash reword it'}
          wrapperClassName={cn(!writing && 'hidden')}
        >
          {rephrase.kind === 'asking' ? 'Rephrasing…' : 'Rephrase'}
        </DashAction>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-pressed={focusMode}
          onClick={() => setFocusMode((on) => !on)}
          className={cn('hidden', writing && 'lg:inline-flex')}
        >
          {focusMode ? 'Focus on' : 'Focus'}
        </Button>
      </div>
    </div>
  );

  const prepare = (
    <div className="flex flex-col gap-4">
      <EssayBriefFold
        essayId={essay.id}
        brief={brief}
        onChange={onBrief}
        defaultOpen={briefOpen}
        className="mb-0"
      />
      <NoteMapCard essayId={essay.id} api={planApi} append={appendToNotes} />
      <AttachedNotesCard essayId={essay.id} initial={attachedNotes} />
      <FromNotesCard
        essayId={essay.id}
        api={planApi}
        map={plan.noteMap}
        draftWords={words}
        title={brief.question.trim() || title}
        model={MODELS.learnEssayGuide}
        onAssemble={onAssemble}
      />
      <EssayNotesCard api={noteApi} paragraphs={paragraphs} />
      <EssayStudyCard
        state={studyApi.state}
        onInsert={insertInDraft}
        onHide={(key) => void onHideStudy(key)}
      />
      <EssayResearchCard api={researchCard} />
      <Card padding="none">
        <CardSection title="Length">
          {target !== null && (
            <Meter
              value={Math.min(words, target)}
              max={target}
              label={countLabel}
              className="mb-3"
            />
          )}
          <TargetForm id={essay.id} target={target} onSet={setTarget} />
          {/* One row like Target; the counting rule is on the figure, for a pointer and a screen reader. */}
          <p className="mt-2 flex items-center justify-between gap-3 text-ui text-ink">
            <span>Your words</span>
            <Tooltip label={YOUR_WORDS_RULE} align="end">
              <span tabIndex={0} className="tabular-nums">
                {share === null ? 'None yet' : `${share}%`}
              </span>
            </Tooltip>
            <span className="sr-only">{YOUR_WORDS_RULE}</span>
          </p>
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
      <EssayFinishCard
        essayId={essay.id}
        finishedAt={essay.finishedAt}
        inEvidenceBank={essay.inEvidenceBank}
        canFinish={words > 0 && vault.kind !== 'saving'}
        onFinish={finish}
        onFinished={setFinishedAt}
        initial={finishView}
        stage={finishStage}
      />
      <EssayPublishCard
        essayId={essay.id}
        finished={finishedAt !== null}
        publishedAt={essay.publishedAt}
        firstPublishedAt={essay.firstPublishedAt ?? null}
        slug={essay.slug ?? null}
        canPublish={words > 0 && vault.kind !== 'saving'}
        onPublish={publish}
        initial={publishView}
      />
    </div>
  );

  const draftTab = (
    <>
      {askMarks && (
        <Card padding="standard" role="alert" className="mb-3 flex flex-col items-start gap-3">
          <p className="text-ui text-ink">
            This note was edited outside Dash after the marks saying who wrote what were saved, so
            they may not line up any more. Keep them, moved to where the same words are now, or
            clear them and count every word as yours.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" variant="secondary" onClick={() => setAskMarks(false)}>
              Keep the marks
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={clearMarks}>
              Clear the marks
            </Button>
          </div>
        </Card>
      )}
      <Card padding="standard">
        <MarkdownEditor
          key={doc.version}
          handle={editor}
          initialDoc={doc.text}
          initialMarks={doc.marks}
          initialSuggestion={doc.version === 0 ? initialSuggestion : null}
          initialNotes={initialNotes}
          onOpenNote={onOpenNote}
          label={`Essay: ${title}`}
          placeholder="Start with a title, like # Why money is the odd good out"
          focusMode={focusMode}
          autoFocus={doc.version > 0 || openedOn === 'draft'}
          onChange={onChange}
          onSaveNow={onSaveNow}
          onSelect={onSelect}
          onCaret={studyApi.onCaret}
          textScale={textScale}
        />
      </Card>
      {rephrase.kind === 'failed' && (
        <p role="alert" className="mt-2 px-1 text-small text-danger">
          {rephrase.error}
        </p>
      )}
      <div className="mt-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-1 text-small text-ink-muted">
        <span className="tabular-nums">{countLabel}</span>
        <span role="status" className={cn(draft.kind === 'failed' && 'text-danger')}>
          {saveLine(draft, vault)}
        </span>
      </div>
      <ModelDraftPanel draft={plan.modelDraft} />
    </>
  );

  // One column at the essay's reading measure (max-w-2xl, the 33em text at
  // 19px plus the card's inset) on every tab, so changing tab moves nothing
  // sideways. Each tab is drawn once and the two away are hidden.
  return (
    <PageColumn className="flex max-w-2xl flex-col">
      <h1 className="sr-only">{title}</h1>
      {header}
      {tabs}
      <div className="mb-4 empty:hidden">
        <VaultSaveError vault={vault} reloadError={reloadError} onReload={reload} />
      </div>
      <section aria-label="Prepare" hidden={mode !== 'prepare'}>
        {prepare}
      </section>
      <section aria-label="Notes" hidden={mode !== 'notes'}>
        <NotesEditor
          brief={brief}
          api={planApi}
          handle={notesEditor}
          autoFocus={openedOn === 'notes'}
          textScale={textScale}
        />
      </section>
      <section aria-label="Draft" hidden={!writing}>
        {draftTab}
      </section>
    </PageColumn>
  );
}

/** The three tabs of an essay (LEARN-ESSAYS-SPEC, "Notes first"). */
export type EssayMode = 'prepare' | 'notes' | 'draft';
