'use client';

import { ArrowRight } from 'lucide-react';
import { useFormStatus } from 'react-dom';
import { Button, buttonVariants } from '@/components/ui/button';
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
import type { HintView } from '@/lib/learn/hint';
import { FigureAnswer } from './figure-answer';
import { HowSureGiven, HowSureInput } from './how-sure';
import { HintedNote, HintLine, RetryBox, RETRY_LABEL, REVEAL_LABEL } from './hint-retry';

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
  /** A question left open with its hint up, to open where it was left (plan #2522.7). */
  resume?: { hint: HintView; howSure: HowSure };
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
  /**
   * After a first wrong answer (plan #2522.7): the hint and the first try.
   * The question stays open, with a box to try again and Show the answer.
   */
  hint?: HintView;
  /** Answered after the hint: whether it was right, and whether Show the answer recorded it. */
  afterHint?: { right: boolean; revealed?: boolean };
  /** A case's expected answer, shown once a question that had a hint is answered. */
  expected?: string;
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

function SendButton({ pending: drawnPending, retry }: { pending?: boolean; retry?: boolean }) {
  const status = useFormStatus();
  const revealing = status.pending && status.data?.get('reveal') === '1';
  const pending = drawnPending ?? (status.pending && !revealing);
  return (
    <DashAction type="submit" size="lg" pending={pending} disabled={revealing} paid={ANSWER_CELL_PAID} what="Cost of grading">
      {pending ? 'Reading your answer…' : retry ? RETRY_LABEL : 'Check my answer'}
    </DashAction>
  );
}

/**
 * Show the answer, beside Check again once a hint is up (plan #2522.7). It
 * posts `reveal`, records the first try as it was graded and costs nothing,
 * so it skips the box's own check that something is written.
 */
function RevealButton() {
  const status = useFormStatus();
  const revealing = status.pending && status.data?.get('reveal') === '1';
  return (
    <button
      type="submit"
      name="reveal"
      value="1"
      formNoValidate
      disabled={status.pending}
      className={buttonVariants({ variant: 'ghost', size: 'lg' })}
    >
      {revealing ? 'Showing…' : REVEAL_LABEL}
    </button>
  );
}

/** The row with the forward action, held above the tab bar on a phone as the deck's is. */
/**
 * Room under the item as tall as the space the forward row is held above, so
 * at the end of the scroll the row rests below the last line of the list
 * instead of over it.
 */
export const UNDER_DOCK = 'pb-[calc(var(--dock-h)+env(safe-area-inset-bottom))] lg:pb-0';

/**
 * An item at least a screen tall on a phone, so a forward row after a
 * flexible spacer rests at the foot above the tab bar on every item, however
 * short the item is (plan #2292.2). Exported for the placement's end.
 */
/**
 * Room under an item whose forward row is pinned to the foot of a phone
 * screen (plan #2546.3): the tab bar's height and the row's, so the last line
 * scrolls clear of both.
 */
export const PINNED_ROOM = 'pb-[calc(var(--dock-h)+env(safe-area-inset-bottom)+5.5rem)] lg:pb-0';

export const HOLD_FORWARD = 'flex min-h-[calc(100dvh-var(--dock-h)-env(safe-area-inset-bottom))] flex-col lg:block lg:min-h-0';

export function ForwardRow({
  children,
  endHref,
  onEnd,
  endLabel = 'End run',
  endShort,
  pinned = false,
}: {
  children: React.ReactNode;
  /**
   * Fixed to the foot of a phone screen, above the tab bar, so it sits at the
   * same height on every item however long (plan #2546.3). The item takes
   * `PINNED_ROOM` under it. From lg it follows the item, as the sticky row does.
   */
  pinned?: boolean;
  endHref?: string;
  /** End pressed in place, for a session drawn on one screen (plan #2546.3); used when there is no `endHref`. */
  onEnd?: () => void;
  endLabel?: string;
  /** A shorter label for a phone, where the long one would not fit beside the forward action. */
  endShort?: string;
}) {
  return (
    <Card
      padding="none"
      className={cn(
        'bottom-[calc(var(--dock-h)+env(safe-area-inset-bottom))] z-over-link mt-3 flex items-center justify-end gap-2 px-3 py-2 lg:static',
        pinned ? 'max-lg:fixed max-lg:inset-x-4' : 'sticky',
      )}
    >
      {endHref ? (
        <Link
          href={endHref}
          aria-label={endShort ? endLabel : undefined}
          className={cn(buttonVariants({ variant: 'ghost', size: 'lg' }), 'mr-auto')}
        >
          <EndWords label={endLabel} short={endShort} />
        </Link>
      ) : (
        onEnd && (
          <Button
            type="button"
            variant="ghost"
            size="lg"
            onClick={onEnd}
            aria-label={endShort ? endLabel : undefined}
            className="mr-auto"
            data-deck-end
          >
            <EndWords label={endLabel} short={endShort} />
          </Button>
        )
      )}
      {children}
    </Card>
  );
}

function EndWords({ label, short }: { label: string; short?: string }) {
  return short ? (
    <>
      <span className="sm:hidden">{short}</span>
      <span className="hidden sm:inline">{label}</span>
    </>
  ) : (
    label
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
  onNext,
  endHref,
  onEnd,
  endLabel,
  endShort,
  holdForward,
  pinForward,
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
  nextHref?: string;
  /** Next pressed in place, for a session drawn on one screen (plan #2546.3); used when there is no `nextHref`. */
  onNext?: () => void;
  /** Where End run goes: the run's summary. Absent outside a run. */
  endHref?: string;
  /** End pressed in place, beside `onNext`. */
  onEnd?: () => void;
  /** What the link to `endHref` says; a placement's is Skip to the lesson (plan #2292.2). */
  endLabel?: string;
  /** The same on a phone, when the full label is too long to sit beside the forward action. */
  endShort?: string;
  /** Hold the forward row at the foot of a phone screen on every item, as a placement does. */
  holdForward?: boolean;
  /** Pin the forward row to the foot of a phone screen, as a learning session does on every item (plan #2546.3). */
  pinForward?: boolean;
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
      <div data-deck-item className={pinForward ? PINNED_ROOM : cn(UNDER_DOCK, holdForward && HOLD_FORWARD)}>
        <Card padding="standard">
          {head}
          {/* Right after a hint wrote nothing on the ladder (plan #2522.7), so
            * what moved would read as a miss: the line says what it was. */}
          {state.afterHint?.right ? (
            <HintedNote correct hintsUsed={1} lead className="mt-4 font-semibold text-ink" />
          ) : (
            <>
              <p className="mt-4 text-ui font-semibold text-ink">{movedSummary(moved, asked)}</p>
              {state.afterHint && (
                <HintedNote correct={false} hintsUsed={1} revealed={state.afterHint.revealed} className="mt-1" />
              )}
            </>
          )}
          {state.expected && <p className="mt-2 text-ui text-ink">The answer it expected: {state.expected}</p>}
          {/* After a hint, what was written stands beside the answer expected:
            * the retry when it was marked, the first try when the answer was shown. */}
          {state.afterHint && state.response && (
            <p className="mt-2 text-ui text-ink-muted">You wrote: {state.response}</p>
          )}
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
        {/* After a hint, a list holding only the asked level not reached says
          * again what the line above says, so it shows only when it adds. */}
        {(asked.figure
          ? moved.reached.length > 1 || moved.doubted.length > 0
          : state.afterHint
            ? moved.reached.some((r) => !(r.asked && r.how === 'missed')) || moved.doubted.length > 0
            : moved.reached.length > 0 || moved.doubted.length > 0) && (
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
        {holdForward && !pinForward && <div className="flex-1" aria-hidden />}
        <ForwardRow endHref={endHref} onEnd={onEnd} endLabel={endLabel} endShort={endShort} pinned={pinForward}>
          {nextHref !== undefined ? (
            <Link href={nextHref} className={buttonVariants({ size: 'lg' })} data-deck-next>
              Next
              <ArrowRight className="size-4" strokeWidth={1.75} aria-hidden />
            </Link>
          ) : (
            <Button type="button" size="lg" onClick={onNext} data-deck-next>
              Next
              <ArrowRight className="size-4" strokeWidth={1.75} aria-hidden />
            </Button>
          )}
        </ForwardRow>
      </div>
    );
  }

  if (state.hint) {
    // A first miss (plan #2522.7): the hint, the first answer back in a box
    // to change, and how sure, kept from the first try.
    return (
      <form action={action} data-deck-item className={pinForward ? PINNED_ROOM : cn(UNDER_DOCK, holdForward && HOLD_FORWARD)}>
        <input type="hidden" name="questionId" value={asked.questionId} />
        <Card padding="standard">
          {head}
          <HintLine hint={state.hint.hint} />
          <RetryBox
            id={asked.questionId}
            firstAnswer={state.hint.response}
            disabled={pending}
            rows={5}
            describedBy={state.error ? `answer-error-${asked.questionId}` : undefined}
          />
          <HowSureInput id={asked.questionId} kind="written" defaultValue={state.howSure} disabled={pending} />
          {state.error && !pending && (
            <p id={`answer-error-${asked.questionId}`} role="alert" className="mt-2 text-ui text-danger">
              {state.error} Your answer is still here to send again.
            </p>
          )}
        </Card>
        {holdForward && !pinForward && <div className="flex-1" aria-hidden />}
        <ForwardRow endHref={endHref} onEnd={onEnd} endLabel={endLabel} endShort={endShort} pinned={pinForward}>
          <RevealButton />
          <SendButton pending={pending} retry />
        </ForwardRow>
      </form>
    );
  }

  return (
    <form action={action} data-deck-item className={pinForward ? PINNED_ROOM : cn(UNDER_DOCK, holdForward && HOLD_FORWARD)}>
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
          // A pick, and any question in a learning session (law 14), folds the box for how you got there.
          kind={asked.figure || pinForward ? 'choice' : 'written'}
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
      {holdForward && !pinForward && <div className="flex-1" aria-hidden />}
      <ForwardRow endHref={endHref} onEnd={onEnd} endLabel={endLabel} endShort={endShort} pinned={pinForward}>
        <SendButton pending={pending} />
      </ForwardRow>
    </form>
  );
}
