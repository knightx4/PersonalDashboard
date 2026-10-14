'use client';

import { useState } from 'react';
import Link from '@/components/ui/link';
import { cn } from '@/lib/cn';
import { Card } from '@/components/ui/card';
import { Chip, toggleChipClass } from '@/components/ui/chip';
import { Button } from '@/components/ui/button';
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
    <Card padding="none">
      <ul className="divide-y divide-border">
        {questions.map((question) => (
          <QuestionCard key={question.id} question={question} />
        ))}
      </ul>
    </Card>
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

  const suggestion = !text && question.approvedAnswer;

  return (
    <li className="card-pad-x row-pad">
      {/* The kind and the count sit beside the question from sm up, and on
       * the bottom line on a phone, where beside it they took a third of the
       * width and wrapped a short question onto two lines (law 9). */}
      <header className="flex items-baseline gap-2">
        <h2 className="min-w-0 flex-1 text-ui font-medium text-ink">{question.text}</h2>
        <QuestionMeta question={question} className="hidden sm:flex" />
      </header>

      {/* The answer, read. This was a five-row box standing open on every
       * question in the bank, so a page whose job is to show what you have
       * already written arrived as a column of empty editors (law 14). */}
      <EditableProse
        className="mt-2"
        label={`Your answer to: ${question.text}`}
        value={text}
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

      {suggestion && (
        <div className="mt-2 border-l-2 border-border pl-3">
          <p className="text-small text-ink-muted">
            You approved this on one application: {suggestion}
          </p>
          <Button
            variant="secondary"
            size="sm"
            className="mt-1.5"
            onClick={async () => {
              const result = await promoteToCanonical(question.id, suggestion);
              if (result.error) {
                setSaved(result.error);
                return;
              }
              setText(suggestion);
              setSaved('Saved as your default answer.');
            }}
          >
            Make default
          </Button>
        </div>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-3">
        <QuestionMeta question={question} className="flex sm:hidden" />
        {saved && <span className="text-small text-ink-muted">{saved}</span>}
        {question.usedIn > 0 && !suggestion && (
          <span className="ml-auto text-small text-ink-muted">
            used on {question.usedIn} application{question.usedIn === 1 ? '' : 's'}
          </span>
        )}
      </div>
    </li>
  );
}

/** The question's kind and how often it has come up. */
function QuestionMeta({
  question,
  className,
}: {
  question: { kind: string; timesSeen: number };
  className?: string;
}) {
  return (
    <span className={cn('shrink-0 items-baseline gap-2', className)}>
      <Chip>{question.kind}</Chip>
      <span className="tabular text-small text-ink-muted">seen {question.timesSeen}×</span>
    </span>
  );
}

/**
 * The kinds the list is narrowed by, on one line above it at every width. Each
 * is a link, so the filter is in the address.
 */
export function KindChips({
  items,
}: {
  items: Array<{ label: string; href: string; count: number; active: boolean }>;
}) {
  return (
    <nav aria-label="Kind" className="-mx-4 flex gap-1.5 overflow-x-auto px-4 sm:mx-0 sm:px-0">
      {items.map((item) => (
        <Link
          key={item.label}
          href={item.href}
          aria-current={item.active ? 'page' : undefined}
          className={toggleChipClass(item.active)}
        >
          {item.label}
          <span className="tabular">{item.count}</span>
        </Link>
      ))}
    </nav>
  );
}
