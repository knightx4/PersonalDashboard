'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowRight, BookOpen, CircleAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { DeckSwipe } from '@/components/patterns/deck';
import { CellAnswer } from '@/components/learn/cell-answer';
import { ForwardRow, PINNED_ROOM, UNDER_DOCK } from '@/components/learn/cell-answer-view';
import { RunSummaryView, runHeadline } from '@/components/learn/run-summary-view';
import { LessonCard, PieceCheckCard, PracticeCard } from '@/app/learn/s/[id]/p/[piece]/piece-view';
import { ReviewRow } from '@/app/learn/review/review-list';
import type { RunSummary } from '@/lib/learn/levels/run';
import {
  addToTally,
  KIND_WORD,
  tallyKind,
  tallyLine,
  tallyTotal,
  type SessionItem,
  type SessionStep,
  type SessionTally,
} from '@/lib/learn/next/session';
import {
  endSession,
  markSessionLessonRead,
  markSessionLevelLessonRead,
  nextSessionItem,
  type SessionEndResult,
} from './actions';

/**
 * A learning session (plan #2546.3): one thing to learn on the screen at a
 * time, each the one the chooser picks (lib/learn/next/choose.ts), and Next
 * goes on to the one after without leaving the page.
 *
 * A deck (components/patterns/deck.tsx): the forward row is in one place on
 * every item, held above the tab bar on a phone, and the item after this one
 * is asked for and written as this one shows, so Next shows it at once. A
 * swipe to the left does what Next does. Stop ends the session and shows
 * what moved on the topic ladders, as a Practice run's end does.
 *
 * Each item is drawn by the screen it has elsewhere, so it is marked the same
 * way: a lesson by the piece page's lesson card, its check and its practice
 * by the piece page's cards, a review by the review list's row, and a level
 * question by Practice's answer screen.
 */

/** Where the session gets its items, so the gallery can draw it without a server. */
export type SessionSource = {
  next: (skip: string[]) => Promise<SessionStep>;
  /** Told as each item shows; a lesson then counts as read. */
  shown: (item: SessionItem) => void;
  end: (startedAt: string) => Promise<SessionEndResult>;
};

const SERVER: SessionSource = {
  next: (skip) =>
    nextSessionItem(skip).catch(() => ({ ok: false as const, error: 'Could not reach the server. Check your connection.' })),
  shown: (item) => {
    if (item.kind === 'lesson') void markSessionLessonRead(item.idea.conceptId).catch(() => undefined);
    if (item.kind === 'level_lesson') void markSessionLevelLessonRead(item.lesson.id).catch(() => undefined);
  },
  end: (startedAt) =>
    endSession(startedAt).catch(() => ({ error: 'Could not reach the server. Check your connection.' })),
};

type Slot = { state: 'loading' } | { state: 'ready'; step: SessionStep };

export function LearnSession({
  startedAt,
  first,
  source = SERVER,
  ended: endedAtFirst,
}: {
  /** When the session began: what Stop sums up from. */
  startedAt: string;
  /** The first item, already in hand; without it the session asks for one as it opens. */
  first?: SessionStep;
  source?: SessionSource;
  /** Drawn ended, with this summary, for the gallery. */
  ended?: { tally: SessionTally; summary: SessionEndResult | null; nothingLeft?: boolean };
}) {
  const [current, setCurrent] = useState<Slot>(first ? { state: 'ready', step: first } : { state: 'loading' });
  const [ahead, setAhead] = useState<SessionStep | null>(null);
  const [tally, setTally] = useState<SessionTally>(endedAtFirst?.tally ?? {});
  const [ended, setEnded] = useState<{ nothingLeft: boolean } | null>(
    endedAtFirst ? { nothingLeft: endedAtFirst.nothingLeft ?? false } : null,
  );
  // Every key shown, so the chooser moves on rather than handing one back.
  const shown = useRef<string[]>([]);
  // The ask for the item after the one on screen, keyed by that item.
  const asking = useRef<{ after: string; step: Promise<SessionStep> } | null>(null);
  // The item whose answer is marked, so its forward press reads Next rather than Skip.
  const [answeredKey, setAnsweredKey] = useState<string | null>(null);

  // The first item, asked for as the session opens.
  useEffect(() => {
    if (first) return;
    let live = true;
    void source.next([]).then((step) => {
      if (live) setCurrent({ state: 'ready', step });
    });
    return () => {
      live = false;
    };
  }, [first, source]);

  const item = current.state === 'ready' && current.step.ok ? current.step.item : null;
  const itemKey = item?.key ?? null;

  // As an item shows: it counts as shown, a lesson as read, and the one after it is asked for.
  useEffect(() => {
    if (!item) return;
    if (!shown.current.includes(item.key)) shown.current = [...shown.current, item.key];
    source.shown(item);
    if (asking.current?.after !== item.key) {
      asking.current = { after: item.key, step: source.next([...shown.current]) };
    }
    const step = asking.current.step;
    let live = true;
    void step.then((ready) => {
      if (live) setAhead(ready);
    });
    return () => {
      live = false;
    };
    // The item's key is what changes; the item itself is the same object until it does.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemKey, source]);

  const forward = useCallback(() => {
    if (!item) return;
    setTally((was) => addToTally(was, tallyKind(item)));
    setAhead(null);
    if (ahead) {
      setCurrent({ state: 'ready', step: ahead });
      return;
    }
    const waiting = asking.current?.after === item.key ? asking.current.step : source.next([...shown.current]);
    setCurrent({ state: 'loading' });
    void waiting.then((step) => setCurrent({ state: 'ready', step }));
  }, [ahead, item, source]);

  const stop = useCallback(() => setEnded({ nothingLeft: false }), []);

  if (ended) {
    return (
      <SessionEnd
        startedAt={startedAt}
        tally={tally}
        nothingLeft={ended.nothingLeft}
        source={source}
        summary={endedAtFirst?.summary}
      />
    );
  }
  if (current.state === 'loading') return <SessionLoading onStop={tallyTotal(tally) > 0 ? stop : undefined} />;
  if (!current.step.ok) return <SessionReadFailed message={current.step.error} />;
  if (!item) {
    return tallyTotal(tally) > 0 ? (
      <SessionEnd startedAt={startedAt} tally={tally} nothingLeft source={source} />
    ) : (
      <SessionEmpty />
    );
  }

  const next = ahead?.ok && ahead.item ? { key: ahead.item.key, body: <PeekBody item={ahead.item} /> } : null;

  if (item.kind === 'question') {
    return (
      <DeckSwipe key={item.key} next={next} onSwiped={forward}>
        <CellAnswer
          key={item.asked.questionId}
          asked={item.asked}
          onNext={forward}
          onEnd={stop}
          endLabel="Stop"
          pinForward
        />
      </DeckSwipe>
    );
  }

  // A lesson is passed by reading it; a check, a task or a review by answering it, and Skip goes past one unanswered.
  const toAnswer = item.kind === 'check' || item.kind === 'task' || item.kind === 'review';
  const key = item.key;
  return (
    <SessionFrame onStop={stop} onNext={forward} skip={toAnswer && answeredKey !== key}>
      <DeckSwipe key={key} next={next} onSwiped={forward}>
        <div data-deck-item>
          <ItemBody item={item} onAnswered={() => setAnsweredKey(key)} />
        </div>
      </DeckSwipe>
    </SessionFrame>
  );
}

/** The item with the forward row under it, at the foot of the screen on a phone. */
export function SessionFrame({
  children,
  onStop,
  onNext,
  busy = false,
  skip = false,
}: {
  children: React.ReactNode;
  onStop?: () => void;
  onNext?: () => void;
  /** Next waits for the item it brings. */
  busy?: boolean;
  /**
   * The item waits on an answer it has not had: the forward press reads Skip
   * and steps back, so the answer button inside the item is the one to press.
   */
  skip?: boolean;
}) {
  return (
    <div className={PINNED_ROOM}>
      {children}
      <ForwardRow onEnd={onStop} endLabel="Stop" pinned>
        <Button
          type="button"
          size="lg"
          variant={skip ? 'secondary' : 'primary'}
          onClick={onNext}
          disabled={busy || !onNext}
          pending={busy}
          data-deck-next
        >
          {skip ? 'Skip' : 'Next'}
          <ArrowRight className="size-4" strokeWidth={1.75} aria-hidden />
        </Button>
      </ForwardRow>
    </div>
  );
}

/** The line over an item saying what it belongs to. */
function PlaceLine({ children }: { children: React.ReactNode }) {
  return <p className="mb-2 text-small text-ink-muted">{children}</p>;
}

/** Each kind drawn by the screen it has elsewhere. A question is drawn by `LearnSession` itself. */
export function ItemBody({
  item,
  onAnswered,
}: {
  item: Exclude<SessionItem, { kind: 'question' }>;
  /** Told once a check, task or review answer is marked. */
  onAnswered?: () => void;
}) {
  switch (item.kind) {
    case 'review':
      return (
        <>
          <PlaceLine>
            {KIND_WORD.review}
            {item.line && <> · {item.line}</>}
          </PlaceLine>
          <Card padding="standard">
            <ReviewRow review={item.review} showPlan={false} onAnswered={onAnswered} foldReasoning />
          </Card>
        </>
      );
    case 'lesson':
      return (
        <>
          <PlaceLine>{item.line}</PlaceLine>
          <LessonCard idea={item.idea} number={item.number} writing={null} />
        </>
      );
    case 'check':
      return (
        <>
          <PlaceLine>{item.line}</PlaceLine>
          <PieceCheckCard
            subjectId={item.subjectId}
            pieceId={item.pieceId}
            check={item.check}
            passedAt={null}
            practicePassed={item.practicePassed}
            checkPassed={false}
            checkOn={null}
            brief
            onAnswered={(result) => {
              if (result.check && result.check.correct !== null) onAnswered?.();
            }}
          />
        </>
      );
    case 'task':
      return (
        <>
          <PlaceLine>{item.line}</PlaceLine>
          <PracticeCard
            subjectId={item.subjectId}
            pieceId={item.pieceId}
            practice={item.practice}
            passedAt={null}
            checkPassed={item.checkPassed}
            onHandedIn={() => onAnswered?.()}
          />
        </>
      );
    case 'level_lesson':
      return (
        <>
          <PlaceLine>{item.line}</PlaceLine>
          <LessonCard
            idea={{
              conceptId: item.lesson.id,
              name: `Level ${item.lesson.level}`,
              claim: '',
              lesson: item.lesson.lesson,
              dropped: null,
            }}
            writing={null}
          />
        </>
      );
    case 'failed':
      return (
        <>
          <PlaceLine>
            {KIND_WORD[item.was]} · {item.line}
          </PlaceLine>
          <Card padding="standard" role="alert">
            <p className="flex items-center gap-1.5 text-body font-semibold text-ink">
              <CircleAlert className="size-4 shrink-0 text-danger" strokeWidth={1.75} aria-hidden />
              Dash could not write this one
            </p>
            <p className="mt-1 text-ui text-ink-muted">{item.error}</p>
            <p className="mt-3 text-ui text-ink">Next goes on to something else. It comes back in a later session.</p>
          </Card>
        </>
      );
    default: {
      const unknown: never = item;
      return unknown;
    }
  }
}

function peekTitle(item: SessionItem): string {
  switch (item.kind) {
    case 'question':
      return item.asked.question;
    case 'lesson':
      return item.idea.name;
    case 'level_lesson':
      return `${item.lesson.topicName}, level ${item.lesson.level}`;
    case 'review':
      return item.review.name;
    case 'check':
      return item.check.question;
    case 'task':
      return 'Practice';
    case 'failed':
      return 'Dash could not write this one';
    default: {
      const unknown: never = item;
      return String(unknown);
    }
  }
}

/** The item after this one, riding beside it while a swipe drags it away. */
function PeekBody({ item }: { item: SessionItem }) {
  const title = peekTitle(item);
  return (
    <>
      <PlaceLine>{item.kind === 'review' ? `${KIND_WORD.review} · ${item.line}` : item.line}</PlaceLine>
      <Card padding="standard">
        <p className="text-title leading-snug text-ink">{title}</p>
      </Card>
    </>
  );
}

/** The next item while it is chosen and written: its shape, with the row where it will be. */
export function SessionLoading({ onStop }: { onStop?: () => void }) {
  return (
    <SessionFrame onStop={onStop} busy>
      <div data-deck-item aria-busy="true">
        <Skeleton className="mb-2 h-3.5 w-48" />
        <Card padding="standard">
          <p className="text-small text-ink-muted">Choosing what to learn next…</p>
          <Skeleton className="mt-3 h-5 w-2/3" />
          <Skeleton className="mt-4 h-4 w-full" />
          <Skeleton className="mt-2 h-4 w-full" />
          <Skeleton className="mt-2 h-4 w-3/4" />
        </Card>
      </div>
    </SessionFrame>
  );
}

/** Nothing at all to learn: no review due, no subject with pieces and no approved topic. */
export function SessionEmpty() {
  return (
    <EmptyState
      icon={BookOpen}
      title="Nothing to learn yet"
      description="Add a subject and Dash prepares it: its topics, its plan and its first lessons. They start here once it is ready."
      action={{ label: 'Add a subject', href: '/learn/know' }}
    />
  );
}

/** The chooser could not read what to learn next. */
export function SessionReadFailed({ message }: { message: string }) {
  return (
    <EmptyState
      icon={CircleAlert}
      title="What to learn next could not be chosen"
      description={`${message} Nothing you answered is lost.`}
      action={{ label: 'Try again', href: '/learn/go' }}
    />
  );
}

/** What the session went through and what it moved: the end of a session, on Stop or when nothing is left. */
export function SessionEnd({
  startedAt,
  tally,
  nothingLeft,
  source,
  summary: given,
}: {
  startedAt: string;
  tally: SessionTally;
  nothingLeft: boolean;
  source: SessionSource;
  /** Drawn in place of the read, for the gallery; null draws it reading. */
  summary?: SessionEndResult | null;
}) {
  const [result, setResult] = useState<SessionEndResult | null>(given ?? null);
  useEffect(() => {
    if (given !== undefined) return;
    let live = true;
    void source.end(startedAt).then((read) => {
      if (live) setResult(read);
    });
    return () => {
      live = false;
    };
  }, [given, source, startedAt]);

  if (!result) {
    return (
      <div className={UNDER_DOCK} aria-busy="true" aria-label="Reading what moved">
        <Card padding="standard">
          <p className="text-small text-ink-muted">End of this session</p>
          <p className="mt-1 text-body font-semibold text-ink">{tallyLine(tally)}</p>
          <Skeleton className="mt-3 h-3.5 w-56" />
        </Card>
      </div>
    );
  }
  if ('error' in result) {
    return (
      <div className={UNDER_DOCK}>
        <Card padding="standard">
          <p className="text-small text-ink-muted">End of this session</p>
          <p className="mt-1 text-body font-semibold text-ink">{tallyLine(tally)}</p>
          <p className="mt-2 text-ui text-danger" role="alert">
            {result.error}
          </p>
        </Card>
      </div>
    );
  }
  return <SessionSummary tally={tally} summary={result.summary} nothingLeft={nothingLeft} />;
}

function SessionSummary({ tally, summary, nothingLeft }: { tally: SessionTally; summary: RunSummary; nothingLeft: boolean }) {
  const levels = summary.answered > 0 ? ` ${runHeadline(summary, false)}` : '';
  const left = nothingLeft ? ' There is nothing left to learn for now.' : '';
  return (
    <RunSummaryView
      summary={summary}
      title="End of this session"
      headline={`${tallyLine(tally)}${levels}${left}`}
      againHref="/learn/go"
      againLabel="Start again"
      nothingLeft={nothingLeft}
    />
  );
}
