'use client';

import { useState, type ReactNode } from 'react';
import { ArrowRight } from 'lucide-react';
import Link, { linkVariants } from '@/components/ui/link';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Thread, ThreadTurn, type TalkSend } from '@/components/thread/thread';
import { CommentBody } from '@/components/dev/comment-body';
import { Disclosure } from '@/components/ui/disclosure';
import { LinkedText } from '@/components/ui/linked-text';
import { useClockNow } from '@/lib/use-clock-now';
import { ThreadPanel } from '@/components/patterns/thread';
import { cn } from '@/lib/cn';
import {
  explainTurn,
  FINISHED_LINE,
  talkLabel,
  talkMeta,
  talkSections,
  talkView,
  type PieceTalkView,
  type TalkSection,
} from '@/lib/learn/lessons/piece-talk';
import type { TodaysPiece } from '@/lib/learn/lessons/todays-piece-store';
import type { TalkTurn } from '@/lib/talk/talk';
import { RunSummaryPanel } from '@/app/learn/flow/summary-card';
import { useWrittenLessons } from '@/app/learn/s/[id]/p/[piece]/piece-view';
import { talkPiece, type PieceTalkResult } from './piece-talk-actions';

/**
 * Today's piece, first on Now (plan #2164.4), worked as a conversation with
 * Dash (plan #2164.5, `lib/learn/lessons/piece-talk.ts`). The piece is one
 * thread: Dash explains an idea from its lesson and asks you to explain it
 * back, marks what you wrote and asks one follow-up built on it, marks that
 * and goes on to the next idea, and after the last asks the piece's check. A
 * right answer to the check finishes the piece, and what the session moved
 * (plan #2164.6) shows under it. Every answer is marked and kept as evidence
 * on its idea; the marks are Dash's reply.
 *
 * Cards instead goes straight to the cards for this visit and leaves the
 * piece where it was; the thread opens there again next time.
 *
 * A goal with no pieces written yet draws a short card pointing at its
 * outline, above the cards rather than in their place.
 */

/** An answer the gallery sends as the thread appears. */
export type SentForGallery = { body: string; error?: string };

export function PieceFirst({
  piece,
  children,
  write = true,
  summary,
  sent,
}: {
  piece: TodaysPiece | null;
  /** The cards, drawn once the piece is finished or set aside. */
  children: ReactNode;
  /** False writes no missing lesson; the gallery draws one being written with it. */
  write?: boolean;
  /** Drawn in place of the summary's read, for the gallery. */
  summary?: ReactNode;
  /**
   * For the gallery: an answer sent as the thread appears and never sent to
   * the server, left being marked, or failing with `error`.
   */
  sent?: SentForGallery;
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
  return (
    <PieceThread piece={piece} write={write} summary={summary} sent={sent} onCards={() => setCards(true)} />
  );
}

function PieceThread({
  piece,
  write,
  summary,
  sent,
  onCards,
}: {
  piece: Extract<TodaysPiece, { kind: 'piece' }>;
  write: boolean;
  summary?: ReactNode;
  sent?: SentForGallery;
  onCards: () => void;
}) {
  const { page, goalName, talk } = piece;
  const { ideas, writing } = useWrittenLessons(page.subject.id, page.piece.id, page.ideas, write);
  const [view, setView] = useState<PieceTalkView>(() => talkView(talk.state, page.ideas));
  const pieceHref = `/learn/s/${page.subject.id}/p/${page.piece.id}`;
  const finished = view.stage === 'done';

  // Before the first answer nothing is kept: Dash's first turn is drawn from
  // the first idea's lesson, once it is written (or could not be), and the
  // server keeps the same words ahead of the answer.
  const first = ideas[0]!;
  const firstWriting = writing[first.conceptId];
  const started = talk.turns.length > 0;
  const ready = started || first.lesson !== null || first.dropped !== null || firstWriting?.state === 'failed';
  // On return, the ideas already worked through fold to a line each and the
  // thread opens on the part still going; turns added on this visit stay open.
  const [sections] = useState(() => talkSections(talk.turns));
  const earlier = sections.slice(0, -1);
  const turns: TalkTurn[] = started
    ? (sections[sections.length - 1]?.turns ?? [])
    : [{ id: 'piece-opening', role: 'assistant', body: explainTurn(first, 0, ideas.length), createdAt: talk.openedAt }];

  const sendTurn: TalkSend = async (body) => {
    const result: PieceTalkResult = sent
      ? sent.error
        ? { turns: [{ id: 'gallery-answer', role: 'user', body, createdAt: talk.openedAt }], error: sent.error }
        : await new Promise<PieceTalkResult>(() => {})
      : await talkPiece(page.subject.id, page.piece.id, body);
    if (result.view) setView(result.view);
    return result;
  };

  return (
    <section aria-label="Today’s piece" className="mb-6">
      <p className="mb-1.5 text-small font-medium text-accent">Today&rsquo;s piece · {goalName}</p>
      <ThreadPanel
        title={page.piece.title}
        href={pieceHref}
        heading
        meta={`Unit ${page.unit.ordinal}, ${page.unit.title} · ${talkMeta(view, ideas.length)}`}
      >
        {earlier.length > 0 && (
          <div className="space-y-1">
            {earlier.map((section, index) => (
              <FoldedSection key={section.turns[0]?.id ?? index} section={section} />
            ))}
          </div>
        )}
        {ready ? (
          <Thread
            id={`piece-${page.piece.id}`}
            turns={turns}
            send={sendTurn}
            label={talkLabel(view)}
            placeholder={view.stage === 'check' ? 'A sentence or two, from memory' : 'A few sentences, as if to a friend'}
            waiting="Dash is reading your answer…"
            activity="reading"
            closed={() => (finished ? FINISHED_LINE : null)}
            cost={{ action: 'app/learn/now/piece-talk-actions.ts#talkPiece', what: 'Cost of marking the answer' }}
            ask={sent?.body}
          />
        ) : (
          <p className="voice-dash -mx-2 px-2 py-1.5 text-ui text-ink-muted" aria-live="polite">
            Dash is writing the lesson for {first.name}…
          </p>
        )}
      </ThreadPanel>
      {finished && <div className="mt-4">{summary ?? <RunSummaryPanel />}</div>}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        {finished ? (
          <>
            <Link href={pieceHref} className={cn('press-area px-2 text-ui', linkVariants({ tone: 'quiet' }))}>
              Open the piece
            </Link>
            <Button type="button" onClick={onCards}>
              Go on to cards
              <ArrowRight className="size-4" strokeWidth={1.75} aria-hidden />
            </Button>
          </>
        ) : (
          <Button type="button" variant="ghost" size="sm" onClick={onCards}>
            Cards instead
          </Button>
        )}
      </div>
    </section>
  );
}

const STATE_WORDS = { shaky: 'marked shaky', known: 'marked known', sharp: 'marked sharp' } as const;

/** An idea already worked through, folded to its name and where it ended; open, its turns. */
function FoldedSection({ section }: { section: TalkSection }) {
  const now = useClockNow();
  const name = section.kind === 'idea' ? `Idea ${section.number} of ${section.total} · ${section.name}` : 'Earlier';
  const mark = section.kind === 'idea' && section.state ? STATE_WORDS[section.state] : `${section.turns.length} turns`;
  // The mark runs on after the name, held to its last word, so a wrap moves
  // them down together and no line starts with the mark.
  const space = name.lastIndexOf(' ');
  const title = (
    <>
      {name.slice(0, space + 1)}
      <span className="whitespace-nowrap">
        {name.slice(space + 1)} <span className="text-small font-normal text-ink-muted">· {mark}</span>
      </span>
    </>
  );
  return (
    <Disclosure title={title}>
      <ul className="space-y-2.5">
        {section.turns.map((turn, index) => {
          const mine = turn.role === 'user';
          const grouped = index > 0 && section.turns[index - 1]!.role === turn.role;
          return (
            <ThreadTurn
              key={turn.id}
              voice={mine ? 'you' : 'dash'}
              name={grouped ? undefined : mine ? 'You' : 'Dash'}
              at={turn.createdAt}
              now={now}
            >
              {mine ? (
                <p className="text-body whitespace-pre-wrap">
                  <LinkedText text={turn.body} />
                </p>
              ) : (
                <div className="text-body">
                  <CommentBody body={turn.body} refs="outlines" />
                </div>
              )}
            </ThreadTurn>
          );
        })}
      </ul>
    </Disclosure>
  );
}
