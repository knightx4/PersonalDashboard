'use client';

import { useActionState, useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';
import { MainRail } from '@/components/patterns/main-rail';
import { MarkdownEditor } from '@/components/learn/markdown-editor';
import { Button } from '@/components/ui/button';
import { Card, CardSection } from '@/components/ui/card';
import { InlineInput } from '@/components/ui/field';
import { Meter } from '@/components/ui/meter';
import { cn } from '@/lib/cn';
import { countWords, essayTitle, wordCountLabel, type Essay } from '@/lib/learn/essays/model';
import { saveEssayDraft, setEssayWordTarget, type TargetState } from './actions';

/** How long after the last keystroke the draft is saved. */
const SAVE_AFTER_MS = 800;
/** How long to wait before trying a failed save again. */
const RETRY_AFTER_MS = 5000;

type SaveState =
  | { kind: 'saved'; at: string | null }
  | { kind: 'pending' }
  | { kind: 'failed'; error: string };

function clock(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

function saveLine(state: SaveState): string {
  if (state.kind === 'pending') return 'Saving…';
  if (state.kind === 'failed') return `Not saved: ${state.error} Trying again.`;
  return state.at ? `Saved at ${clock(state.at)}` : 'Saved';
}

/**
 * The draft saves itself (plan #1865): a moment after you stop typing, when
 * you press Cmd-S, when the tab is hidden and when you leave the page. One
 * save runs at a time and always sends the newest text, so an older draft
 * can never land after a newer one. A save that fails says so, keeps the
 * text, and tries again.
 */
function useDraftSave(id: string, initial: string) {
  const latest = useRef(initial);
  const saved = useRef(initial);
  const running = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [state, setState] = useState<SaveState>({ kind: 'saved', at: null });

  const flush = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    // A save already running picks up the newest text when it finishes.
    if (running.current) return;
    running.current = true;
    try {
      while (latest.current !== saved.current) {
        const body = latest.current;
        setState({ kind: 'pending' });
        let result: Awaited<ReturnType<typeof saveEssayDraft>>;
        try {
          result = await saveEssayDraft(id, body);
        } catch {
          result = { ok: false, error: 'The connection dropped.' };
        }
        if (!result.ok) {
          const error = /[.!?]$/.test(result.error) ? result.error : `${result.error}.`;
          setState({ kind: 'failed', error });
          return;
        }
        saved.current = body;
        setState({ kind: 'saved', at: result.savedAt });
      }
    } finally {
      running.current = false;
    }
  }, [id]);

  // A failed save is tried again until one goes through.
  useEffect(() => {
    if (state.kind !== 'failed') return;
    const retry = setTimeout(() => void flush(), RETRY_AFTER_MS);
    return () => clearTimeout(retry);
  }, [state, flush]);

  const change = useCallback(
    (doc: string) => {
      latest.current = doc;
      setState((now) => (now.kind === 'failed' ? now : { kind: 'pending' }));
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void flush(), SAVE_AFTER_MS);
    },
    [flush],
  );

  useEffect(() => {
    const hidden = () => {
      if (document.visibilityState === 'hidden') void flush();
    };
    const leaving = (event: BeforeUnloadEvent) => {
      if (latest.current === saved.current) return;
      void flush();
      event.preventDefault();
    };
    document.addEventListener('visibilitychange', hidden);
    window.addEventListener('beforeunload', leaving);
    return () => {
      document.removeEventListener('visibilitychange', hidden);
      window.removeEventListener('beforeunload', leaving);
      // Leaving for another page in the app: send what is left.
      void flush();
    };
  }, [flush]);

  return { state, change, flush };
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
            className="w-20 text-right tabular-nums"
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
 * word count stays at the foot, against the target when there is one.
 *
 * From laptop width the rail holds the length; later steps add the margin
 * notes and what you studied. On a phone there is no rail and no focus mode,
 * only the text and the count.
 */
export function EssayView({ essay }: { essay: Essay }) {
  const [words, setWords] = useState(() => countWords(essay.draftBody));
  const [title, setTitle] = useState(() => essayTitle(essay.draftBody, essay.path));
  const [target, setTarget] = useState(essay.wordTarget);
  const [typing, setTyping] = useState(false);
  const [focusMode, setFocusMode] = useState(false);
  const { state, change, flush } = useDraftSave(essay.id, essay.draftBody);

  const onChange = useCallback(
    (doc: string) => {
      setWords(countWords(doc));
      setTitle(essayTitle(doc, essay.path));
      change(doc);
    },
    [change, essay.path],
  );
  const onTyping = useCallback(() => setTyping(true), []);
  const onSaveNow = useCallback(() => void flush(), [flush]);

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
          initialDoc={essay.draftBody}
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
        <span role="status" className={cn(state.kind === 'failed' && 'text-danger')}>
          {saveLine(state)}
        </span>
      </div>
    </div>
  );

  const rail = (
    <div className={cn('hidden lg:block', quiet)}>
      <Card padding="none">
        <CardSection title="Length">
          {target !== null && (
            <Meter value={Math.min(words, target)} max={target} label={countLabel} className="mb-3" />
          )}
          <TargetForm id={essay.id} target={target} onSet={setTarget} />
        </CardSection>
      </Card>
    </div>
  );

  return <MainRail main={main} rail={rail} />;
}
