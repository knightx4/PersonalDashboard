'use client';

import { useState, useTransition, type ReactNode } from 'react';
import { ArrowRight, Check, X } from 'lucide-react';
import Link, { linkVariants } from '@/components/ui/link';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { DashAction } from '@/components/ui/dash-action';
import { Field, Textarea } from '@/components/ui/field';
import { Deck, type DeckItem } from '@/components/patterns/deck';
import { cn } from '@/lib/cn';
import type { PieceCheck } from '@/lib/learn/lessons/piece-check';
import type { TodaysPiece } from '@/lib/learn/lessons/todays-piece-store';
import { LessonCard, useWrittenLessons } from '@/app/learn/s/[id]/p/[piece]/piece-view';
import { answerPieceCheck, askPieceCheck, type AnswerResult, type AskResult } from '@/app/learn/s/[id]/p/[piece]/actions';

/**
 * Today's piece, the deck's first entry on Now (plan #2164.4,
 * `lib/learn/lessons/todays-piece.ts`): the piece's lessons one at a time,
 * then its check, then a finished state that hands on to the cards. A right
 * answer to the check is what finishes it, so the next visit opens on the
 * next piece. Its practice task stays on the piece's own page.
 *
 * The check and the finished state keep the deck's foot row, with the
 * forward press where Next was: Ask me the question, Check my answer, then Go
 * on to cards. Cards instead, on every lesson and on the check, goes straight
 * to the cards for this visit and leaves the piece where it was.
 *
 * A goal with no pieces written yet draws a short card pointing at its
 * outline, above the cards rather than in their place.
 */

/**
 * Tall enough on a phone that the page always scrolls past the foot row, so
 * the row is held by its sticky bottom at the same height under a short item
 * (the check, a lesson being written) as under a long lesson.
 */
const ITEM_HEIGHT = 'max-lg:min-h-[calc(100dvh-var(--dock-h)-env(safe-area-inset-bottom)-5rem)]';

/** The deck's own foot row (components/patterns/deck.tsx), for the check and the finished state. */
const FOOT_ROW =
  'sticky bottom-[calc(var(--dock-h)+env(safe-area-inset-bottom))] z-over-link mt-3 flex items-center gap-2 px-3 py-2 lg:static';

export function PieceFirst({
  piece,
  children,
  lessonsPassed = 0,
  write = true,
}: {
  piece: TodaysPiece | null;
  /** The cards, drawn once the piece is finished or set aside. */
  children: ReactNode;
  /** Lessons to start with as read; the gallery draws the check with it. */
  lessonsPassed?: number;
  /** False writes no missing lesson; the gallery draws one being written with it. */
  write?: boolean;
}) {
  const [cards, setCards] = useState(false);

  if (!piece || cards) return <>{children}</>;
  if (piece.kind === 'no-pieces') {
    return (
      <>
        <Card padding="standard" className="mb-4">
          <p className="text-small font-medium text-accent">Today&rsquo;s piece</p>
          <h2 className="mt-0.5 text-body font-semibold text-ink">{piece.goalName} has no pieces yet</h2>
          <p className="mt-1 text-ui text-ink-muted">
            Its outline is split into pieces a unit or two an hour, and the first one opens here once it is
            written.
          </p>
          <Link
            href={`/learn/s/${piece.subjectId}`}
            className={cn(buttonVariants({ variant: 'secondary', size: 'sm' }), 'mt-3')}
          >
            Open the outline
          </Link>
        </Card>
        {children}
      </>
    );
  }
  return <PieceDeck piece={piece} lessonsPassed={lessonsPassed} write={write} onCards={() => setCards(true)} />;
}

function PieceDeck({
  piece,
  lessonsPassed,
  write,
  onCards,
}: {
  piece: Extract<TodaysPiece, { kind: 'piece' }>;
  lessonsPassed: number;
  write: boolean;
  onCards: () => void;
}) {
  const { page, goalName } = piece;
  const { ideas, writing } = useWrittenLessons(page.subject.id, page.piece.id, page.ideas, write);
  const pieceHref = `/learn/s/${page.subject.id}/p/${page.piece.id}`;

  const items: DeckItem[] = ideas.map((idea, index) => ({
    key: idea.conceptId,
    body: (
      <div className={ITEM_HEIGHT}>
        <LessonCard idea={idea} number={index + 1} writing={writing[idea.conceptId] ?? null} />
      </div>
    ),
    actions: (
      <Button type="button" variant="ghost" size="sm" onClick={onCards}>
        Cards instead
      </Button>
    ),
  }));

  return (
    <section aria-labelledby="todays-piece" className="mb-6">
      <p className="text-small font-medium text-accent">Today&rsquo;s piece · {goalName}</p>
      <h2 id="todays-piece" className="mt-0.5 font-display text-title tracking-tight break-words text-ink">
        <Link href={pieceHref} className="press-area hover:underline">
          {page.piece.title}
        </Link>
      </h2>
      <p className="mt-0.5 mb-3 text-ui text-ink-muted">
        Unit {page.unit.ordinal}, {page.unit.title} · {ideas.length} {ideas.length === 1 ? 'lesson' : 'lessons'},
        then one question
      </p>
      <Deck
        items={items}
        forward="Next"
        alreadyPassed={ideas.slice(0, lessonsPassed).map((idea) => idea.conceptId)}
        done={
          <PieceCheckStep
            subjectId={page.subject.id}
            pieceId={page.piece.id}
            pieceHref={pieceHref}
            initial={page.check}
            onCards={onCards}
          />
        }
      />
    </section>
  );
}

/**
 * The piece's check as the deck's last step, and the finished state once it
 * is answered right. The question is written on the press, as on the piece's
 * page, and an unanswered one already asked is shown again.
 */
function PieceCheckStep({
  subjectId,
  pieceId,
  pieceHref,
  initial,
  onCards,
}: {
  subjectId: string;
  pieceId: string;
  pieceHref: string;
  initial: PieceCheck | null;
  onCards: () => void;
}) {
  const [check, setCheck] = useState(initial);
  const [response, setResponse] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [asking, startAsking] = useTransition();
  const [marking, startMarking] = useTransition();
  const finished = check?.correct === true;
  const open = check !== null && check.correct === null;

  const ask = () =>
    startAsking(async () => {
      setError(null);
      const result: AskResult = await askPieceCheck(subjectId, pieceId).catch(() => ({
        error: 'Could not write a question. Check your connection.',
      }));
      if (result.check) {
        setCheck(result.check);
        setResponse('');
      } else setError(result.error ?? 'Could not write a question.');
    });

  const answer = () =>
    startMarking(async () => {
      if (!check) return;
      setError(null);
      const result: AnswerResult = await answerPieceCheck(subjectId, pieceId, check.id, response).catch(() => ({
        error: 'Could not mark that. Check your connection.',
      }));
      if (result.check) setCheck(result.check);
      else setError(result.error ?? 'Could not mark that.');
    });

  const forward = finished ? (
    <Button size="lg" type="button" onClick={onCards} data-deck-next>
      Go on to cards
      <ArrowRight className="size-4" strokeWidth={1.75} aria-hidden />
    </Button>
  ) : open ? (
    <DashAction
      size="lg"
      type="button"
      onClick={answer}
      pending={marking}
      disabled={response.trim() === ''}
      paid="app/learn/s/[id]/p/[piece]/actions.ts#answerPieceCheck"
      what="Cost of marking the answer"
      hintFirst
      data-deck-next
    >
      {marking ? 'Marking…' : 'Check my answer'}
    </DashAction>
  ) : (
    <DashAction
      size="lg"
      type="button"
      onClick={ask}
      pending={asking}
      paid="app/learn/s/[id]/p/[piece]/actions.ts#askPieceCheck"
      what="Cost of writing the question"
      hintFirst
      data-deck-next
    >
      {asking ? 'Writing a question…' : check ? 'Try another question' : 'Ask me the question'}
    </DashAction>
  );

  return (
    <div>
      <div className={ITEM_HEIGHT} data-deck-item>
        {finished && check ? (
          <Card padding="standard" aria-live="polite">
            <h2 className="flex items-center gap-1.5 font-display text-title tracking-tight text-ink">
              <Check className="size-5 text-accent" strokeWidth={1.75} aria-hidden />
              Today&rsquo;s piece is finished
            </h2>
            <p className="mt-1 text-body text-ink">
              Next time, Now opens on the piece after it. Its practice task is on the piece&rsquo;s page
              whenever you want it.
            </p>
            <details className="group mt-4">
              <summary className="press inline-flex cursor-pointer list-none items-center gap-1.5 rounded-control text-ui font-medium text-accent [&::-webkit-details-marker]:hidden">
                Check · Right
                <span className="text-ink-muted group-open:hidden">· show</span>
              </summary>
              <div className="mt-2 space-y-2">
                <p className="text-ui text-ink">{check.question}</p>
                {check.response && <p className="text-ui text-ink-muted">You wrote: {check.response}</p>}
                {check.why && <p className="text-ui text-ink">{check.why}</p>}
              </div>
            </details>
          </Card>
        ) : (
          <Card padding="standard">
            <h2 className="font-display text-title tracking-tight text-ink">Check</h2>
            <p className="mt-0.5 text-small text-ink-muted">One question · a right answer finishes the piece</p>
            {check && (
              <p className="mt-3 text-body text-ink" aria-live="polite">
                {check.question}
              </p>
            )}
            {open && check && (
              <Field label="Your answer" id={`now-piece-check-${check.id}`} hint="A sentence or two, from memory.">
                <Textarea
                  id={`now-piece-check-${check.id}`}
                  rows={4}
                  maxLength={2000}
                  value={response}
                  onChange={(event) => setResponse(event.target.value)}
                  disabled={marking}
                />
              </Field>
            )}
            {check && check.correct === false && (
              <div className="mt-3 space-y-2" aria-live="polite">
                {check.response && <p className="text-ui text-ink-muted">You wrote: {check.response}</p>}
                <p className="flex items-start gap-1.5 text-ui text-ink">
                  <X className="mt-0.5 size-4 shrink-0 text-ink-muted" strokeWidth={1.75} aria-hidden />
                  {check.why ?? 'Not yet.'}
                </p>
                {check.expected && <p className="text-ui text-ink-muted">Expected: {check.expected}</p>}
              </div>
            )}
            {error && (
              <p className="mt-2 text-small text-danger" role="alert">
                {error}
              </p>
            )}
          </Card>
        )}
      </div>
      <Card padding="none" className={FOOT_ROW}>
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
          {finished ? (
            <Link href={pieceHref} className={cn('press-area px-2 text-ui', linkVariants({ tone: 'quiet' }))}>
              Open the piece
            </Link>
          ) : (
            <Button type="button" variant="ghost" size="sm" onClick={onCards}>
              Cards instead
            </Button>
          )}
        </div>
        {forward}
      </Card>
    </div>
  );
}
