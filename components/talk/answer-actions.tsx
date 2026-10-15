'use client';

import { useEffect, useState, useTransition } from 'react';
import { BookmarkPlus, Check, Copy, ListPlus, Pencil, RotateCcw } from 'lucide-react';
import { IconButton } from '@/components/ui/icon-button';
import { Tooltip } from '@/components/ui/tooltip';
import { FieldError } from '@/components/ui/field';
import type { DashChange } from '@/lib/talk/changes';
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
 */

/** What a save hands back: the change it made, or why not. */
export type SaveOutcome = { ok: true; change: DashChange } | { ok: false; error: string };

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
}) {
  const [copied, setCopied] = useState(false);
  const [saving, setSaving] = useState<SaveAnswerTo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, startSave] = useTransition();

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
      <FieldError>{error}</FieldError>
    </div>
  );
}
