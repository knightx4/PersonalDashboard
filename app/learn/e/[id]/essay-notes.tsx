'use client';

import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardSection } from '@/components/ui/card';
import { Select } from '@/components/ui/field';
import { LinkedText } from '@/components/ui/linked-text';
import { PaidHint } from '@/components/ui/paid-hint';
import type { MarkdownEditorHandle } from '@/components/learn/markdown-editor';
import { cn } from '@/lib/cn';
import { locateAnchor, makeAnchor } from '@/lib/learn/essays/anchor';
import {
  bodyAt,
  checkById,
  checkCalls,
  checkName,
  ESSAY_CHECKS,
  nextRung,
} from '@/lib/learn/essays/checks';
import type { NoteRange } from '@/lib/learn/essays/notes-editor';
import type { EssayNote, EssayNotes } from '@/lib/learn/essays/notes-store';
import {
  closeEssayNote,
  helpEssayNote,
  moveEssayNotes,
  rephraseEssaySelection,
  runEssayCheck,
  type NoteMove,
} from './actions';

/**
 * Margin notes on an essay (plan #1869; docs/LEARN-ESSAYS-SPEC.md, "Margin
 * notes and checks" and the ladder).
 *
 * The rail runs one named check at a time and lists the notes it raised: at
 * most three open, the rest waiting, and any whose text has gone shown as
 * detached. Each note says what its rung says. Help climbs a rung; on rung 3
 * it becomes Suggest wording, which asks Rephrase for the note's text with
 * the note's hint (rung 4). Explain shows why the check raised it. Done and
 * Dismiss close it, and a check dismissed twice stops for this essay.
 *
 * In the editor each open note is a marker in the right margin; pressing one
 * opens the note here, and the note open or hovered here has its text
 * highlighted.
 */

const RUNG_LABELS = ['Marker', 'Question', 'Hint', 'Directions', 'Suggested wording'];

/** Where each shown note sits in a text, for an editor opening on it. */
export function noteRangesIn(doc: string, notes: readonly EssayNote[]): NoteRange[] {
  return notes.flatMap((note) => {
    if (note.status === 'detached') return [];
    const at = locateAnchor(doc, note.anchor);
    return at ? [{ id: note.id, from: at.from, to: at.to, open: note.status === 'open' }] : [];
  });
}

/** The notes' state and what the rail and the editor do with it. */
export function useEssayNotes(
  essayId: string,
  initial: EssayNotes,
  editor: RefObject<MarkdownEditorHandle | null>,
  initialOpen: string | null = null,
) {
  const [notes, setNotes] = useState(initial.notes);
  const [stopped, setStopped] = useState(initial.stopped);
  const [active, setActive] = useState<string | null>(initialOpen);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState<string | null>(null);
  const [suggesting, setSuggesting] = useState<string | null>(null);
  const [ran, setRan] = useState<{ check: string; raised: number } | null>(null);

  // A note opened from the start (the gallery) has its text highlighted once the editor is there.
  const firstOpen = useRef(initialOpen);
  useEffect(() => {
    if (firstOpen.current) editor.current?.showNote(firstOpen.current);
  }, [editor]);

  /** Give the editor the notes' places: kept where it has them, found where it has not. */
  const place = useCallback(
    (next: readonly EssayNote[]) => {
      const handle = editor.current;
      if (!handle) return;
      const have = new Map(handle.notes().map((range) => [range.id, range]));
      const fresh = noteRangesIn(
        handle.doc(),
        next.filter((note) => !have.has(note.id)),
      );
      const kept = next.flatMap((note) => {
        const range = have.get(note.id);
        return range && note.status !== 'detached'
          ? [{ ...range, open: note.status === 'open' }]
          : [];
      });
      handle.setNotes([...kept, ...fresh]);
    },
    [editor],
  );

  const apply = useCallback(
    (result: EssayNotes) => {
      setNotes(result.notes);
      setStopped(result.stopped);
      place(result.notes);
    },
    [place],
  );

  const run = useCallback(
    async (checkId: string) => {
      const handle = editor.current;
      if (!handle) return;
      setError(null);
      setRan(null);
      setRunning(checkId);
      let result: Awaited<ReturnType<typeof runEssayCheck>>;
      try {
        result = await runEssayCheck(essayId, checkId, handle.doc());
      } catch {
        result = { ok: false, error: 'The connection dropped. Try again in a moment.' };
      }
      setRunning(null);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      apply(result);
      setRan({ check: checkId, raised: result.raised });
    },
    [apply, editor, essayId],
  );

  const open = useCallback(
    (id: string | null) => {
      setActive(id);
      editor.current?.showNote(id);
      if (id)
        document
          .getElementById(`essay-note-${id}`)
          ?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    },
    [editor],
  );

  const hover = useCallback(
    (id: string | null) => {
      editor.current?.showNote(id ?? active);
    },
    [active, editor],
  );

  const help = useCallback(
    async (note: EssayNote) => {
      const rung = nextRung(note.rung);
      if (rung === null) return;
      setError(null);
      setNotes((now) =>
        now.map((n) => (n.id === note.id ? { ...n, rung, body: bodyAt(n.ladder, rung) } : n)),
      );
      let result: Awaited<ReturnType<typeof helpEssayNote>>;
      try {
        result = await helpEssayNote(essayId, note.id);
      } catch {
        result = { ok: false, error: 'The connection dropped. Try again in a moment.' };
      }
      if (!result.ok) {
        setNotes((now) => now.map((n) => (n.id === note.id ? note : n)));
        setError(result.error);
        return;
      }
      apply(result);
    },
    [apply, essayId],
  );

  const close = useCallback(
    async (note: EssayNote, outcome: 'done' | 'dismissed') => {
      setError(null);
      const before = notes;
      setNotes((now) => now.filter((n) => n.id !== note.id));
      const handle = editor.current;
      handle?.setNotes(handle.notes().filter((range) => range.id !== note.id));
      if (active === note.id) open(null);
      let result: Awaited<ReturnType<typeof closeEssayNote>>;
      try {
        result = await closeEssayNote(essayId, note.id, outcome);
      } catch {
        result = { ok: false, error: 'The connection dropped. Try again in a moment.' };
      }
      if (!result.ok) {
        setNotes(before);
        place(before);
        setError(result.error);
        return;
      }
      apply(result);
    },
    [active, apply, editor, essayId, notes, open, place],
  );

  /** Rung 4: Rephrase on the note's text, with its hint, shown as a change to accept or reject. */
  const suggest = useCallback(
    async (note: EssayNote) => {
      const handle = editor.current;
      const range = handle?.notes().find((r) => r.id === note.id);
      if (!handle || !range || range.to <= range.from) {
        setError('The text this note was about has gone, so there is nothing to reword.');
        return;
      }
      setError(null);
      setSuggesting(note.id);
      const doc = handle.doc();
      let result: Awaited<ReturnType<typeof rephraseEssaySelection>>;
      try {
        result = await rephraseEssaySelection(essayId, doc, range.from, range.to, note.id);
      } catch {
        result = { ok: false, error: 'The connection dropped. Try again in a moment.' };
      }
      setSuggesting(null);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      const shown = handle.suggest(
        { from: result.from, to: result.to, text: result.text, name: result.name },
        result.original,
      );
      if (!shown) {
        setError('That text changed while Dash was rewording it. Ask again.');
        return;
      }
      setNotes((now) => now.map((n) => (n.id === note.id ? { ...n, rung: 4 } : n)));
    },
    [editor, essayId],
  );

  /**
   * After a draft save: where the open and waiting notes sit now, for the
   * ones the edits moved, so the next load finds them at their offset.
   */
  const keepPlaces = useCallback(() => {
    const handle = editor.current;
    if (!handle) return;
    const doc = handle.doc();
    const ranges = new Map(handle.notes().map((range) => [range.id, range]));
    const moves: NoteMove[] = [];
    for (const note of notes) {
      const range = ranges.get(note.id);
      if (!range || range.to <= range.from || note.status === 'detached') continue;
      const anchor = makeAnchor(doc, range.from, range.to);
      if (anchor.quote === note.anchor.quote && anchor.offset === note.anchor.offset) continue;
      moves.push({
        id: note.id,
        quote: anchor.quote,
        prefix: anchor.prefix,
        suffix: anchor.suffix,
        offset: range.from,
      });
    }
    if (moves.length === 0) return;
    const moved = new Map(moves.map((move) => [move.id, move]));
    setNotes((now) =>
      now.map((note) => {
        const move = moved.get(note.id);
        return move
          ? {
              ...note,
              anchor: {
                quote: move.quote,
                prefix: move.prefix,
                suffix: move.suffix,
                offset: move.offset,
              },
            }
          : note;
      }),
    );
    void moveEssayNotes(essayId, moves).catch(() => undefined);
  }, [editor, essayId, notes]);

  return {
    notes,
    stopped,
    active,
    error,
    running,
    suggesting,
    ran,
    run,
    open,
    hover,
    help,
    close,
    suggest,
    keepPlaces,
  };
}

export type EssayNotesApi = ReturnType<typeof useEssayNotes>;

function NoteItem({ note, api }: { note: EssayNote; api: EssayNotesApi }) {
  const [explained, setExplained] = useState(false);
  const detached = note.status === 'detached';
  const isActive = api.active === note.id;
  return (
    <li
      id={`essay-note-${note.id}`}
      onMouseEnter={() => api.hover(note.id)}
      onMouseLeave={() => api.hover(null)}
      className={cn(
        'flex flex-col gap-2 border-l-2 py-3 pl-3 first:pt-0 last:pb-0',
        isActive ? 'border-accent' : 'border-transparent',
      )}
    >
      <div className="flex items-baseline justify-between gap-2 text-small text-ink-muted">
        <span className="font-medium text-ink">{checkName(note.checkName)}</span>
        <span>{detached ? 'Detached' : RUNG_LABELS[note.rung]}</span>
      </div>
      <button
        type="button"
        onClick={() => api.open(isActive ? null : note.id)}
        disabled={detached}
        aria-pressed={detached ? undefined : isActive}
        className={cn(
          'line-clamp-2 min-h-11 text-left text-small italic text-ink-muted lg:min-h-0',
          !detached && 'hover:text-ink',
          detached && 'line-through',
        )}
      >
        “{note.anchor.quote}”
      </button>
      {detached ? (
        <p className="text-ui text-ink">The text this note was about has gone from the draft.</p>
      ) : note.rung === 0 ? (
        <p className="text-ui text-ink-muted">Dash marked this. Help says what it noticed.</p>
      ) : (
        <p className="text-ui text-ink">
          <LinkedText text={note.body} />
        </p>
      )}
      {explained && (
        <p className="border-l-2 border-border pl-3 text-small text-ink-muted">
          <LinkedText text={note.why} />
        </p>
      )}
      <div className="flex flex-wrap items-center gap-1">
        {!detached && note.rung < 3 && (
          <Button type="button" variant="secondary" size="sm" onClick={() => void api.help(note)}>
            Help
          </Button>
        )}
        {!detached && note.rung === 3 && (
          <>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              pending={api.suggesting === note.id}
              disabled={api.suggesting !== null}
              onClick={() => void api.suggest(note)}
            >
              {api.suggesting === note.id ? 'Suggesting…' : 'Suggest wording'}
            </Button>
            <PaidHint
              action="app/learn/e/[id]/actions.ts#rephraseEssaySelection"
              what="Cost of a suggested wording"
            />
          </>
        )}
        {!detached && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-expanded={explained}
            onClick={() => setExplained((on) => !on)}
          >
            Explain
          </Button>
        )}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => void api.close(note, 'done')}
        >
          {detached ? 'Clear' : 'Done'}
        </Button>
        {!detached && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => void api.close(note, 'dismissed')}
          >
            Dismiss
          </Button>
        )}
      </div>
    </li>
  );
}

function ranLine(ran: { check: string; raised: number }): string {
  const name = checkName(ran.check);
  if (ran.raised === 0) return `${name} found nothing new to raise.`;
  return ran.raised === 1 ? `${name} raised one note.` : `${name} raised ${ran.raised} notes.`;
}

/** The rail's card: run a check, and the notes it raised. */
export function EssayNotesCard({ api, paragraphs }: { api: EssayNotesApi; paragraphs: number }) {
  const [choice, setChoice] = useState<string>(ESSAY_CHECKS[0].id);
  const check = checkById(choice) ?? ESSAY_CHECKS[0];
  const stopped = api.stopped.includes(check.id);
  const open = api.notes.filter((note) => note.status === 'open');
  const waiting = api.notes.filter((note) => note.status === 'waiting').length;
  const detached = api.notes.filter((note) => note.status === 'detached');
  const calls = checkCalls(check, paragraphs);

  return (
    <Card padding="none">
      <CardSection title="Checks">
        <div className="flex items-center gap-2">
          <Select
            aria-label="Check to run"
            value={choice}
            onChange={(event) => setChoice(event.target.value)}
            className="min-h-11 min-w-0 flex-1 lg:min-h-0"
          >
            {ESSAY_CHECKS.map((item) => (
              <option key={item.id} value={item.id}>
                {api.stopped.includes(item.id) ? `${item.name} (stopped)` : item.name}
              </option>
            ))}
          </Select>
          {check.kind === 'model' && calls > 0 && (
            <PaidHint
              action={
                check.id === 'already_said'
                  ? 'app/learn/e/[id]/actions.ts#runEssayCheck:already-said'
                  : 'app/learn/e/[id]/actions.ts#runEssayCheck:model'
              }
              count={calls}
              what={`Cost of running ${check.name}`}
            />
          )}
          <Button
            type="button"
            variant="secondary"
            disabled={stopped || api.running !== null}
            pending={api.running === check.id}
            onClick={() => void api.run(check.id)}
          >
            {api.running === check.id ? 'Running…' : 'Run'}
          </Button>
        </div>
        <p className="mt-2 text-small text-ink-muted">
          {stopped
            ? `You dismissed ${check.name} twice, so it no longer runs on this essay.`
            : check.blurb}
        </p>
        {api.ran && (
          <p role="status" className="mt-2 text-small text-ink">
            {ranLine(api.ran)}
          </p>
        )}
        {api.error && (
          <p role="alert" className="mt-2 text-small text-danger">
            {api.error}
          </p>
        )}
      </CardSection>
      {/* Drawn once a check has left a note: an empty section is a 0-items section (law 1). */}
      {(open.length > 0 || detached.length > 0) && (
        <CardSection title="Notes" meta={waiting > 0 ? `${waiting} waiting` : undefined}>
          <ul className="flex flex-col divide-y divide-border">
            {open.map((note) => (
              <NoteItem key={note.id} note={note} api={api} />
            ))}
            {detached.map((note) => (
              <NoteItem key={note.id} note={note} api={api} />
            ))}
          </ul>
          {waiting > 0 && (
            <p className="mt-3 text-small text-ink-muted">
              {waiting === 1 ? 'One more note is' : `${waiting} more notes are`} waiting. Three are
              open at most; the next opens when you close one.
            </p>
          )}
        </CardSection>
      )}
    </Card>
  );
}
