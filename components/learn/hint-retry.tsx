'use client';

import { DashMark } from '@/components/ui/dash-mark';
import { Label, Textarea } from '@/components/ui/field';
import { cn } from '@/lib/cn';
import { hintedLine } from '@/lib/learn/hint';

/**
 * One hint before the answer (plan #2522.7), the parts every written question
 * in Learn shares: an applied case, a cell question, a piece's check and a
 * review question.
 *
 * After a first wrong answer the question stays open. `HintLine` says it is
 * not right yet and gives the hint, set off in the same box Learn gives a
 * takeaway, and `RetryBox` holds the first answer to change and send again.
 * The host puts Check again and Show the answer where its own forward action
 * sits. Once the question is answered, `HintedNote` says a hint came first.
 * Nothing here opens over the page: no drawer, no popover.
 */

export const RETRY_LABEL = 'Check again';
export const REVEAL_LABEL = 'Show the answer';

/** The hint after a first miss. */
export function HintLine({ hint, className }: { hint: string; className?: string }) {
  return (
    <section
      aria-live="polite"
      className={cn('mt-4 rounded-control border-l-2 border-accent bg-accent-tint px-3 py-2.5', className)}
    >
      <h3 className="text-small font-semibold text-accent">Not yet. A hint before the answer</h3>
      <p className="mt-1 text-body text-ink">{hint}</p>
    </section>
  );
}

/**
 * The box to try again in, holding the first answer. Controlled when `value`
 * is given, otherwise it posts `response` with the first answer in it.
 */
export function RetryBox({
  id,
  firstAnswer,
  value,
  onChange,
  disabled,
  rows = 3,
  describedBy,
}: {
  id: string;
  firstAnswer: string;
  value?: string;
  onChange?: (value: string) => void;
  disabled?: boolean;
  rows?: number;
  describedBy?: string;
}) {
  const boxId = `retry-${id}`;
  return (
    <div className="mt-3">
      <Label htmlFor={boxId}>Try again</Label>
      {/* ui-ok: composer-always-open -- the retry is what the hint asks for;
        * the box holds the first answer to change. */}
      <Textarea
        id={boxId}
        name="response"
        rows={rows}
        maxLength={2000}
        required
        {...(value !== undefined
          ? { value, onChange: (event: React.ChangeEvent<HTMLTextAreaElement>) => onChange?.(event.target.value) }
          : { defaultValue: firstAnswer })}
        readOnly={disabled}
        aria-describedby={describedBy}
        className={cn('mt-1', disabled && 'text-ink-muted')}
      />
    </div>
  );
}

/**
 * On an answered question that had a hint: what the hint came to. Nothing
 * when none was given. `lead` puts "Right." before a right one, for a screen
 * with no verdict line of its own above it.
 */
export function HintedNote({
  correct,
  hintsUsed,
  revealed,
  lead,
  className,
}: {
  correct: boolean | null;
  hintsUsed: number | undefined;
  revealed?: boolean;
  lead?: boolean;
  className?: string;
}) {
  const line = hintedLine({ correct, hintsUsed: hintsUsed ?? 0, revealed });
  if (!line) return null;
  return <p className={cn('text-ui text-ink-muted', className)}>{lead && correct ? `Right. ${line}` : line}</p>;
}

/** The marker's sentence on an answer, with Dash's mark before it so it does not read as more of the question. */
export function DashSays({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <p className={cn('flex items-start gap-1.5 text-ui text-ink', className)}>
      <DashMark size="2xs" tone="brand" decorative className="mt-1 shrink-0" />
      <span className="min-w-0">{children}</span>
    </p>
  );
}
