'use client';

import { ArrowRight } from 'lucide-react';
import { useFormStatus } from 'react-dom';
import { buttonVariants } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Disclosure } from '@/components/ui/disclosure';
import Link from '@/components/ui/link';
import { DashAction } from '@/components/ui/dash-action';
import { Textarea } from '@/components/ui/field';
import { Skeleton } from '@/components/ui/skeleton';
import { StatusGlyph } from '@/components/ui/status-glyph';
import type { StatusGlyph as GlyphName } from '@/lib/status-glyphs';
import { cn } from '@/lib/cn';
import type { Moved, ReachedCell, ReachedHow } from '@/lib/learn/levels/grade';
import type { FigureQuestionView } from '@/lib/learn/figures/question';
import type { HowSure } from '@/lib/learn/how-sure';
import { FigureAnswer } from './figure-answer';
import { HowSureGiven, HowSureInput } from './how-sure';

/**
 * An explain question about one level of a topic, and the answer screen
 * listing every level the answer reached (docs/LEARN-LEVELS-SPEC.md, "How
 * answers are graded"; plan #2138.5).
 *
 * Drawn from props alone so the gallery can show each state: the question,
 * grading under way, a grading error, and the list of what moved with a
 * quote opened. `cell-answer.tsx` wires it to the action.
 *
 * A deck item: the forward action sits in one place, in the row held above
 * the tab bar on a phone. Before an answer it sends the answer; after, it
 * goes on to the next question.
 *
 * The list is the point of the screen. Each level the answer showed carries
 * the words that showed it, a tap away, because "it took what I said to
 * heart" has to say why or it is only a claim.
 */

export type AskedCellView = {
  questionId: string;
  topicName: string;
  level: number;
  question: string;
  /**
   * A case (levels 4 to 6) is worked and typed; an explanation is written
   * out; a figure question is answered on its figure (plan #2321.5). Absent
   * means explain.
   */
  format?: 'explain' | 'case' | 'figure';
  /** The figure question, without its answer, when `format` is 'figure'. */
  figure?: FigureQuestionView;
  /** Why Practice Flow chose this level, opened on tap (plan #2138.6). */
  why?: string;
  /** Where the question sits in a placement, such as "Question 3 of up to 8" (plan #2292.2). */
  step?: string;
};

export type CellAnswerState = {
  moved: Moved | null;
  error: string | null;
  /** What was sent, kept so an error leaves the answer in the box. */
  response?: string;
  /** A figure question's answer in words, shown once it is graded. */
  answer?: string;
  /** How sure the person said they were and how they got there (plan #2522.2), kept across an error and shown once graded. */
  howSure?: HowSure;
};

/**
 * Ink and a shape for each way a level was reached (law 4): solid for shown
 * by your own words, half for implied by a level that needs it, empty for not
 * reached yet.
 */
const HOW: Record<ReachedHow, { label: string; glyph: GlyphName }> = {
  shown: { label: 'Shown', glyph: 'full' },
  implied: { label: 'Implied', glyph: 'half' },
  missed: { label: 'Not yet', glyph: 'empty' },
};

/** The paid action the answer press runs, as paid-actions.ts keys it. */
export const ANSWER_CELL_PAID = 'app/learn/flow/cell-actions.ts#answerCellQuestion';

function levelName(cell: { topicName: string; level: number }): string {
  return `${cell.topicName}, level ${cell.level}`;
}

/** One sentence over the list: how many levels it showed, and how many it settled beneath them. */
export function movedSummary(moved: Moved, asked: { topicName: string; level: number }): string {
  const shown = moved.reached.filter((r) => r.how === 'shown').length;
  const implied = moved.reached.filter((r) => r.how === 'implied').length;
  const missedAsked = moved.reached.some((r) => r.how === 'missed' && r.asked);
  if (shown === 0 && implied === 0) {
    return missedAsked
      ? `Not yet at ${levelName(asked)}. It will come round again.`
      : 'Nothing in this answer could be matched to a level word for word, so nothing was recorded.';
  }
  const levels = (n: number) => `${n} ${n === 1 ? 'level' : 'levels'}`;
  const first = `Your answer showed ${levels(shown)}`;
  const second = implied > 0 ? ` and settled ${levels(implied)} beneath ${shown === 1 ? 'it' : 'them'}` : '';
  const third = missedAsked ? `. ${levelName(asked)} is not there yet.` : '.';
  return `${first}${second}${third}`;
}

function ReachedRow({ cell, open }: { cell: ReachedCell; open?: boolean }) {
  const how = HOW[cell.how];
  const line = (
    <span className="flex min-w-0 items-start gap-3">
      <span className="mt-0.5 inline-flex w-20 shrink-0 items-center gap-1.5 text-small font-normal text-ink-muted">
        <StatusGlyph glyph={how.glyph} size={12} className="text-ink" />
        {how.label}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-ui font-medium text-ink">
          {levelName(cell)}
          {cell.asked && <span className="font-normal text-ink-muted"> · asked</span>}
        </span>
        <span className="mt-0.5 block text-small font-normal text-ink-muted">
          {cell.how === 'shown'
            ? 'Your words met it.'
            : cell.how === 'implied'
              ? cell.via
                ? `${levelName(cell.via)} needs it, so it counts as held.`
                : 'A level you showed needs it, so it counts as held.'
              : 'The answer did not reach it. It will be asked again.'}
        </span>
      </span>
    </span>
  );

  if (cell.how !== 'shown' || !cell.quote) {
    // The space the fold's chevron takes on a shown row, so the chips line up.
    return (
      <li className="flex items-start gap-2 px-4 py-3">
        <span className="size-3.5 shrink-0" aria-hidden />
        {line}
      </li>
    );
  }
  return (
    <li>
      <Disclosure
        title={line}
        defaultOpen={open}
        summaryClassName="items-start rounded-none px-4 py-3 hover:bg-sunken"
        bodyClassName="pb-3 pl-33 pr-4"
      >
        <blockquote className="border-l-2 border-positive pl-3 text-body text-ink">{cell.quote}</blockquote>
        <p className="mt-2 text-small text-ink-muted">What this level asks:</p>
        <ul className="mt-1 list-disc space-y-0.5 pl-4 text-small text-ink-muted">
          {cell.descriptor.map((check) => (
            <li key={check}>{check}</li>
          ))}
        </ul>
      </Disclosure>
    </li>
  );
}

function SendButton({ pending: drawnPending }: { pending?: boolean }) {
  const status = useFormStatus();
  const pending = drawnPending ?? status.pending;
  return (
    <DashAction type="submit" size="lg" pending={pending} paid={ANSWER_CELL_PAID} what="Cost of grading">
      {pending ? 'Reading your answer…' : 'Check my answer'}
    </DashAction>
  );
}

/** The row with the forward action, held above the tab bar on a phone as the deck's is. */
/**
 * Room under the item as tall as the space the forward row is held above, so
 * at the end of the scroll the row rests below the last line of the list
 * instead of over it.
 */
const UNDER_DOCK = 'pb-[calc(var(--dock-h)+env(safe-area-inset-bottom))] lg:pb-0';

/**
 * An item at least a screen tall on a phone, so a forward row after a
 * flexible spacer rests at the foot above the tab bar on every item, however
 * short the item is (plan #2292.2). Exported for the placement's end.
 */
export const HOLD_FORWARD = 'flex min-h-[calc(100dvh-var(--dock-h)-env(safe-area-inset-bottom))] flex-col lg:block lg:min-h-0';

function ForwardRow({
  children,
  endHref,
  endLabel = 'End run',
  endShort,
}: {
  children: React.ReactNode;
  endHref?: string;
  endLabel?: string;
  /** A shorter label for a phone, where the long one would not fit beside the forward action. */
  endShort?: string;
}) {
  return (
    <Card
      padding="none"
      className="sticky bottom-[calc(var(--dock-h)+env(safe-area-inset-bottom))] z-over-link mt-3 flex items-center justify-end gap-2 px-3 py-2 lg:static"
    >
      {endHref && (
        <Link
          href={endHref}
          aria-label={endShort ? endLabel : undefined}
          className={cn(buttonVariants({ variant: 'ghost', size: 'lg' }), 'mr-auto')}
        >
          {endShort ? (
            <>
              <span className="sm:hidden">{endShort}</span>
              <span className="hidden sm:inline">{endLabel}</span>
            </>
          ) : (
            endLabel
          )}
        </Link>
      )}
      {children}
    </Card>
  );
}

/**
 * The question while it is chosen and, for a case, written: the card's shape
 * with the forward row where it will be, so nothing moves when it lands.
 */
export function CellQuestionSkeleton() {
  return (
    <div className={UNDER_DOCK} aria-busy>
      <Card padding="standard">
        <p className="text-small text-ink-muted">Choosing your next question…</p>
        <Skeleton className="mt-2 h-4 w-full" />
        <Skeleton className="mt-2 h-4 w-3/4" />
        <Skeleton className="mt-4 h-36 w-full" />
      </Card>
      <ForwardRow>
        <Skeleton className="h-(--control-h) w-36" />
      </ForwardRow>
    </div>
  );
}

export function CellAnswerView({
  asked,
  state,
  action,
  nextHref,
  endHref,
  endLabel,
  endShort,
  holdForward,
  pending,
  openFirstQuote,
  openWhy,
  reasoningOpen,
}: {
  asked: AskedCellView;
  state: CellAnswerState;
  /** The form action; the gallery leaves it out. */
  action?: (formData: FormData) => void;
  /** Where Next goes once the answer is graded. */
  nextHref: string;
  /** Where End run goes: the run's summary. Absent outside a run. */
  endHref?: string;
  /** What the link to `endHref` says; a placement's is Skip to the lesson (plan #2292.2). */
  endLabel?: string;
  /** The same on a phone, when the full label is too long to sit beside the forward action. */
  endShort?: string;
  /** Hold the forward row at the foot of a phone screen on every item, as a placement does. */
  holdForward?: boolean;
  /** Drawn mid-grade by the gallery; the live screen reads it from the form. */
  pending?: boolean;
  /** Draws the first quote open, for the gallery. */
  openFirstQuote?: boolean;
  /** Draws the reason open, for the gallery. */
  openWhy?: boolean;
  /** Draws a pick's box for how you got there open, for the gallery. */
  reasoningOpen?: boolean;
}) {
  const head = (
    <>
      <p className="text-small text-ink-muted">
        {asked.step && <>{asked.step} · </>}
        {asked.topicName} · Level {asked.level} ·{' '}
        {asked.figure ? asked.figure.label : asked.format === 'case' ? 'Work this case' : 'Explain in your own words'}
      </p>
      {/* The heaviest text on the card: the question is what the screen is for. */}
      <p className="mt-1 text-title leading-snug text-ink">{asked.question}</p>
      {asked.why && (
        <Disclosure
          title="Why this question"
          defaultOpen={openWhy}
          className="mt-3"
          summaryClassName="text-small font-normal text-ink-muted"
          bodyClassName="pt-1 pl-5 text-small text-ink-muted"
        >
          {asked.why}
        </Disclosure>
      )}
    </>
  );

  if (state.moved) {
    const moved = state.moved;
    const firstShown = moved.reached.findIndex((r) => r.how === 'shown' && r.quote);
    // A pick posts its choice's value; it is said by its label.
    const given = asked.figure?.choices?.find((choice) => choice.value === state.response)?.label ?? state.response;
    return (
      <div data-deck-item className={cn(UNDER_DOCK, holdForward && HOLD_FORWARD)}>
        <Card padding="standard">
          {head}
          <p className="mt-4 text-ui font-semibold text-ink">{movedSummary(moved, asked)}</p>
          {state.answer && (
            <p className="mt-1 text-ui text-ink">
              The answer: {state.answer}
              {given && given !== state.answer && <span className="text-ink-muted"> · you said {given}</span>}
            </p>
          )}
          <HowSureGiven howSure={state.howSure} className="mt-2" />
          {asked.figure && <FigureAnswer questionId={asked.questionId} question={asked.figure} answered />}
        </Card>
        {/* A figure question reaches the asked level alone, and the line above
          * already says how; the list shows only when it adds to that. */}
        {(asked.figure ? moved.reached.length > 1 || moved.doubted.length > 0 : moved.reached.length > 0 || moved.doubted.length > 0) && (
          <Card padding="none" className="mt-3 overflow-hidden">
            <ul className="divide-y divide-border">
              {moved.reached.map((cell, i) => (
                <ReachedRow key={cell.cellId} cell={cell} open={openFirstQuote && i === firstShown ? true : undefined} />
              ))}
              {moved.doubted.map((link) => (
                <li key={`${levelName(link.from)}>${levelName(link.to)}`} className="px-4 py-3 text-small text-ink-muted">
                  Your answers now disagree about whether {levelName(link.from)} needs {levelName(link.to)}, so
                  that link is up for review.
                </li>
              ))}
            </ul>
          </Card>
        )}
        {holdForward && <div className="flex-1" aria-hidden />}
        <ForwardRow endHref={endHref} endLabel={endLabel} endShort={endShort}>
          <Link href={nextHref} className={buttonVariants({ size: 'lg' })} data-deck-next>
            Next
            <ArrowRight className="size-4" strokeWidth={1.75} aria-hidden />
          </Link>
        </ForwardRow>
      </div>
    );
  }

  return (
    <form action={action} data-deck-item className={cn(UNDER_DOCK, holdForward && HOLD_FORWARD)}>
      <input type="hidden" name="questionId" value={asked.questionId} />
      <Card padding="standard">
        {head}
        {asked.figure ? (
          <FigureAnswer
            questionId={asked.questionId}
            question={asked.figure}
            pending={pending}
            defaultValue={state.response}
            describedBy={state.error ? `answer-error-${asked.questionId}` : undefined}
          />
        ) : (
        <>
        <label htmlFor={`answer-${asked.questionId}`} className="sr-only">
          Your answer
        </label>
        {/* ui-ok: composer-always-open -- the question is the screen, and the
          * box is the answer to it. Nothing is listed above it. */}
        <Textarea
          id={`answer-${asked.questionId}`}
          name="response"
          defaultValue={state.response ?? ''}
          readOnly={pending}
          rows={6}
          placeholder={
            asked.format === 'case'
              ? 'Show your working and say what you chose. Finish with your answer.'
              : 'Write it as you would explain it to a colleague.'
          }
          className={cn('mt-4 max-h-none min-h-36 placeholder:text-body', pending && 'text-ink-muted')}
          aria-describedby={state.error ? `answer-error-${asked.questionId}` : undefined}
          required
        />
        </>
        )}
        {/* A pick folds the box for how you got there; a written answer opens it. */}
        <HowSureInput
          id={asked.questionId}
          kind={asked.figure ? 'choice' : 'written'}
          defaultValue={state.howSure}
          disabled={pending}
          reasoningOpen={reasoningOpen}
        />
        {state.error && !pending && (
          <p id={`answer-error-${asked.questionId}`} role="alert" className="mt-2 text-ui text-danger">
            {state.error} Your answer is still here to send again.
          </p>
        )}
      </Card>
      {holdForward && <div className="flex-1" aria-hidden />}
      <ForwardRow endHref={endHref} endLabel={endLabel} endShort={endShort}>
        <SendButton pending={pending} />
      </ForwardRow>
    </form>
  );
}
