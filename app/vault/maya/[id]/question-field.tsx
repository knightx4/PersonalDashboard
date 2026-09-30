'use client';

import { useRef, useState, useTransition } from 'react';
import { FieldError, InlineTextarea } from '@/components/ui/field';
import { renameMayaQuestion } from '../actions';

/**
 * The thread's question, set as its title and edited in place (plan #1286).
 * Maya names the question when it writes the thought; the person may say it
 * better. Saved when the field loses focus with a change in it; a blank or
 * refused question goes back to what was saved.
 */
export function QuestionField({
  threadId,
  question,
  maxLength,
}: {
  threadId: string;
  question: string;
  /** MAYA_QUESTION_MAX, passed down because thought-model.ts is server-only. */
  maxLength: number;
}) {
  const [saved, setSaved] = useState(question);
  const [draft, setDraft] = useState(question);
  const [error, setError] = useState<string | null>(null);
  const [, startSave] = useTransition();
  // Escape blurs the field to leave it, and the blur must not then save.
  const cancelled = useRef(false);

  const save = () => {
    if (cancelled.current) {
      cancelled.current = false;
      return;
    }
    const next = draft.replace(/\s+/g, ' ').trim();
    if (next === saved) {
      setDraft(saved);
      return;
    }
    if (!next) {
      setDraft(saved);
      setError('The question cannot be blank.');
      return;
    }
    setError(null);
    setSaved(next);
    setDraft(next);
    startSave(async () => {
      const result = await renameMayaQuestion(threadId, next).catch(() => ({
        error: 'The question was not saved. Check your connection.',
      }));
      if (result.error) {
        setError(result.error);
        setSaved(saved);
        setDraft(saved);
      }
    });
  };

  return (
    <div>
      <h1>
        <InlineTextarea
          aria-label="The question this thread is about"
          value={draft}
          maxLength={maxLength}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={save}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              cancelled.current = true;
              setDraft(saved);
              setError(null);
              event.currentTarget.blur();
            }
          }}
          className="-mx-1 font-display text-title tracking-tight sm:text-title"
        />
      </h1>
      <FieldError>{error}</FieldError>
    </div>
  );
}
