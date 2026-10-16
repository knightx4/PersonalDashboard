'use client';

import { useId, useState, useTransition } from 'react';
import { Card } from '@/components/ui/card';
import { Disclosure } from '@/components/ui/disclosure';
import { InlineTextarea } from '@/components/ui/field';
import { cn } from '@/lib/cn';
import { BRIEF_LABELS, PIN_LABELS } from '@/lib/learn/essays/interview';
import {
  BRIEF_FIELDS,
  type BriefField,
  type EssayBrief,
  type EssayInterview,
} from '@/lib/learn/essays/model';
import { saveEssayBriefField, type BriefResult } from './actions';

function failed(result: BriefResult | undefined): string | null {
  if (!result) return 'The connection dropped. Try again in a moment.';
  return result.ok ? null : result.error;
}

/** One answer in the brief, typed over where it is read and saved when you leave it. */
export function BriefLine({
  essayId,
  field,
  value,
  onChange,
}: {
  essayId: string;
  field: BriefField;
  value: string;
  onChange: (brief: EssayBrief, interview: EssayInterview | null) => void;
}) {
  const id = useId();
  const [error, setError] = useState<string | null>(null);
  const [saving, start] = useTransition();
  return (
    <div className="flex flex-col gap-0.5">
      <label htmlFor={id} className="text-small text-ink-muted">
        {BRIEF_LABELS[field]}
      </label>
      <InlineTextarea
        id={id}
        key={value}
        defaultValue={value}
        placeholder="Not answered"
        aria-busy={saving || undefined}
        aria-invalid={error ? true : undefined}
        onBlur={(event) => {
          const next = event.currentTarget.value;
          if (next.trim() === value.trim()) return;
          setError(null);
          start(async () => {
            const result = await saveEssayBriefField(essayId, field, next).catch(() => undefined);
            const why = failed(result);
            if (why || !result?.ok) {
              setError(why);
              return;
            }
            onChange(result.brief, result.interview);
          });
        }}
        className="-mx-1 text-ink"
      />
      {error && (
        <p role="alert" className="text-small text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * The brief, folded above the draft (spec, "Starting an essay"). The closed
 * line carries the question, so you can tell what the essay set out to
 * answer without opening it. Open, every answer is edited in place, and what
 * the essay was started from is listed under it.
 */
export function EssayBriefFold({
  essayId,
  brief,
  onChange,
  defaultOpen = false,
  className,
}: {
  essayId: string;
  brief: EssayBrief;
  onChange: (brief: EssayBrief, interview: EssayInterview | null) => void;
  defaultOpen?: boolean;
  className?: string;
}) {
  const answered = BRIEF_FIELDS.filter((field) => brief[field].trim()).length;
  const question = brief.question.trim();
  return (
    <Card padding="dense" className={cn('mb-4', className)}>
      <Disclosure
        title="Brief"
        defaultOpen={defaultOpen}
        meta={
          question ? (
            <span className="line-clamp-1">{question}</span>
          ) : (
            `${answered} of ${BRIEF_FIELDS.length} answered`
          )
        }
        summaryClassName="min-h-11 lg:min-h-0"
      >
        <div className="flex flex-col gap-3 pb-1">
          {BRIEF_FIELDS.map((field) => (
            <BriefLine
              key={field}
              essayId={essayId}
              field={field}
              value={brief[field]}
              onChange={onChange}
            />
          ))}
          {brief.pinned.length > 0 && (
            <div className="flex flex-col gap-0.5">
              <p className="text-small text-ink-muted">Started from</p>
              <ul className="text-ui text-ink">
                {brief.pinned.map((pin) => (
                  <li key={`${pin.kind}:${pin.id}`}>
                    <span className="text-ink-muted">{PIN_LABELS[pin.kind]}: </span>
                    {pin.title}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </Disclosure>
    </Card>
  );
}
