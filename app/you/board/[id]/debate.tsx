'use client';

import { useEffect, useId } from 'react';
import { X } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { IconButton } from '@/components/ui/icon-button';
import { scrim } from '@/components/ui/popover';
import { SectionHeading } from '@/components/ui/section-heading';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { Tooltip } from '@/components/ui/tooltip';
import { cn } from '@/lib/cn';
import { SEATS, type Seat } from '@/lib/you/board';
import {
  advisorThinking,
  BRIEF_OPENING,
  exchanges,
  scoreGrid,
  turnsInRound,
  type DebateAdvisor,
  type DebateQuestion,
  type DebateTurn,
  type MeetingDebate,
  type Round,
  type Scores,
} from '@/lib/you/board-debate';
import type { BoardOption } from '@/lib/you/board-questions';
import { AdvisorMark } from '../advisor-mark';
import { SEAT_ICONS } from '../seat-label';
import { Evidence, Prose, ReceiptLink } from './prose';

/**
 * The debate on one meeting's page (plan #2561.5): each question it took up
 * with its options, the grid of who scored what, then the three rounds, each
 * turn under its advisor's mark, with round 2 drawn as the conversations
 * between two advisors. Pressing an advisor anywhere opens their thinking for
 * the meeting in a drawer: every turn they wrote and how their scores moved.
 *
 * Seats keep their icons (seat-label.tsx); a guest shows initials only, since
 * a guest is a persona built from public work and not the person.
 */

const isSeat = (key: string): key is Seat => (SEATS as readonly string[]).includes(key);

/** An advisor's mark: the seat's icon, or a guest's initials. */
function AdvisorBadge({ advisor }: { advisor: DebateAdvisor }) {
  if (advisor.kind === 'seat' && isSeat(advisor.key)) {
    const Icon = SEAT_ICONS[advisor.key];
    return (
      <span aria-hidden className="inline-flex size-5 shrink-0 items-center justify-center">
        <Icon className="size-4" strokeWidth={1.75} />
      </span>
    );
  }
  return <AdvisorMark name={advisor.name} />;
}

/** An advisor's mark and name, pressed to open their thinking. */
export function AdvisorButton({
  advisor,
  onOpen,
  className,
}: {
  advisor: DebateAdvisor;
  onOpen: (id: string) => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={() => onOpen(advisor.id)}
      aria-haspopup="dialog"
      className={cn(
        'press-area inline-flex min-w-0 items-center gap-1.5 rounded-control text-left font-medium text-ink transition-colors duration-quick hover:text-accent',
        className,
      )}
    >
      <AdvisorBadge advisor={advisor} />
      <span className="[overflow-wrap:anywhere]">{advisor.name}</span>
    </button>
  );
}

/** "A 7 · B 4 · C 6". */
function ScoreLine({ scores, options }: { scores: Scores; options: readonly BoardOption[] }) {
  const letters = options.length ? options.map((o) => o.letter) : Object.keys(scores).sort();
  return (
    <span className="tabular">
      {letters
        .filter((letter) => scores[letter] !== undefined)
        .map((letter) => `${letter} ${scores[letter]}`)
        .join(' · ')}
    </span>
  );
}

const ROUND_TITLES: Record<Round, string> = {
  1: 'Round 1: openings',
  2: 'Round 2: exchanges',
  3: 'Round 3: the vote',
};

/** One question the meeting took up: its options, the scores, and the debate by round. */
export function QuestionDebate({
  question,
  number,
  of,
  advisors,
  running,
  onOpen,
}: {
  question: DebateQuestion;
  number: number;
  of: number;
  advisors: readonly DebateAdvisor[];
  running: boolean;
  onOpen: (id: string) => void;
}) {
  const headingId = `board-q-${question.id}`;
  const byId = new Map(advisors.map((a) => [a.id, a]));
  const grid = scoreGrid(question, advisors);
  const anyMoved = grid.some((row) =>
    Object.values(row.cells).some((c) => c.final !== null && c.first !== null && c.final !== c.first),
  );
  const pairs = exchanges(question);

  return (
    <section aria-labelledby={headingId} className="space-y-3" data-board-question-debate>
      <SectionHeading id={headingId} title={of > 1 ? `Question ${number} of ${of}` : 'The question'} />
      <Card padding="standard" className="space-y-3">
        <p className="text-body font-semibold text-ink [overflow-wrap:anywhere]">
          {question.question}
        </p>
        {question.options.length > 0 && (
          <ol className="space-y-2">
            {question.options.map((option) => (
              <li key={option.letter} className="flex items-start gap-2.5">
                <span className="tabular inline-flex size-5 shrink-0 items-center justify-center rounded-control bg-sunken text-small font-semibold text-ink">
                  {option.letter}
                </span>
                <span className="min-w-0 text-body text-ink [overflow-wrap:anywhere]">
                  {option.text}
                </span>
              </li>
            ))}
          </ol>
        )}
      </Card>

      {question.turns.length === 0 && grid.length === 0 ? (
        <Card padding="standard">
          <p className="text-ui text-ink-muted">
            {running
              ? 'No advisor has spoken on this yet. Their turns appear here as the meeting goes.'
              : 'The board left no turns on this question.'}
          </p>
        </Card>
      ) : (
        <>
          {grid.length > 0 && question.options.length > 0 && (
            <Card padding="none" data-board-scores>
              <Table stack={false} fit>
                <caption className="sr-only">
                  Each advisor’s score for each option, out of 10
                </caption>
                <THead>
                  <tr className="border-b border-border">
                    <TH>Advisor</TH>
                    {question.options.map((option) => (
                      <TH key={option.letter} num>
                        {option.letter}
                      </TH>
                    ))}
                  </tr>
                </THead>
                <TBody>
                  {grid.map((row) => (
                    <TR key={row.advisor.id}>
                      <TD primary>
                        <AdvisorButton advisor={row.advisor} onOpen={onOpen} />
                      </TD>
                      {question.options.map((option) => {
                        const cell = row.cells[option.letter];
                        const moved =
                          cell.final !== null && cell.first !== null && cell.final !== cell.first;
                        return (
                          <TD key={option.letter} num className="align-top">
                            <span
                              className={cn(
                                'block',
                                row.backs === option.letter
                                  ? 'font-semibold text-ink'
                                  : 'text-ink-muted',
                              )}
                            >
                              {cell.final ?? '–'}
                            </span>
                            {moved && (
                              <span className="block text-small text-ink-muted">
                                from {cell.first}
                              </span>
                            )}
                          </TD>
                        );
                      })}
                    </TR>
                  ))}
                </TBody>
              </Table>
              <p className="card-pad-x border-t border-border py-2 text-small text-ink-muted">
                {running ? 'Out of 10, as scored so far.' : 'Out of 10, after the final vote.'}
                {anyMoved && ' Under a score that moved, its round 1 score.'}
              </p>
            </Card>
          )}

          {([1, 2, 3] as const).map((round) => {
            const turns = turnsInRound(question, round);
            if (!turns.length) return null;
            return (
              <div key={round} className="space-y-2">
                <SectionHeading as="h3" title={ROUND_TITLES[round]} count={turns.length} />
                {round === 2 ? (
                  <Card padding="none">
                    <ul className="divide-y divide-border">
                      {pairs.map((pair) => (
                        <li key={pair.between.join(':')}>
                          <p className="card-pad-x border-b border-border bg-sunken py-2 text-small font-medium text-ink-muted">
                            {pair.between.map((id) => byId.get(id)?.name ?? 'An advisor').join(' and ')}
                          </p>
                          <TurnList
                            turns={pair.turns}
                            options={question.options}
                            byId={byId}
                            onOpen={onOpen}
                          />
                        </li>
                      ))}
                    </ul>
                  </Card>
                ) : (
                  <Card padding="none">
                    <TurnList turns={turns} options={question.options} byId={byId} onOpen={onOpen} />
                  </Card>
                )}
              </div>
            );
          })}
        </>
      )}
    </section>
  );
}

function TurnList({
  turns,
  options,
  byId,
  onOpen,
}: {
  turns: readonly DebateTurn[];
  options: readonly BoardOption[];
  byId: ReadonlyMap<string, DebateAdvisor>;
  onOpen: (id: string) => void;
}) {
  return (
    <ul className="divide-y divide-border">
      {turns.map((turn) => {
        const advisor = byId.get(turn.advisorId);
        const to = turn.addressedTo ? byId.get(turn.addressedTo) : undefined;
        return (
          <li key={turn.id} className="card-pad-x space-y-1.5 py-3" data-board-turn>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-ui">
              {advisor ? (
                <AdvisorButton advisor={advisor} onOpen={onOpen} />
              ) : (
                <span className="font-medium text-ink">An advisor</span>
              )}
              {to && (
                <span className="text-ink-muted">
                  to{' '}
                  <button
                    type="button"
                    onClick={() => onOpen(to.id)}
                    aria-haspopup="dialog"
                    className="press-area rounded-control text-ink-muted transition-colors duration-quick hover:text-accent"
                  >
                    {to.name}
                  </button>
                </span>
              )}
              {turn.scores && (
                <span className="text-small text-ink-muted">
                  {turn.round === 2 ? 'moves to ' : ''}
                  <ScoreLine scores={turn.scores} options={options} />
                </span>
              )}
            </div>
            <TurnText turn={turn} />
          </li>
        );
      })}
    </ul>
  );
}

/** A turn's words; a brief for the option nobody backed says it is one. */
function TurnText({ turn }: { turn: DebateTurn }) {
  const brief = BRIEF_OPENING.exec(turn.text);
  return (
    <>
      {brief && (
        <p className="text-small font-medium text-ink-muted">
          {brief[0].replace(/:\s*$/, '')}. A brief for the other side, not their own view.
        </p>
      )}
      <Prose markdown={brief ? turn.text.slice(brief[0].length) : turn.text} />
      <Evidence receipts={turn.receipts} written={[turn.text]} />
    </>
  );
}

const turnLabel = (turn: DebateTurn, to: DebateAdvisor | undefined): string =>
  turn.round === 1
    ? 'Round 1, opening'
    : turn.round === 3
      ? 'Round 3, final vote'
      : to
        ? `Round 2, to ${to.name}`
        : 'Round 2, to the board';

/**
 * One advisor's thinking for the meeting, over the page from the right: who
 * they are and the question they own, then for each question they spoke on
 * how their scores moved by round and every turn they wrote, in order. A
 * guest lists the sources their brain was built from.
 */
export function AdvisorDrawer({
  advisor,
  debate,
  onClose,
}: {
  advisor: DebateAdvisor;
  debate: MeetingDebate;
  onClose: () => void;
}) {
  const titleId = useId();
  const byId = new Map(debate.advisors.map((a) => [a.id, a]));
  const thinking = advisorThinking(debate, advisor.id);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-overlay">
      <button type="button" aria-label="Close" tabIndex={-1} onClick={onClose} className={scrim} />
      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="absolute inset-y-0 right-0 flex w-[min(30rem,92vw)] flex-col border-l border-border bg-surface"
        data-board-advisor-drawer
      >
        <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
          <h2 id={titleId} className="flex min-w-0 items-center gap-2 text-ui font-semibold text-ink">
            <AdvisorBadge advisor={advisor} />
            <span className="[overflow-wrap:anywhere]">{advisor.name}</span>
          </h2>
          <Tooltip label="Close" align="end">
            <IconButton label="Close" onClick={onClose} autoFocus>
              <X strokeWidth={1.75} aria-hidden />
            </IconButton>
          </Tooltip>
        </div>

        <div className="flex-1 space-y-6 overflow-y-auto px-4 py-4">
          <div className="space-y-2">
            <p className="text-small text-ink-muted">
              {advisor.kind === 'seat'
                ? 'One of the five seats on your board.'
                : 'A guest: a persona Dash built from their public work, not the person.'}
            </p>
            {advisor.question && (
              <div className="space-y-0.5">
                <p className="text-small font-medium text-ink-muted">The question they own</p>
                <p className="text-body text-ink [overflow-wrap:anywhere]">{advisor.question}</p>
              </div>
            )}
            {advisor.focus && (
              <p className="text-ui text-ink-muted [overflow-wrap:anywhere]">{advisor.focus}</p>
            )}
          </div>

          {thinking.length === 0 && (
            <p className="text-ui text-ink-muted">They have not spoken in this meeting yet.</p>
          )}

          {thinking.map(({ question, turns, moves }) => (
            <section key={question.id} className="space-y-3">
              <h3 className="text-ui font-semibold text-ink [overflow-wrap:anywhere]">
                {question.question}
              </h3>
              {moves.length > 0 && question.options.length > 0 && (
                /* ui-ok: one table of score moves per question the advisor spoke on, not a card per row */
                <Card padding="none">
                  <Table stack={false} fit>
                    <caption className="sr-only">Their scores after each round, out of 10</caption>
                    <THead>
                      <tr className="border-b border-border">
                        <TH>Scores</TH>
                        {question.options.map((option) => (
                          <TH key={option.letter} num>
                            {option.letter}
                          </TH>
                        ))}
                      </tr>
                    </THead>
                    <TBody>
                      {moves.map((move) => (
                        <TR key={move.round}>
                          <TD>Round {move.round}</TD>
                          {question.options.map((option) => (
                            <TD key={option.letter} num>
                              {move.scores[option.letter] ?? '–'}
                            </TD>
                          ))}
                        </TR>
                      ))}
                    </TBody>
                  </Table>
                </Card>
              )}
              <ol className="space-y-4">
                {turns.map((turn) => (
                  <li key={turn.id} className="space-y-1">
                    <p className="text-small font-medium text-ink-muted">
                      {turnLabel(turn, turn.addressedTo ? byId.get(turn.addressedTo) : undefined)}
                    </p>
                    <TurnText turn={turn} />
                  </li>
                ))}
              </ol>
            </section>
          ))}

          {advisor.kind === 'guest' && advisor.sources.length > 0 && (
            <section className="space-y-2">
              <h3 className="text-ui font-semibold text-ink">What their brain was built from</h3>
              <ul className="space-y-1 text-ui">
                {advisor.sources.map((source) => (
                  <li key={source.link} className="[overflow-wrap:anywhere]">
                    <ReceiptLink receipt={source} className="press-area block py-2.5" />
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </aside>
    </div>
  );
}
