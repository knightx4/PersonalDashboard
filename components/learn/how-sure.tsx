'use client';

import { useState } from 'react';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label, Textarea } from '@/components/ui/field';
import { segmentClass, segmentedFrame } from '@/components/ui/segmented';
import { cn } from '@/lib/cn';
import { HOW_SURE, NO_HOW_SURE, REASONING_MAX, howSureChoice, type HowSure } from '@/lib/learn/how-sure';

/**
 * How sure you are, and how you got there, under the answer to every question
 * in Learn (plan #2522.2): Practice, a subject's questions, a piece's check
 * and review.
 *
 * Four choices in one row, from Guessing to Certain, read left to right as a
 * scale. Choosing is optional, and pressing the chosen one again clears it.
 * The box for how you got there is open under a written answer and folded to
 * one line under a pick, where most answers need no words; the phone's own
 * dictation fills it like any other box.
 *
 * Inside a form it posts `confidence` (empty when nothing was chosen) and
 * `reasoning`, which `readHowSure` reads. Outside one, `onChange` hands the
 * same pair up on every change.
 */
export function HowSureInput({
  id,
  kind,
  defaultValue = NO_HOW_SURE,
  onChange,
  disabled,
  reasoningOpen,
  className,
}: {
  /** Unique on the page: the question's id. */
  id: string;
  /** A pick folds the reasoning box; a written answer opens it. */
  kind: 'choice' | 'written';
  defaultValue?: HowSure;
  onChange?: (value: HowSure) => void;
  disabled?: boolean;
  /** Draws a pick's box open, for the gallery. */
  reasoningOpen?: boolean;
  className?: string;
}) {
  const [confidence, setConfidence] = useState<number | null>(defaultValue.confidence);
  const [reasoning, setReasoning] = useState(defaultValue.reasoning ?? '');
  const [open, setOpen] = useState(kind === 'written' || Boolean(reasoningOpen) || Boolean(defaultValue.reasoning));

  const tell = (next: { confidence: number | null; reasoning: string }) =>
    onChange?.({ confidence: next.confidence, reasoning: next.reasoning.trim() === '' ? null : next.reasoning });

  const pick = (value: number) => {
    const next = confidence === value ? null : value;
    setConfidence(next);
    tell({ confidence: next, reasoning });
  };

  const boxId = `how-${id}`;
  return (
    <div className={cn('mt-4', className)}>
      <p id={`${boxId}-label`} className="text-small text-ink-muted">
        How sure are you?
      </p>
      <input type="hidden" name="confidence" value={confidence ?? ''} />
      <span role="group" aria-labelledby={`${boxId}-label`} className={cn(segmentedFrame, 'mt-1.5 flex w-full')}>
        {HOW_SURE.map((choice) => (
          <button
            key={choice.key}
            type="button"
            disabled={disabled}
            aria-pressed={confidence === choice.value}
            onClick={() => pick(choice.value)}
            className={cn(segmentClass(confidence === choice.value), 'min-w-0 flex-1 justify-center px-1 whitespace-nowrap')}
          >
            {choice.label}
          </button>
        ))}
      </span>

      {open ? (
        <div className="mt-3">
          <Label htmlFor={boxId}>How you got there</Label>
          <Textarea
            id={boxId}
            name="reasoning"
            rows={2}
            maxLength={REASONING_MAX}
            value={reasoning}
            onChange={(event) => {
              setReasoning(event.target.value);
              tell({ confidence, reasoning: event.target.value });
            }}
            readOnly={disabled}
            autoFocus={kind === 'choice' && !reasoningOpen && !defaultValue.reasoning}
            placeholder="Optional. What made you think so?"
            className="mt-1"
          />
        </div>
      ) : (
        <Button type="button" variant="ghost" size="sm" className="mt-2 -ml-2.5" onClick={() => setOpen(true)} disabled={disabled}>
          <Plus className="size-3.5" strokeWidth={1.75} aria-hidden />
          How you got there
        </Button>
      )}
    </div>
  );
}

/** "You were fairly sure." and so on, for the answered question. */
export function howSureLine(confidence: number | null | undefined): string | null {
  const choice = howSureChoice(confidence);
  if (!choice) return null;
  return choice.key === 'guessing'
    ? 'You were guessing.'
    : choice.key === 'unsure'
      ? 'You were unsure.'
      : choice.key === 'fairly'
        ? 'You were fairly sure.'
        : 'You were certain.';
}

/**
 * What was said with an answer, once it is answered: how sure, and how you
 * got there. Nothing when neither was given.
 */
export function HowSureGiven({ howSure, className }: { howSure: Partial<HowSure> | null | undefined; className?: string }) {
  const line = howSureLine(howSure?.confidence);
  const reasoning = howSure?.reasoning?.trim();
  if (!line && !reasoning) return null;
  return (
    <div className={cn('text-ui text-ink-muted', className)}>
      {line && <p>{line}</p>}
      {reasoning && <p className={line ? 'mt-0.5' : undefined}>How you got there: {reasoning}</p>}
    </div>
  );
}
