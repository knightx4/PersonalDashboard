'use client';

import { useEffect, useId, useState, useTransition } from 'react';
import { BookmarkPlus, Check, Copy, ListPlus, Pencil, RotateCcw, ThumbsDown, ThumbsUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { IconButton } from '@/components/ui/icon-button';
import { Tooltip } from '@/components/ui/tooltip';
import { FieldError, Input } from '@/components/ui/field';
import { useOptimisticWrite } from '@/lib/use-optimistic-write';
import type { DashChange } from '@/lib/talk/changes';
import { RATING_NOTE_MAX, type AnswerRating, type RateAnswerOutcome } from '@/lib/talk/rate-answer';
import type { SaveAnswerTo } from '@/lib/talk/save-answer';

/**
 * The row of presses under each of Dash's answers (plan #1899.7): copy it,
 * ask its question again, edit the question and send it again, make a todo
 * of it, or save it to the vault. Retry and Edit add new turns at the end of
 * the chat, so a chat stays one line of turns. A todo or a note is written at
 * once and comes back as the change it made, drawn under the answer as
 * Dash's own changes are, with Undo.
 *
 * The thread hands in what the presses do; this draws them and says why one
 * did not work.
 *
 * Thumbs up and down sit after Retry and Edit (plan #2285.2). A press fills
 * the thumb at once and sends the state wanted; pressing the filled one takes
 * it back. Thumbs down opens What went wrong?, one line that can be sent or
 * skipped, and what is sent is kept with the rating. A refused write puts the
 * thumb back and says why in the line under the row.
 */

/** What a save hands back: the change it made, or why not. */
export type SaveOutcome = { ok: true; change: DashChange } | { ok: false; error: string };

/** A rating as kept on the answer: the thumb, and the words sent with a thumbs down. */
export type AnswerRated = { rating: AnswerRating | null; note: string | null };

const UNRATED: AnswerRated = { rating: null, note: null };

/** How long Copy says it copied. */
const COPIED_FOR_MS = 1600;

export function AnswerActions({
  body,
  question,
  busy,
  onRetry,
  onEdit,
  save,
  onSaved,
  rated = UNRATED,
  rate,
}: {
  /** The answer as written, which Copy puts on the clipboard. */
  body: string;
  /** The question the answer came from; Retry and Edit are left out without one. */
  question: string | null;
  /** An answer is being written, so a new question would wait: Retry and Edit are off. */
  busy: boolean;
  onRetry: (question: string) => void;
  onEdit: (question: string) => void;
  /** Writes the todo or the note; left out where the answer cannot be saved yet. */
  save?: (to: SaveAnswerTo) => Promise<SaveOutcome>;
  onSaved?: (change: DashChange) => void;
  /** The rating the answer was read with. */
  rated?: AnswerRated;
  /** Keeps a rating, or null to take it back; left out where the answer cannot be rated (plan #2285.2). */
  rate?: (rating: AnswerRating | null, note: string | null) => Promise<RateAnswerOutcome>;
}) {
  const [copied, setCopied] = useState(false);
  const [saving, setSaving] = useState<SaveAnswerTo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, startSave] = useTransition();
  // The rating as last kept. The thread holds its turns in the browser, so
  // nothing re-renders this from the server: a kept write moves it here, and
  // the optimistic thumb falls back to it once the write is done.
  const [kept, setKept] = useState<AnswerRated>(rated);
  const [asking, setAsking] = useState(false);
  const [why, setWhy] = useState('');
  const whyId = useId();
  const { shown, run } = useOptimisticWrite<AnswerRated, AnswerRated>({
    value: kept,
    apply: (_current, next) => next,
    write: async (next) => {
      const outcome = rate ? await rate(next.rating, next.note) : null;
      return outcome && !outcome.ok ? { error: outcome.error } : undefined;
    },
    onDone: setKept,
    onError: (message) => {
      setAsking(false);
      setError(message);
    },
  });

  const thumb = (pressed: AnswerRating) => {
    setError(null);
    if (shown.rating === pressed) {
      setAsking(false);
      run(UNRATED);
      return;
    }
    setAsking(pressed === 'down');
    setWhy('');
    run({ rating: pressed, note: null });
  };

  const sendWhy = () => {
    setAsking(false);
    const note = why.trim();
    if (note) run({ rating: 'down', note });
  };

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), COPIED_FOR_MS);
    return () => clearTimeout(timer);
  }, [copied]);

  const copy = () => {
    setError(null);
    navigator.clipboard?.writeText(body).then(
      () => setCopied(true),
      () => setError('It could not be copied. Select the answer and copy it instead.'),
    );
  };

  const saveTo = (to: SaveAnswerTo) => {
    if (!save) return;
    setError(null);
    setSaving(to);
    startSave(async () => {
      const outcome = await save(to).catch(
        (): SaveOutcome => ({ ok: false, error: 'That was not saved. Check your connection and try again.' }),
      );
      setSaving(null);
      if (outcome.ok) onSaved?.(outcome.change);
      else setError(outcome.error);
    });
  };

  return (
    <div className="pt-1">
      <div role="group" aria-label="Do something with this answer" className="-ml-1 flex flex-wrap items-center gap-0.5">
        <Tooltip label={copied ? 'Copied' : 'Copy'}>
          <IconButton size="sm" label={copied ? 'Copied' : 'Copy'} onClick={copy}>
            {copied ? <Check strokeWidth={1.75} aria-hidden /> : <Copy strokeWidth={1.75} aria-hidden />}
          </IconButton>
        </Tooltip>
        {question !== null && (
          <>
            <Tooltip label="Retry">
              <IconButton size="sm" label="Retry" disabled={busy} onClick={() => onRetry(question)}>
                <RotateCcw strokeWidth={1.75} aria-hidden />
              </IconButton>
            </Tooltip>
            <Tooltip label="Edit the question">
              <IconButton size="sm" label="Edit the question" disabled={busy} onClick={() => onEdit(question)}>
                <Pencil strokeWidth={1.75} aria-hidden />
              </IconButton>
            </Tooltip>
          </>
        )}
        {rate && (
          <>
            <Tooltip label={shown.rating === 'up' ? 'Take back your thumbs up' : 'Good answer'}>
              <IconButton
                size="sm"
                label="Thumbs up"
                aria-pressed={shown.rating === 'up'}
                active={shown.rating === 'up'}
                onClick={() => thumb('up')}
              >
                <ThumbsUp strokeWidth={1.75} fill={shown.rating === 'up' ? 'currentColor' : 'none'} aria-hidden />
              </IconButton>
            </Tooltip>
            <Tooltip label={shown.rating === 'down' ? 'Take back your thumbs down' : 'Bad answer'}>
              <IconButton
                size="sm"
                label="Thumbs down"
                aria-pressed={shown.rating === 'down'}
                aria-expanded={asking}
                aria-controls={asking ? whyId : undefined}
                active={shown.rating === 'down'}
                onClick={() => thumb('down')}
              >
                <ThumbsDown strokeWidth={1.75} fill={shown.rating === 'down' ? 'currentColor' : 'none'} aria-hidden />
              </IconButton>
            </Tooltip>
          </>
        )}
        {save && (
          <>
            <Tooltip label="To a todo">
              <IconButton size="sm" label="To a todo" pending={saving === 'todo'} onClick={() => saveTo('todo')}>
                <ListPlus strokeWidth={1.75} aria-hidden />
              </IconButton>
            </Tooltip>
            <Tooltip label="Save to vault">
              <IconButton size="sm" label="Save to vault" pending={saving === 'vault'} onClick={() => saveTo('vault')}>
                <BookmarkPlus strokeWidth={1.75} aria-hidden />
              </IconButton>
            </Tooltip>
          </>
        )}
        <span className="sr-only" aria-live="polite">
          {copied ? 'Copied' : ''}
        </span>
      </div>
      {asking && (
        <form
          id={whyId}
          className="mt-1 flex max-w-prose items-center gap-1.5"
          onSubmit={(event) => {
            event.preventDefault();
            sendWhy();
          }}
        >
          <Input
            autoFocus
            aria-label="What went wrong?"
            placeholder="What went wrong?"
            value={why}
            maxLength={RATING_NOTE_MAX}
            onChange={(event) => setWhy(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') setAsking(false);
            }}
            className="min-w-0 flex-1 max-sm:min-h-11"
          />
          <Button type="submit" size="sm" variant="secondary" disabled={!why.trim()}>
            Send
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setAsking(false)}>
            Skip
          </Button>
        </form>
      )}
      <FieldError>{error}</FieldError>
    </div>
  );
}
