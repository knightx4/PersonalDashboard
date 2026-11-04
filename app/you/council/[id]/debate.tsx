'use client';

import { Card } from '@/components/ui/card';
import { Disclosure } from '@/components/ui/disclosure';
import Link from '@/components/ui/link';
import { SectionHeading } from '@/components/ui/section-heading';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { cn } from '@/lib/cn';
import { advisorHref } from '@/lib/you/board-profile';
import {
  BRIEF_OPENING,
  exchanges,
  scoreGrid,
  turnsInRound,
  type DebateAdvisor,
  type DebateQuestion,
  type DebateTurn,
  type Round,
  type Scores,
} from '@/lib/you/board-debate';
import type { BoardOption } from '@/lib/you/board-questions';
import { AdvisorAvatar } from '../advisor-avatar';
import { VerdictAndDecision, type DecideAction } from './decision';
import type { MakeProps } from './make';
import { Evidence, Prose } from './prose';

/**
 * The debate on one meeting's page (plan #2561.5): each question it took up
 * with its options, the grid of who scored what, then the three rounds, each
 * turn under its advisor's mark, with round 2 drawn as the conversations
 * between two advisors. Pressing an advisor anywhere opens their profile
 * (plan #2581.5), whose track record lists what they forecast on each
 * decision.
 *
 * Every advisor, seat or guest, is marked by their illustrated avatar
 * (plan #2581.3).
 */

/** An advisor's mark and name, pressed to open their profile. */
export function AdvisorButton({
  advisor,
  className,
}: {
  advisor: DebateAdvisor;
  className?: string;
}) {
  return (
    <Link
      href={advisorHref(advisor.key)}
      className={cn(
        'press-area inline-flex min-w-0 items-center gap-1.5 rounded-control text-left font-medium text-ink transition-colors duration-quick hover:text-accent',
        className,
      )}
    >
      <AdvisorAvatar advisorKey={advisor.key} name={advisor.name} decorative />
      <span className="[overflow-wrap:anywhere]">{advisor.name}</span>
    </Link>
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

/**
 * Which option the turns of a round back, for its folded line: "3 back A,
 * 1 backs C". A turn backs the option it scored highest; a tie or a turn
 * with no scores backs none.
 */
function tally(turns: readonly DebateTurn[]): string {
  const counts = new Map<string, number>();
  for (const turn of turns) {
    if (!turn.scores) continue;
    const ranked = Object.entries(turn.scores).sort((a, b) => b[1] - a[1]);
    if (!ranked.length || (ranked[1] && ranked[1][1] === ranked[0]![1])) continue;
    const letter = ranked[0]![0];
    counts.set(letter, (counts.get(letter) ?? 0) + 1);
  }
  return [...counts]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([letter, n]) => `${n} back${n === 1 ? 's' : ''} ${letter}`)
    .join(', ');
}

const ROUND_TITLES: Record<Round, string> = {
  1: 'Round 1: openings',
  2: 'Round 2: what they said to each other',
  3: 'Round 3: the vote',
};

/** One question the meeting took up: its options, the scores, and the debate by round. */
export function QuestionDebate({
  question,
  number,
  of,
  advisors,
  running,
  decide,
  decideOpen,
  decideError,
  make,
  makeFailed,
}: {
  question: DebateQuestion;
  number: number;
  of: number;
  advisors: readonly DebateAdvisor[];
  running: boolean;
  /** Saves the person's decision under the verdict. */
  decide: DecideAction;
  /** For the gallery: draw the decision form open, with this error showing. */
  decideOpen?: boolean;
  decideError?: string | null;
  /** Writes the decision as todos or goal steps (plan #2561.9). */
  make?: MakeProps;
  makeFailed?: string | null;
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
              : 'The council left no turns on this question.'}
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
                        <AdvisorButton advisor={row.advisor} />
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
            const backing = round === 2 ? '' : tally(turns);
            // A round folds away by its heading. While the meeting runs every
            // round is open. Once it is over the openings and the vote fold,
            // and the exchanges stay open: what the advisors said to each
            // other is what the person comes to the page to read.
            return (
              <Disclosure
                key={round}
                defaultOpen={running || round === 2}
                title={<span className="font-semibold">{ROUND_TITLES[round]}</span>}
                meta={
                  <span className="tabular">
                    {turns.length === 1 ? '1 turn' : `${turns.length} turns`}
                    {backing && ` · ${backing}`}
                  </span>
                }
                summaryClassName="min-h-8"
                bodyClassName="mt-2"
              >
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
                          />
                        </li>
                      ))}
                    </ul>
                  </Card>
                ) : (
                  <Card padding="none">
                    <TurnList turns={turns} options={question.options} byId={byId} />
                  </Card>
                )}
              </Disclosure>
            );
          })}
        </>
      )}

      {!running && (question.verdict || question.decision) && (
        <VerdictAndDecision
          question={question}
          advisors={advisors}
          decide={decide}
          editing={decideOpen}
          error={decideError}
          make={make}
          makeFailed={makeFailed}
        />
      )}
    </section>
  );
}

function TurnList({
  turns,
  options,
  byId,
}: {
  turns: readonly DebateTurn[];
  options: readonly BoardOption[];
  byId: ReadonlyMap<string, DebateAdvisor>;
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
                <AdvisorButton advisor={advisor} />
              ) : (
                <span className="font-medium text-ink">An advisor</span>
              )}
              {to && (
                <span className="text-ink-muted">
                  to{' '}
                  <Link
                    href={advisorHref(to.key)}
                    className="press-area rounded-control text-ink-muted transition-colors duration-quick hover:text-accent"
                  >
                    {to.name}
                  </Link>
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
