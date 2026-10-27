'use client';

import { useId, useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { FieldError, Label, Textarea } from '@/components/ui/field';
import { SectionHeading } from '@/components/ui/section-heading';
import { cn } from '@/lib/cn';
import type { BoardVerdict, DebateAdvisor, DebateQuestion, QuestionDecision } from '@/lib/you/board-debate';
import {
  DECISION_NOTE_MAX,
  optionLabel,
  type BoardOption,
  type DecisionChoice,
} from '@/lib/you/board-questions';
import { Prose } from './prose';

/**
 * The verdict and the person's decision under one question's debate (plan
 * #2561.6). The verdict is the chair's: the option it recommends with the
 * conditions, the dissent, and what would change it. The decision is the
 * person's: an option (the recommended one or another), putting the question
 * off, or turning it down, with an optional note. It saves as it is pressed
 * and the next meeting reads it first (.claude/skills/board/SKILL.md).
 */

export type DecideAction = (
  id: string,
  choice: DecisionChoice,
  note?: string | null,
) => Promise<{ error: string | null }>;

/** The chair's verdict on one question. */
export function VerdictCard({
  verdict,
  options,
  advisors,
}: {
  verdict: BoardVerdict;
  options: readonly BoardOption[];
  advisors: readonly DebateAdvisor[];
}) {
  const recommended = optionLabel(options, verdict.recommended);
  const nameOf = (key: string) => advisors.find((a) => a.key === key)?.name ?? key;
  return (
    <Card padding="standard" className="space-y-3" data-board-verdict>
      <p className="text-body font-semibold text-ink [overflow-wrap:anywhere]">
        {recommended ? `The board recommends ${recommended}` : 'The board did not settle on one option'}
      </p>
      {verdict.conditions.length > 0 && (
        <VerdictList title="On these conditions" items={verdict.conditions} />
      )}
      {verdict.dissent.length > 0 && (
        <div className="space-y-1">
          <p className="text-small font-medium text-ink-muted">Dissent</p>
          <ul className="space-y-1.5">
            {verdict.dissent.map((d) => (
              <li key={d.advisor} className="text-body text-ink [overflow-wrap:anywhere]">
                <span className="font-medium">{nameOf(d.advisor)}</span>: {d.text}
              </li>
            ))}
          </ul>
        </div>
      )}
      {verdict.wouldChange.length > 0 && (
        <VerdictList title="What would change it" items={verdict.wouldChange} />
      )}
    </Card>
  );
}

function VerdictList({ title, items }: { title: string; items: readonly string[] }) {
  return (
    <div className="space-y-1">
      <p className="text-small font-medium text-ink-muted">{title}</p>
      <ul className="list-disc space-y-1 pl-5 marker:text-ink-muted">
        {items.map((item) => (
          <li key={item} className="text-body text-ink [overflow-wrap:anywhere]">
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** What the person did, in a line. */
export function decisionLine(decision: QuestionDecision, options: readonly BoardOption[]): string {
  if (decision.kind === 'option') return `You decided ${optionLabel(options, decision.option)}`;
  return decision.kind === 'defer' ? 'You put this off' : 'You turned this question down';
}

/**
 * Their decision on one question: what they chose with the board's
 * recommendation beside it, or the form to choose. A decided question can be
 * changed.
 */
export function DecisionCard({
  question,
  decide,
  editing: startEditing = false,
  error: startError = null,
}: {
  question: DebateQuestion;
  decide: DecideAction;
  /** For the gallery: draw the form open. */
  editing?: boolean;
  /** For the gallery: draw the form with this error showing. */
  error?: string | null;
}) {
  const [decision, setDecision] = useState<QuestionDecision | null>(question.decision);
  const [editing, setEditing] = useState(startEditing || question.decision === null);
  // A save that failed keeps the choice it was saving. The gallery draws that
  // state from nothing, so it stands the board's recommendation in for it.
  const [picked, setPicked] = useState<string | null>(
    question.decision?.option ?? (startError ? (question.verdict?.recommended ?? null) : null),
  );
  const [note, setNote] = useState(question.decision?.note ?? '');
  const [noteOpen, setNoteOpen] = useState(Boolean(question.decision?.note));
  const [error, setError] = useState<string | null>(startError);
  const [pending, startTransition] = useTransition();
  const [saving, setSaving] = useState<DecisionChoice['kind'] | null>(null);
  const legendId = useId();
  const noteId = useId();
  const errorId = useId();
  const recommended = question.verdict?.recommended ?? null;

  function save(choice: DecisionChoice) {
    setError(null);
    setSaving(choice.kind);
    startTransition(async () => {
      const result = await decide(question.id, choice, note.trim() || null);
      setSaving(null);
      if (result.error) {
        setError(result.error);
        return;
      }
      setDecision({
        kind: choice.kind,
        option: choice.kind === 'option' ? choice.letter : null,
        note: note.trim() || null,
        decidedAt: null,
      });
      setEditing(false);
    });
  }

  if (decision && !editing) {
    return (
      <Card padding="standard" className="space-y-2" data-board-decision>
        <p className="text-body font-semibold text-ink [overflow-wrap:anywhere]">
          {decisionLine(decision, question.options)}
        </p>
        {decision.kind === 'option' && recommended && (
          <p className="text-ui text-ink-muted">
            {decision.option === recommended
              ? 'The board recommended it.'
              : `The board recommended ${optionLabel(question.options, recommended)}.`}
          </p>
        )}
        {decision.note && <Prose markdown={decision.note} />}
        <Button type="button" variant="secondary" size="sm" onClick={() => setEditing(true)}>
          Change your decision
        </Button>
      </Card>
    );
  }

  const busy = pending;
  return (
    <Card padding="standard" className="space-y-3" data-board-decide>
      <fieldset className="space-y-1" disabled={busy}>
        <legend id={legendId} className="mb-1 text-small font-medium text-ink-muted">
          Your decision
        </legend>
        {question.options.map((option) => (
          <label
            key={option.letter}
            className={cn(
              'press-area flex min-h-11 cursor-pointer items-start gap-2.5 rounded-control px-2 py-2 transition-colors duration-quick',
              picked === option.letter ? 'bg-accent-tint' : 'hover:bg-sunken',
            )}
          >
            <input
              type="radio"
              name={`decision-${question.id}`}
              value={option.letter}
              checked={picked === option.letter}
              onChange={() => setPicked(option.letter)}
              aria-describedby={legendId}
              className="mt-1 size-4 shrink-0 accent-accent"
            />
            <span className="min-w-0 text-body text-ink [overflow-wrap:anywhere]">
              <span className="tabular font-semibold">{option.letter}</span> {option.text}
              {recommended === option.letter && (
                <span className="ml-1.5 text-small font-medium text-ink-muted">Recommended</span>
              )}
            </span>
          </label>
        ))}
      </fieldset>

      {noteOpen ? (
        <div className="space-y-1">
          <Label htmlFor={noteId}>Note for the next meeting (optional)</Label>
          <Textarea
            id={noteId}
            value={note}
            maxLength={DECISION_NOTE_MAX}
            rows={2}
            autoFocus={!note}
            disabled={busy}
            placeholder="Why, or what you will do first"
            aria-describedby={error ? errorId : undefined}
            onChange={(event) => setNote(event.target.value)}
          />
        </div>
      ) : (
        <Button type="button" variant="link" disabled={busy} onClick={() => setNoteOpen(true)}>
          Add a note for the next meeting
        </Button>
      )}

      <FieldError id={errorId}>{error}</FieldError>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          pending={saving === 'option'}
          disabled={picked === null || busy}
          onClick={() => picked && save({ kind: 'option', letter: picked })}
        >
          {saving === 'option' ? 'Saving…' : picked ? `Decide ${picked}` : 'Decide'}
        </Button>
        <Button
          type="button"
          variant="secondary"
          pending={saving === 'defer'}
          disabled={busy}
          onClick={() => save({ kind: 'defer' })}
        >
          {saving === 'defer' ? 'Saving…' : 'Put off'}
        </Button>
        <Button
          type="button"
          variant="secondary"
          pending={saving === 'reject'}
          disabled={busy}
          onClick={() => save({ kind: 'reject' })}
        >
          {saving === 'reject' ? 'Saving…' : 'Turn down'}
        </Button>
        {decision && (
          <Button type="button" variant="ghost" disabled={busy} onClick={() => setEditing(false)}>
            Cancel
          </Button>
        )}
      </div>
    </Card>
  );
}

/** The verdict and the decision under it, as QuestionDebate draws them after the rounds. */
export function VerdictAndDecision({
  question,
  advisors,
  decide,
  editing,
  error,
}: {
  question: DebateQuestion;
  advisors: readonly DebateAdvisor[];
  decide: DecideAction;
  editing?: boolean;
  error?: string | null;
}) {
  return (
    <div className="space-y-2">
      <SectionHeading as="h3" title="The verdict" />
      {question.verdict && (
        <VerdictCard verdict={question.verdict} options={question.options} advisors={advisors} />
      )}
      <DecisionCard question={question} decide={decide} editing={editing} error={error} />
    </div>
  );
}
