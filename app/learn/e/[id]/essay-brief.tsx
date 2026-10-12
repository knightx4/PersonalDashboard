'use client';

import { useEffect, useId, useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Disclosure } from '@/components/ui/disclosure';
import { InlineTextarea, Textarea } from '@/components/ui/field';
import { PaidHint } from '@/components/ui/paid-hint';
import { cn } from '@/lib/cn';
import { askNumber, BRIEF_LABELS, nextField, PIN_LABELS } from '@/lib/learn/essays/interview';
import { BRIEF_FIELDS, type BriefField, type EssayBrief, type EssayInterview } from '@/lib/learn/essays/model';
import { briefSearchText, originLine, STUDY_KIND_LABELS, type StudyItem } from '@/lib/learn/essays/study';
import {
  answerEssayInterview,
  findEssayStudy,
  saveEssayBriefField,
  skipEssayInterview,
  type BriefResult,
} from './actions';
import { STUDY_ACTION, type StudyState } from './essay-study';

type Asking = Extract<EssayInterview, { status: 'asking' }>;

function failed(result: BriefResult | undefined): string | null {
  if (!result) return 'The connection dropped. Try again in a moment.';
  return result.ok ? null : result.error;
}

/**
 * The interview a new essay opens with (plan #1867; spec, "Starting an
 * essay"): Dash's question, one at a time, and a box for the answer. Next
 * keeps the answer in the brief as typed and brings the next question;
 * a blank answer, or "Skip this question", moves on without one. "Skip the
 * rest" folds the interview into the brief with what was answered so far.
 */
export function EssayInterviewCard({
  essayId,
  interview,
  brief,
  onChange,
  initialFound,
}: {
  essayId: string;
  interview: Asking;
  /** The brief so far; "What made you think this?" searches your study with its question and answer. */
  brief: EssayBrief;
  onChange: (brief: EssayBrief, interview: EssayInterview | null) => void;
  /** What that search found, for the gallery, which never searches. */
  initialFound?: StudyState;
}) {
  const askId = useId();
  const errorId = useId();
  const [answer, setAnswer] = useState('');
  const origin = interview.field === 'origin';
  const found = useOriginStudy(essayId, origin ? briefSearchText(brief) : '', initialFound);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [skipping, startSkip] = useTransition();
  const last = nextField(interview.field) === null;

  const answerWith = (text: string) => {
    setError(null);
    start(async () => {
      const result = await answerEssayInterview(essayId, interview.field, text).catch(() => undefined);
      const why = failed(result);
      if (why || !result?.ok) {
        setError(why);
        return;
      }
      setAnswer('');
      onChange(result.brief, result.interview);
    });
  };

  const skipRest = () => {
    setError(null);
    startSkip(async () => {
      const result = await skipEssayInterview(essayId).catch(() => undefined);
      const why = failed(result);
      if (why || !result?.ok) {
        setError(why);
        return;
      }
      onChange(result.brief, result.interview);
    });
  };

  const busy = pending || skipping;

  return (
    <Card padding="standard" className="mb-4">
      <form
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          if (!busy) answerWith(answer);
        }}
      >
        <p className="text-small text-ink-muted tabular-nums">Before you write · {askNumber(interview.field)}</p>
        <p id={askId} className="text-body font-semibold text-ink" aria-live="polite">
          {interview.ask}
        </p>
        <Textarea
          key={interview.field}
          name="answer"
          rows={3}
          autoFocus
          value={answer}
          onChange={(event) => setAnswer(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
            }
          }}
          placeholder="In your own words"
          aria-labelledby={askId}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          disabled={busy}
        />
        {origin && (
          <OriginOffers
            state={found}
            onUse={(item) =>
              setAnswer((now) => (now.trim() ? `${now.trimEnd()}\n${originLine(item)}` : originLine(item)))
            }
          />
        )}
        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" size="sm" variant="primary" pending={pending} disabled={busy || !answer.trim()}>
            {pending ? 'Keeping it…' : last ? 'Done' : 'Next'}
          </Button>
          {!last && (
            <PaidHint action="app/learn/e/[id]/actions.ts#answerEssayInterview" what="Cost of the next question" />
          )}
          <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => answerWith('')}>
            Skip this question
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="ml-auto"
            pending={skipping}
            disabled={busy}
            onClick={skipRest}
          >
            Skip the rest
          </Button>
        </div>
        {error && (
          <p id={errorId} role="alert" className="text-small text-danger">
            {error}
          </p>
        )}
      </form>
    </Card>
  );
}

/** How many finds the fourth question offers. */
const ORIGIN_OFFERS = 3;

/**
 * For "What made you think this?" (spec, "Starting an essay", question 4):
 * one search of your study with the brief's question and answer, made once
 * when the question comes up.
 */
function useOriginStudy(essayId: string, text: string, initial?: StudyState): StudyState {
  const [answer, setAnswer] = useState<{ text: string; state: StudyState } | null>(null);
  const frozen = initial !== undefined;
  useEffect(() => {
    if (frozen || !text.trim()) return;
    let live = true;
    findEssayStudy(essayId, text)
      .catch(() => ({ ok: false as const, error: 'The connection dropped.' }))
      .then((result) => {
        if (!live) return;
        setAnswer({
          text,
          state: result.ok
            ? { kind: 'found', items: result.items, searched: result.searched, indexed: result.indexed }
            : { kind: 'failed', items: [], error: result.error },
        });
      });
    return () => {
      live = false;
    };
  }, [essayId, text, frozen]);
  if (initial) return initial;
  if (!text.trim()) return { kind: 'waiting' };
  return answer?.text === text ? answer.state : { kind: 'searching', items: [] };
}

/** What Dash found in your study, each with a button that adds it to your answer. */
function OriginOffers({ state, onUse }: { state: StudyState; onUse: (item: StudyItem) => void }) {
  if (state.kind === 'waiting') return null;
  const items = state.items.slice(0, ORIGIN_OFFERS);
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-1">
        <p className="text-small text-ink-muted">
          {state.kind === 'searching' ? 'Looking in your study…' : 'From your study'}
        </p>
        <PaidHint action={STUDY_ACTION} what="Cost of searching your study" />
      </div>
      {state.kind === 'found' && items.length === 0 && (
        <p className="text-small text-ink-muted">
          Nothing you have studied is close to your question yet. Say what made you think it in your own words.
        </p>
      )}
      {state.kind === 'failed' && <p className="text-small text-ink-muted">{state.error}</p>}
      {items.length > 0 && (
        <ul className="flex flex-col gap-2">
          {items.map((item) => (
            <li key={item.key} className="flex items-start justify-between gap-3">
              <p className="min-w-0 text-ui text-ink">
                <span className="text-ink-muted">{STUDY_KIND_LABELS[item.kind]}: </span>
                <span className="font-medium">{item.title}</span>
                {item.sentence && (
                  <span className="mt-1 block border-l-2 border-border pl-3 text-ui text-ink">{item.sentence}</span>
                )}
              </p>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="shrink-0"
                onClick={() => onUse(item)}
                aria-label={`Add ${item.title} to your answer`}
              >
                Add
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** One answer in the brief, typed over where it is read and saved when you leave it. */
function BriefLine({
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
        meta={question ? <span className="line-clamp-1">{question}</span> : `${answered} of ${BRIEF_FIELDS.length} answered`}
        summaryClassName="min-h-11 lg:min-h-0"
      >
        <div className="flex flex-col gap-3 pb-1">
          {BRIEF_FIELDS.map((field) => (
            <BriefLine key={field} essayId={essayId} field={field} value={brief[field]} onChange={onChange} />
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
