'use client';

import { useId, useState, useTransition } from 'react';
import { ArrowDown, ArrowUp, X } from 'lucide-react';
import { AddTrigger } from '@/components/ui/add-trigger';
import { Button } from '@/components/ui/button';
import { Card, CardSection } from '@/components/ui/card';
import { InlineTextarea, Textarea } from '@/components/ui/field';
import { LinkedText } from '@/components/ui/linked-text';
import { IconButton } from '@/components/ui/icon-button';
import { PaidHint } from '@/components/ui/paid-hint';
import type { EssayBrief } from '@/lib/learn/essays/model';
import {
  editedPoint,
  movedPoint,
  withPoint,
  withoutPoint,
  withThesis,
  closedReview,
  type PlanPoint,
  type Stage,
} from '@/lib/learn/essays/plan';
import { findEssayPoints, reviewEssayPlan } from './guide-actions';
import { NextStage, type PlanApi } from './essay-stages';

const FIND_ACTION = 'app/learn/e/[id]/guide-actions.ts#findEssayPoints';
const REVIEW_ACTION = 'app/learn/e/[id]/guide-actions.ts#reviewEssayPlan';

/**
 * Plan (LEARN-ESSAYS-SPEC, "The stages"): the thesis in one sentence and the
 * points that would convince the reader, all in the person's words.
 *
 * Two kinds of help, each a press. Find points reads what they have already
 * written (the brief, their replies to Dash, their takes on the research) and
 * lifts out passages that could each be a point, word for word; nothing goes
 * into the plan until they add it. Ask Dash about the plan names its biggest
 * problems, each ending in a question, and each can be closed once dealt with.
 */
export function PlanStage({
  essayId,
  brief,
  api,
  onStage,
  done,
}: {
  essayId: string;
  brief: EssayBrief;
  api: PlanApi;
  onStage: (stage: Stage) => void;
  done: boolean;
}) {
  const plan = api.plan;
  const thesisId = useId();
  const [found, setFound] = useState<string[] | null>(null);
  const [findError, setFindError] = useState<string | null>(null);
  const [finding, startFind] = useTransition();
  const [reviewing, startReview] = useTransition();
  const [clean, setClean] = useState(false);
  const [adding, setAdding] = useState(false);
  const points = plan.points;
  const openNotes = plan.review.filter((n) => n.status === 'open');

  const find = () =>
    startFind(async () => {
      setFindError(null);
      const result = await findEssayPoints(essayId).catch(() => undefined);
      if (!result || !result.ok) {
        setFindError(
          result && !result.ok ? result.error : 'The connection dropped. Try again in a moment.',
        );
        return;
      }
      setFound(result.found);
    });

  const review = () =>
    startReview(async () => {
      setClean(false);
      const result = await reviewEssayPlan(essayId).catch(() => undefined);
      if (result?.ok) setClean(Boolean(result.clean));
      await api.run(
        async () =>
          result ?? { ok: false, error: 'The connection dropped. Try again in a moment.' },
      );
    });

  const add = (text: string) => api.change({ kind: 'add', text }, (now) => withPoint(now, text));

  return (
    <div className="flex flex-col gap-4">
      <Card padding="none">
        <CardSection
          title="Your thesis"
          hint="Your answer to the question, in one sentence a reader could disagree with."
        >
          {brief.claim.trim() && (
            <div className="mb-3">
              <p className="text-small text-ink-muted">What you said in the interview</p>
              <p className="mt-0.5 line-clamp-6 whitespace-pre-line text-ui text-ink">
                <LinkedText text={brief.claim.trim()} refs={false} />
              </p>
            </div>
          )}
          <label htmlFor={thesisId} className="text-small text-ink-muted">
            In one sentence
          </label>
          <InlineTextarea
            id={thesisId}
            defaultValue={plan.thesis}
            placeholder="My answer is that…"
            onBlur={(event) => {
              const text = event.currentTarget.value;
              if (text.trim() !== plan.thesis.trim()) {
                api.change({ kind: 'thesis', text }, (now) => withThesis(now, text));
              }
            }}
            className="-mx-1 text-body text-ink"
          />
        </CardSection>
      </Card>

      <Card padding="none">
        <CardSection
          title="Your points"
          hint="The claims that, together, would bring your reader round to your thesis. Order comes next."
          action={
            <span className="flex items-center gap-1">
              <PaidHint action={FIND_ACTION} what="Cost of finding points in your writing" />
              <Button
                type="button"
                size="sm"
                variant="secondary"
                pending={finding}
                disabled={finding}
                onClick={find}
              >
                {finding ? 'Looking…' : 'Find points in what I wrote'}
              </Button>
            </span>
          }
        >
          {points.length === 0 && !adding && (
            <p className="mb-2 text-ui text-ink-muted">
              No points yet. Add one, or have Dash find passages in what you have already written.
            </p>
          )}
          {points.length > 0 && (
            <ol className="flex flex-col divide-y divide-border">
              {points.map((point, i) => (
                <PointRow
                  key={point.id}
                  point={point}
                  number={i + 1}
                  first={i === 0}
                  last={i === points.length - 1}
                  api={api}
                />
              ))}
            </ol>
          )}
          {adding ? (
            <NewPoint
              onAdd={(text) => {
                add(text);
                setAdding(false);
              }}
              onCancel={() => setAdding(false)}
            />
          ) : (
            <AddTrigger label="Add a point" onClick={() => setAdding(true)} className="mt-2" />
          )}
        </CardSection>
        {(found !== null || findError) && (
          <CardSection
            title="Found in what you wrote"
            hint="Your own words, lifted as they are. Add the ones that are a point; you can edit them after."
          >
            {findError && (
              <p role="alert" className="text-small text-danger">
                {findError}
              </p>
            )}
            {found && found.length === 0 && (
              <p className="text-ui text-ink-muted">
                Nothing new stood out as a point. Try writing your take on a part of the research
                first.
              </p>
            )}
            {found && found.length > 0 && (
              <ul className="flex flex-col divide-y divide-border">
                {found.map((quote) => {
                  const taken = points.some((p) => p.text.trim() === quote.trim());
                  return (
                    <li
                      key={quote}
                      className="flex items-start justify-between gap-3 py-2 first:pt-0 last:pb-0"
                    >
                      <p className="min-w-0 border-l-2 border-border pl-3 text-ui text-ink">
                        {quote}
                      </p>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="shrink-0"
                        disabled={taken}
                        onClick={() => add(quote)}
                      >
                        {taken ? 'Added' : 'Add'}
                      </Button>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardSection>
        )}
      </Card>

      <Card padding="none" aria-busy={reviewing || undefined}>
        <CardSection
          title="Dash on your plan"
          hint="The biggest problems with the plan as it stands, before you write it."
          action={
            <span className="flex items-center gap-1">
              <PaidHint action={REVIEW_ACTION} what="Cost of Dash reading your plan" />
              <Button
                type="button"
                size="sm"
                variant="secondary"
                pending={reviewing}
                disabled={reviewing || points.length === 0}
                onClick={review}
              >
                {reviewing ? 'Reading…' : 'Ask Dash about the plan'}
              </Button>
            </span>
          }
        >
          {openNotes.length === 0 && (
            <p className="text-ui text-ink-muted">
              {clean
                ? 'Dash found nothing that needs changing before you write.'
                : 'Dash looks for a point that does not serve your thesis, a missing step, an objection nothing answers, and points that are really two.'}
            </p>
          )}
          {openNotes.length > 0 && (
            <ul className="flex flex-col divide-y divide-border">
              {openNotes.map((note) => (
                <li
                  key={note.id}
                  className="flex items-start justify-between gap-3 py-2 first:pt-0 last:pb-0"
                >
                  <p className="min-w-0 text-ui text-ink">
                    <span className="font-medium">Dash: </span>
                    {note.body}
                  </p>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="shrink-0"
                    onClick={() =>
                      api.change({ kind: 'close-review', note: note.id }, (now) =>
                        closedReview(now, note.id),
                      )
                    }
                  >
                    Dealt with
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardSection>
      </Card>
      {api.error && (
        <p role="alert" className="text-small text-danger">
          {api.error}
        </p>
      )}

      <NextStage
        stage="plan"
        onStage={onStage}
        ready={done}
        hint="A thesis and at least two points give the next step something to arrange."
      />
    </div>
  );
}

/** One point: its words edited in place, moved up or down, or removed. */
function PointRow({
  point,
  number,
  first,
  last,
  api,
}: {
  point: PlanPoint;
  number: number;
  first: boolean;
  last: boolean;
  api: PlanApi;
}) {
  const id = useId();
  return (
    <li className="flex items-start gap-2 py-2 first:pt-0 last:pb-0">
      <span
        className="mt-1 w-5 shrink-0 text-right text-ui tabular-nums text-ink-muted"
        aria-hidden
      >
        {number}.
      </span>
      <div className="min-w-0 flex-1">
        <label htmlFor={id} className="sr-only">
          Point {number}
        </label>
        <InlineTextarea
          id={id}
          defaultValue={point.text}
          placeholder={point.guide ? `In your words: ${point.guide}` : 'The point, in your words'}
          onBlur={(event) => {
            const text = event.currentTarget.value;
            if (text.trim() !== point.text.trim()) {
              api.change({ kind: 'edit', point: point.id, text }, (now) =>
                editedPoint(now, point.id, { text }),
              );
            }
          }}
          className="-mx-1 text-ui text-ink"
        />
        {point.guide && (
          <p className="text-small text-ink-muted">
            What this part does: {lowerFirst(point.guide)}
          </p>
        )}
      </div>
      <span className="flex shrink-0 items-center">
        <IconButton
          size="sm"
          label={`Move point ${number} up`}
          disabled={first}
          onClick={() =>
            api.change({ kind: 'move', point: point.id, by: -1 }, (now) =>
              movedPoint(now, point.id, -1),
            )
          }
        >
          <ArrowUp className="size-3.5" strokeWidth={1.75} aria-hidden />
        </IconButton>
        <IconButton
          size="sm"
          label={`Move point ${number} down`}
          disabled={last}
          onClick={() =>
            api.change({ kind: 'move', point: point.id, by: 1 }, (now) =>
              movedPoint(now, point.id, 1),
            )
          }
        >
          <ArrowDown className="size-3.5" strokeWidth={1.75} aria-hidden />
        </IconButton>
        <IconButton
          size="sm"
          label={`Remove point ${number}`}
          onClick={() =>
            api.change({ kind: 'remove', point: point.id }, (now) => withoutPoint(now, point.id))
          }
        >
          <X className="size-3.5" strokeWidth={1.75} aria-hidden />
        </IconButton>
      </span>
    </li>
  );
}

export function lowerFirst(text: string): string {
  const t = text.trim();
  return t ? t[0]!.toLowerCase() + t.slice(1) : t;
}

/** The box a new point is written in, opened by Add a point. */
function NewPoint({ onAdd, onCancel }: { onAdd: (text: string) => void; onCancel: () => void }) {
  const [text, setText] = useState('');
  return (
    <form
      className="mt-3 flex flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (text.trim()) onAdd(text);
      }}
    >
      {/* ui-ok: composer-always-open -- NewPoint renders only once Add a point
       * is pressed (PlanStage's `adding`), a gate in the parent the rule
       * cannot see across. Law 14 is obeyed. */}
      <Textarea
        rows={2}
        autoFocus
        value={text}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            event.currentTarget.form?.requestSubmit();
          }
          if (event.key === 'Escape') onCancel();
        }}
        placeholder="One claim, in your own words"
        aria-label="New point"
      />
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={!text.trim()}>
          Add point
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
