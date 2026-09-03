'use client';

import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/field';
import { promoteToCanonical } from '@/app/jobs/(app)/roles/actions';

export function AnswerBank({
  questions,
}: {
  questions: Array<{
    id: string;
    text: string;
    kind: string;
    canonicalAnswer: string | null;
    timesSeen: number;
    usedIn: number;
    approvedAnswer: string | null;
  }>;
}) {
  return (
    <div className="space-y-3">
      {questions.map((question) => (
        <QuestionCard key={question.id} question={question} />
      ))}
    </div>
  );
}

function QuestionCard({
  question,
}: {
  question: {
    id: string;
    text: string;
    kind: string;
    canonicalAnswer: string | null;
    timesSeen: number;
    usedIn: number;
    approvedAnswer: string | null;
  };
}) {
  const [text, setText] = useState(question.canonicalAnswer ?? '');
  const [saved, setSaved] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const suggestion = !question.canonicalAnswer && question.approvedAnswer;

  return (
    <section className="rounded-card border border-border bg-surface p-4">
      <header className="flex flex-wrap items-baseline gap-2">
        <h2 className="min-w-0 flex-1 text-ui font-medium text-ink">{question.text}</h2>
        <span className="rounded-full bg-canvas px-1.5 py-0.5 text-micro text-ink-muted">
          {question.kind}
        </span>
        <span className="tabular text-micro text-ink-muted">
          seen {question.timesSeen}×
        </span>
      </header>

      {suggestion && (
        <p className="mt-2 rounded bg-accent-tint px-2 py-1.5 text-small text-accent">
          You approved an answer for this on one application. Make it your default so the next one
          fills itself in.
        </p>
      )}

      <Textarea
        rows={5}
        value={text || (suggestion ? question.approvedAnswer! : '')}
        onChange={(event) => setText(event.target.value)}
        className="mt-2"
        placeholder="Your reusable answer to this question."
      />

      <div className="mt-2 flex items-center gap-3">
        <Button
          type="button"
          size="sm"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const value = text || question.approvedAnswer || '';
              const result = await promoteToCanonical(question.id, value);
              setSaved(result.error ?? 'Saved as your default answer.');
            })
          }
        >
          {question.canonicalAnswer ? 'Update default' : 'Set as default'}
        </Button>
        {saved && <span className="text-small text-ink-muted">{saved}</span>}
        {question.usedIn > 0 && (
          <span className="ml-auto text-micro text-ink-muted">
            used on {question.usedIn} application{question.usedIn === 1 ? '' : 's'}
          </span>
        )}
      </div>
    </section>
  );
}
