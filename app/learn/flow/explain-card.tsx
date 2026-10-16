'use client';

import { useFormStatus } from 'react-dom';
import { Check, Circle } from 'lucide-react';
import { cardVariants } from '@/components/ui/card';
import { DashAction } from '@/components/ui/dash-action';
import { Disclosure } from '@/components/ui/disclosure';
import { PaidHint } from '@/components/ui/paid-hint';
import { Field, Textarea } from '@/components/ui/field';
import Link, { linkVariants } from '@/components/ui/link';
import { LinkedText } from '@/components/ui/linked-text';
import {
  explainedHeading,
  followedUpHeading,
  type ExplainMarks,
} from '@/lib/learn/flow/explain';
import { stateLine } from '@/lib/learn/feed/teach-back';
import { AskButton, DontKnowButton, EndHereButton, NotNowButton } from './buttons';
import type { FlowState } from './state';

/**
 * An explain question in Practice Flow (plan #2164.2): a goal's idea to
 * explain in a few sentences, marked for what was right and what was
 * missing, then one follow-up, marked too. The marks come back in place, in
 * Dash's voice under what you wrote, and the line after the follow-up says
 * where the idea now stands.
 *
 * It is one item of a deck, so its presses sit in one row at the foot of the
 * card, held above the tab bar on a phone (`ForwardRow`): Mark it, I don't
 * know and Later before the answer; Mark it and Next while the follow-up is
 * open, where Next skips it; Next alone at the end. Once the follow-up is
 * marked, the explanation and its marks fold to one line, so the end of the
 * exchange and Next are on one screen.
 *
 * `grading` is for the gallery alone: it holds the marking press in its
 * pending state, which a real press shows through the form's own status.
 */
export function ExplainCard({
  live,
  step,
  fields,
  grading,
  onEnd,
}: {
  live: FlowState;
  step: (formData: FormData) => void;
  /** The flow's focus fields, carried by every form. */
  fields: React.ReactNode;
  grading?: 'explain' | 'follow-up';
  /** End here (plan #2164.6): shows what moved. Unset draws no such press. */
  onEnd?: () => void;
}) {
  const explained = live.explained;
  const followedUp = live.followedUp;
  const followUp = explained?.followUp;
  // Nothing more to answer: the follow-up is marked, or there was none.
  const finished = Boolean(explained && (followedUp || !followUp));
  const claim = followedUp?.claim ?? explained?.claim;

  const explanationMarks = explained && (
    <Marks
      heading={explainedHeading(explained)}
      marks={explained}
      extra={
        explained.dontKnow
          ? null
          : explained.ownExample
            ? 'You gave an example of your own.'
            : 'You did not give an example of your own.'
      }
    />
  );

  // The stage decides what the card's one form sends. Before the answer it
  // is the explanation (Mark it, I don't know and Later all answer or set
  // aside this question); while the follow-up is open each press names its
  // own intent; at the end it asks for the next question.
  const stage: 'explain' | 'follow-up' | 'end' = !explained
    ? 'explain'
    : followUp && !followedUp
      ? 'follow-up'
      : 'end';

  const error = live.error && (
    <p role="alert" className="mt-3 text-ui text-danger">
      {live.error}
    </p>
  );

  // The card is the form, so the row of presses at its foot can stay above
  // the tab bar for the whole height of the card (`ForwardRow`).
  return (
    <form action={step} className={cardVariants({ padding: 'standard' })}>
      {fields}
      {stage === 'explain' && <input type="hidden" name="intent" value="answer" />}
      {stage === 'end' && <input type="hidden" name="intent" value="ask" />}
      <input type="hidden" name="probeId" value={live.probeId} />
      <input type="hidden" name="conceptId" value={live.conceptId} />
      <input type="hidden" name="subjectId" value={live.subjectId} />

      {/* Where the question comes from, on one line. The idea itself is
          named in the question, so it is not named here as well. */}
      <p className="text-small text-ink-muted">
        {live.goal
          ? `${live.subjectName} · from your learning goals`
          : [live.conceptName, live.subjectName].filter(Boolean).join(' · ')}
      </p>
      <p className="mt-1 text-body text-ink">{live.question}</p>

      {!explained ? (
        <>
          <Field id={`explain-${live.probeId}`} label="Your explanation" className="mt-4">
            <Textarea
              id={`explain-${live.probeId}`}
              name="response"
              rows={5}
              defaultValue={live.explanation}
              placeholder="A few sentences, as if to a friend"
              className="min-h-28"
            />
          </Field>
          {error}
          <ForwardRow>
            <MarkButton forced={grading === 'explain'} />
            <WhileIdle forced={grading === 'explain'}>
              <DontKnowButton />
              <span className="inline-flex items-center gap-1">
                <NotNowButton />
                {/* dash-action-ok: the hint sits beside the Later close button, which does not run the model. */}
                <PaidHint action="app/learn/flow/actions.ts#flowStep:ask" what="Cost of the next question" />
              </span>
            </WhileIdle>
          </ForwardRow>
        </>
      ) : (
        <div className="mt-4 border-t border-border pt-4">
          {followedUp ? (
            // Done with: folded to the one line that says how it went.
            <Disclosure title="Your explanation" meta={foldedLine(explained)}>
              {live.explanation && <Written text={live.explanation} />}
              {explanationMarks}
            </Disclosure>
          ) : (
            <>
              {live.explanation && <Written text={live.explanation} />}
              {explanationMarks}
            </>
          )}

          {followUp && (
            <div className="mt-4 border-t border-border pt-4">
              <p className="text-ui font-semibold text-ink">One follow-up</p>
              <p className="mt-1 text-body text-ink">{followUp.question}</p>
              {!followedUp ? (
                <Field id={`follow-${followUp.probeId}`} label="Your answer" className="mt-3">
                  <Textarea
                    id={`follow-${followUp.probeId}`}
                    name="response"
                    rows={3}
                    defaultValue={live.followUpAnswer}
                    placeholder="Two or three sentences"
                  />
                </Field>
              ) : (
                <div className="mt-3">
                  {live.followUpAnswer && <Written text={live.followUpAnswer} />}
                  <Marks heading={followedUpHeading(followedUp)} marks={followedUp} />
                </div>
              )}
            </div>
          )}

          {finished && (
            <div className="mt-4" aria-live="polite">
              <p className="text-ui text-ink">
                {stateLine(live.conceptName ?? 'This idea', followedUp?.state ?? explained.state)}{' '}
                <Link href={`/learn/c/${live.conceptId}`} className={linkVariants({ tone: 'quiet' })}>
                  See it on its page
                </Link>
              </p>
              {claim && <p className="mt-1 text-ui text-ink-muted">The idea: {claim}</p>}
            </div>
          )}

          {error}
          <ForwardRow>
            {stage === 'follow-up' ? (
              <>
                {/* Told apart by the intent each sends, so they share the
                    row and its pending state. Next skips the follow-up. */}
                <MarkButton forced={grading === 'follow-up'} followUp />
                <AskButton label="Next" variant="secondary" named />
              </>
            ) : (
              <>
                <AskButton label="Next" />
                {onEnd && finished && <EndHereButton onEnd={onEnd} />}
              </>
            )}
          </ForwardRow>
        </div>
      )}
    </form>
  );
}

/**
 * The card's presses, in one row at its foot. On a phone the row stays just
 * above the tab bar while a long card is read, as the deck pattern's forward
 * row does (components/patterns/deck.tsx); from lg it sits where it falls.
 */
export function ForwardRow({ children }: { children: React.ReactNode }) {
  return (
    <div className="sticky bottom-[calc(var(--dock-h)+env(safe-area-inset-bottom))] z-over-link -mx-(--card-p) mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 bg-surface px-(--card-p) py-2 lg:static">
      {children}
    </div>
  );
}

/**
 * The other presses in the row, put away while Dash marks: nothing they do
 * can be done then, and the row stays one line.
 */
function WhileIdle({ forced, children }: { forced?: boolean; children: React.ReactNode }) {
  const { pending } = useFormStatus();
  if (forced || pending) return null;
  return <>{children}</>;
}

/** "That holds: 2 right, 1 missing", for the folded explanation. */
function foldedLine(explained: NonNullable<FlowState['explained']>): string {
  const heading = explainedHeading(explained).replace(/\.$/, '');
  if (explained.dontKnow) return heading;
  return `${heading}: ${explained.right.length} right, ${explained.missing.length} missing`;
}

/** Mark it: the press that sends what was written to be marked. */
function MarkButton({ forced, followUp }: { forced?: boolean; followUp?: boolean }) {
  const { pending: submitting } = useFormStatus();
  const pending = forced || submitting;
  return (
    <DashAction
      type="submit"
      name={followUp ? 'intent' : undefined}
      value={followUp ? 'follow-up' : undefined}
      pending={pending}
      paid={
        followUp
          ? 'app/learn/flow/actions.ts#flowStep:follow-up'
          : 'app/learn/flow/actions.ts#flowStep:answer'
      }
      what="Cost of marking the answer"
    >
      {pending ? 'Marking…' : 'Mark it'}
    </DashAction>
  );
}

/** What you wrote, in your own voice, above Dash's marks on it. */
function Written({ text }: { text: string }) {
  return (
    <div className="mb-3">
      <p className="text-small text-ink-muted">You wrote</p>
      <p className="mt-0.5 text-ui whitespace-pre-line voice-you">
        <LinkedText text={text} refs={false} />
      </p>
    </div>
  );
}

function Points({ label, points, right }: { label: string; points: string[]; right: boolean }) {
  if (points.length === 0) return null;
  const Glyph = right ? Check : Circle;
  return (
    <div className="mt-2">
      <p className="text-small text-ink-muted">{label}</p>
      <ul className="mt-0.5 space-y-0.5">
        {points.map((point) => (
          <li key={point} className="flex gap-2 text-ui">
            <Glyph
              aria-hidden
              strokeWidth={right ? 2.25 : 1.75}
              className="mt-[0.3em] size-3.5 shrink-0 text-ink-muted"
            />
            <span className="min-w-0">{point}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Dash's marks on one answer: a heading, what was right, what was missing. */
function Marks({
  heading,
  marks,
  extra,
}: {
  heading: string;
  marks: ExplainMarks;
  extra?: string | null;
}) {
  const empty = marks.right.length === 0 && marks.missing.length === 0;
  return (
    <div className="voice-dash px-3 py-2">
      <p className="text-ui font-semibold">{heading}</p>
      {empty && marks.why && <p className="mt-1 text-ui">{marks.why}</p>}
      <Points label="What you got right" points={marks.right} right />
      <Points label="What was missing" points={marks.missing} right={false} />
      {extra && <p className="mt-2 text-small text-ink-muted">{extra}</p>}
    </div>
  );
}
