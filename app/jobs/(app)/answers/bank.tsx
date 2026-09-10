'use client';

import { useState } from 'react';
import { cn } from '@/lib/cn';
import { cardVariants } from '@/components/ui/card';
import { EditableProse } from '@/components/ui/editable-prose';
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

  const suggestion = !question.canonicalAnswer && question.approvedAnswer;

  return (
    <section className={cn(cardVariants({ padding: 'dense' }))}>
      <header className="flex flex-wrap items-baseline gap-2">
        <h2 className="min-w-0 flex-1 text-ui font-medium text-ink">{question.text}</h2>
        <span className="rounded-full bg-canvas px-1.5 py-0.5 text-small text-ink-muted">
          {question.kind}
        </span>
        <span className="tabular text-small text-ink-muted">
          seen {question.timesSeen}×
        </span>
      </header>

      {suggestion && (
        <p className="mt-2 rounded bg-accent-tint px-2 py-1.5 text-small text-accent">
          You approved an answer for this on one application. Make it your default so the next one
          fills itself in.
        </p>
      )}

      {/* The answer, read. This was a five-row box standing open on every
        * question in the bank, so a page whose job is to show what you have
        * already written arrived as a column of empty editors (law 14). */}
      <EditableProse
        className="mt-2"
        label={`Your answer to: ${question.text}`}
        value={text || (suggestion ? (question.approvedAnswer ?? '') : '')}
        empty="No default answer yet."
        editLabel={question.canonicalAnswer ? 'Edit the default' : 'Write the default'}
        placeholder="Your reusable answer to this question."
        onSave={async (next) => {
          const result = await promoteToCanonical(question.id, next);
          if (result.error) return result.error;
          setText(next);
          setSaved('Saved as your default answer.');
        }}
      />

      <div className="mt-2 flex items-center gap-3">
        {saved && <span className="text-small text-ink-muted">{saved}</span>}
        {question.usedIn > 0 && (
          <span className="ml-auto text-small text-ink-muted">
            used on {question.usedIn} application{question.usedIn === 1 ? '' : 's'}
          </span>
        )}
      </div>
    </section>
  );
}
