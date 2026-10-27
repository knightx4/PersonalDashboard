'use client';

import { useState, useTransition } from 'react';
import { Plus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ToggleChip } from '@/components/ui/chip';
import { DashAction } from '@/components/ui/dash-action';
import { FieldError, FieldHint, Input, Label, Textarea } from '@/components/ui/field';
import { IconButton } from '@/components/ui/icon-button';
import { Tooltip } from '@/components/ui/tooltip';
import {
  CONTEXT_MAX,
  LEAN_MAX,
  OPTION_LETTERS,
  OPTION_MAX,
  OPTIONS_MAX,
  OPTIONS_MIN,
  QUESTION_MAX,
  type BoardAdvisor,
  type QuestionInput,
} from '@/lib/you/board-questions';
import { AdvisorMark } from './advisor-mark';

/**
 * Ask the board (plan #2561.4): the header's one action on the Board tab, and
 * the compose card that opens under the header when it is pressed. It took
 * the place of Call a meeting (plan #2540.5).
 *
 * The person writes the question, up to four options (or none, for the chair
 * to write), the context, which way they lean, and which advisors to hear
 * from. Save for Sunday queues it for the weekly meeting; Convene now queues
 * it and calls a meeting about it at once (askBoard in ./actions).
 */

export type AskWhen = 'now' | 'sunday';
export type AskResult = { error: string | null; queued?: boolean; questionId?: string };
export type AskActions = { ask: (input: QuestionInput, when: AskWhen) => Promise<AskResult> };

/** How the press starts: closed, or with the card open, filled, or refusing a question (the gallery draws each). */
export type AskStart = 'closed' | 'form' | 'error';

/** A question that was saved but whose meeting did not start: the row it is on shows why. */
export type AskNotice = { questionId: string; error: string };

const BLANK: QuestionInput = { question: '', options: ['', ''], context: '', lean: '', advisors: [] };

/** What the gallery draws in the open card: as long as a real question gets. */
export const SAMPLE_QUESTION: QuestionInput = {
  question:
    'Should I take the three-month contract at the analytics firm, or keep the search full time and wait for a finance role?',
  options: [
    'Take the contract and keep applying in the evenings',
    'Turn it down and keep the search full time',
    'Ask them for two days a week instead',
  ],
  context:
    'The contract pays £4,200 a month for three months. Savings cover five months at the current spend. Two finance roles are at the final round.',
  lean: 'A',
  advisors: ['cfo', 'buffett'],
};

/** The gallery's refused question: one option given, which cannot be queued. */
export const SAMPLE_REFUSED: QuestionInput = {
  ...SAMPLE_QUESTION,
  options: ['Take the contract and keep applying in the evenings', ''],
  lean: '',
};
export const SAMPLE_ERROR = 'Give at least two options, or leave them all blank for the board to write.';

export function useAskBoard({
  advisors,
  actions,
  start = 'closed',
}: {
  advisors: readonly BoardAdvisor[];
  actions: AskActions;
  start?: AskStart;
}) {
  const [open, setOpen] = useState(start !== 'closed');
  const [value, setValue] = useState<QuestionInput>(
    start === 'closed' ? BLANK : start === 'error' ? SAMPLE_REFUSED : SAMPLE_QUESTION,
  );
  const [error, setError] = useState<string | null>(start === 'error' ? SAMPLE_ERROR : null);
  const [notice, setNotice] = useState<AskNotice | null>(null);
  const [pending, setPending] = useState<AskWhen | null>(null);
  const [, startTransition] = useTransition();

  const close = () => {
    setOpen(false);
    setError(null);
  };

  const submit = (when: AskWhen) => {
    setPending(when);
    setNotice(null);
    startTransition(async () => {
      const result = await actions.ask(value, when);
      setPending(null);
      if (result.error && !result.queued) {
        setError(result.error);
        return;
      }
      // Saved. A meeting that did not start says why on the question's own row.
      setNotice(result.error && result.questionId ? { questionId: result.questionId, error: result.error } : null);
      setValue(BLANK);
      close();
    });
  };

  const button = (
    <Button
      type="button"
      variant="secondary"
      onClick={() => {
        setError(null);
        setOpen((current) => !current);
      }}
      aria-expanded={open}
      aria-controls="ask-board"
    >
      Ask the board
    </Button>
  );

  const form = open ? (
    <AskBoardForm
      value={value}
      onChange={(next) => {
        setValue(next);
        setError(null);
      }}
      advisors={advisors}
      error={error}
      pending={pending}
      onSubmit={submit}
      onCancel={close}
    />
  ) : null;

  return { button, form, notice };
}

export function AskBoardForm({
  value,
  onChange,
  advisors,
  error,
  pending,
  onSubmit,
  onCancel,
}: {
  value: QuestionInput;
  onChange: (value: QuestionInput) => void;
  advisors: readonly BoardAdvisor[];
  error: string | null;
  pending: AskWhen | null;
  onSubmit: (when: AskWhen) => void;
  onCancel: () => void;
}) {
  const [choosing, setChoosing] = useState(false);
  const blank = value.question.trim() === '';
  const busy = pending !== null;
  const set = (patch: Partial<QuestionInput>) => onChange({ ...value, ...patch });
  const setOption = (index: number, text: string) =>
    set({ options: value.options.map((o, i) => (i === index ? text : o)) });
  const removeOption = (index: number) => {
    const letter = OPTION_LETTERS[index];
    set({
      options: value.options.filter((_, i) => i !== index),
      lean: value.lean.toUpperCase() === letter ? '' : value.lean,
    });
  };
  const toggle = (key: string) =>
    set({
      advisors: value.advisors.includes(key)
        ? value.advisors.filter((k) => k !== key)
        : [...value.advisors, key],
    });
  const seats = advisors.filter((a) => a.kind === 'seat');
  const guests = advisors.filter((a) => a.kind === 'guest');
  const lettered = value.options.flatMap((o, i) => (o.trim() ? [OPTION_LETTERS[i]] : []));
  const leanLetter = /^[A-D]$/i.test(value.lean.trim()) ? value.lean.trim().toUpperCase() : '';
  const picked = value.advisors
    .map((key) => advisors.find((a) => a.key === key)?.name)
    .filter((name): name is string => Boolean(name));

  return (
    <Card id="ask-board" padding="standard">
      <form
        className="space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          if (!blank && !busy) onSubmit('sunday');
        }}
      >
        <div>
          <div className="flex items-center justify-between gap-2">
            <Label htmlFor="ask-question">The question</Label>
            <Tooltip label="Close without asking" align="end">
              <IconButton label="Close without asking" onClick={onCancel} disabled={busy}>
                <X aria-hidden strokeWidth={1.75} />
              </IconButton>
            </Tooltip>
          </div>
          {/* ui-ok: the card only renders once Ask the board is pressed (useAskBoard); the list here is its own options */}
          <Textarea
            id="ask-question"
            value={value.question}
            maxLength={QUESTION_MAX}
            placeholder="Take the Austin offer, or keep looking in Chicago?"
            rows={2}
            autoFocus
            onChange={(event) => set({ question: event.target.value })}
          />
        </div>

        <fieldset>
          <legend className="mb-1 block text-small font-medium text-ink-muted">Options</legend>
          <ol className="space-y-2">
            {value.options.map((option, index) => (
              <li key={index} className="flex items-center gap-2">
                {/* The letter is the field's label, and the label is the row's height, so the press target clears 44px. */}
                <label className="flex min-h-11 min-w-0 flex-1 items-center gap-2">
                  <span aria-hidden className="tabular w-4 shrink-0 text-small font-semibold text-ink-muted">
                    {OPTION_LETTERS[index]}
                  </span>
                  {/* ui-ok: one option per field; it wraps so a long option reads whole on a phone */}
                  <Textarea
                    aria-label={`Option ${OPTION_LETTERS[index]}`}
                    value={option}
                    maxLength={OPTION_MAX}
                    rows={1}
                    className="min-h-0 resize-none"
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') event.preventDefault();
                    }}
                    onChange={(event) => setOption(index, event.target.value.replace(/\n/g, ' '))}
                  />
                </label>
                {index >= OPTIONS_MIN && (
                  <Tooltip label="Remove this option" align="end">
                    <IconButton label={`Remove option ${OPTION_LETTERS[index]}`} onClick={() => removeOption(index)}>
                      <X aria-hidden strokeWidth={1.75} />
                    </IconButton>
                  </Tooltip>
                )}
              </li>
            ))}
          </ol>
          <div className="mt-1 flex items-center justify-between gap-3 pl-6">
            <FieldHint>Blank, and the chair writes them.</FieldHint>
            {value.options.length < OPTIONS_MAX && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => set({ options: [...value.options, ''] })}
              >
                <Plus aria-hidden strokeWidth={1.75} />
                Add an option
              </Button>
            )}
          </div>
        </fieldset>

        <div>
          <Label htmlFor="ask-context">Context</Label>
          {/* ui-ok: the card only renders once Ask the board is pressed (useAskBoard); the list here is its own options */}
          <Textarea
            id="ask-context"
            value={value.context}
            maxLength={CONTEXT_MAX}
            rows={2}
            placeholder="The numbers, the limits, and what a good outcome looks like."
            onChange={(event) => set({ context: event.target.value })}
          />
        </div>

        {lettered.length > 0 ? (
          <fieldset>
            <legend className="mb-1 block text-small font-medium text-ink-muted">Which way you lean</legend>
            <div className="flex flex-wrap gap-2">
              <ToggleChip on={leanLetter === ''} onClick={() => set({ lean: '' })}>
                No lean
              </ToggleChip>
              {lettered.map((letter) => (
                <ToggleChip
                  key={letter}
                  on={leanLetter === letter}
                  aria-label={`Lean towards option ${letter}`}
                  onClick={() => set({ lean: letter })}
                >
                  {letter}
                </ToggleChip>
              ))}
            </div>
            <FieldHint>The board tests your lean rather than agreeing with it.</FieldHint>
          </fieldset>
        ) : (
          <div>
            <Label htmlFor="ask-lean">Which way you lean</Label>
            <Input
              id="ask-lean"
              value={value.lean}
              maxLength={LEAN_MAX}
              placeholder="A few words, or nothing"
              aria-describedby="ask-lean-hint"
              onChange={(event) => set({ lean: event.target.value })}
            />
            <FieldHint id="ask-lean-hint">The board tests your lean rather than agreeing with it.</FieldHint>
          </div>
        )}

        {advisors.length > 0 && (
          <fieldset>
            <legend className="sr-only">Advisors to hear from</legend>
            <div className="flex items-center justify-between gap-3">
              <p className="min-w-0 text-ui text-ink">
                <span className="text-small font-medium text-ink-muted">Advisors </span>
                {picked.length > 0 ? picked.join(', ') : 'the board chooses, the five seats and guests where they fit'}
              </p>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-expanded={choosing}
                aria-controls="ask-advisors"
                onClick={() => setChoosing((current) => !current)}
              >
                {choosing ? 'Done' : 'Choose'}
              </Button>
            </div>
            {choosing && (
              <div id="ask-advisors" className="mt-2 space-y-3">
                <div className="flex flex-wrap gap-2">
                  {seats.map((a) => (
                    <ToggleChip key={a.key} on={value.advisors.includes(a.key)} onClick={() => toggle(a.key)}>
                      {a.name}
                    </ToggleChip>
                  ))}
                </div>
                {guests.length > 0 && (
                  <div>
                    <p className="mb-1 text-small text-ink-muted">
                      Guest personas, built by Dash from each one’s public work
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {guests.map((a) => (
                        <ToggleChip
                          key={a.key}
                          on={value.advisors.includes(a.key)}
                          onClick={() => toggle(a.key)}
                        >
                          <AdvisorMark name={a.name} />
                          {a.name}
                        </ToggleChip>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </fieldset>
        )}

        <FieldError id="ask-error">{error}</FieldError>

        <div className="flex flex-wrap items-center gap-2">
          <DashAction
            type="button"
            pending={pending === 'now'}
            disabled={blank || busy}
            routine="board"
            what="Cost of convening the board"
            align="start"
            onClick={() => onSubmit('now')}
          >
            {pending === 'now' ? 'Convening…' : 'Convene now'}
          </DashAction>
          <Button type="submit" variant="secondary" pending={pending === 'sunday'} disabled={blank || busy}>
            {pending === 'sunday' ? 'Saving…' : 'Save for Sunday'}
          </Button>
        </div>
      </form>
    </Card>
  );
}
