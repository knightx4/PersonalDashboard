'use client';

import { useRef, useState } from 'react';
import { X } from 'lucide-react';
import { Card, cardVariants } from '@/components/ui/card';
import { SectionFold } from '@/components/ui/disclosure';
import { IconButton } from '@/components/ui/icon-button';
import Link, { linkVariants } from '@/components/ui/link';
import { Popover } from '@/components/ui/popover';
import { SectionHeading } from '@/components/ui/section-heading';
import { Tooltip } from '@/components/ui/tooltip';
import { cn } from '@/lib/cn';
import { usePopover } from '@/lib/use-popover';
import { heldOnLabel } from '@/lib/you/board';
import type { DebateAdvisor, DebateQuestion, DebateTurn } from '@/lib/you/board-debate';
import {
  advisorDecisionHref,
  agreementOn,
  forecastsOf,
  headline,
  leadingOption,
  leanReplies,
  meanOf,
  pct,
  rangeText,
  stackDots,
  steelmanOf,
  theExchange,
  plainCondition,
  waitingOf,
  withoutCitations,
  type AdvisorForecast,
} from '@/lib/you/board-spread';
import { buttonVariants } from '@/components/ui/button';
import { AdvisorAvatar } from '../advisor-avatar';
import { VerdictAndDecision, type DecideAction } from './decision';
import type { MakeProps } from './make';
import { Evidence, Prose } from './prose';

/**
 * A decision worked with probabilities (plan #2581.9), on its meeting's
 * page. It opens with one line saying which option the advisors give the
 * best chance and how far they agree, then the spread: each advisor's avatar
 * placed on a line from 0 to 100% for that option, and one line from each
 * under it. Pressing a dot shows that advisor's range and reasoning; pressing
 * an avatar in the lines opens their profile at this decision.
 *
 * Below sit the numbers behind it (each option with every advisor's chance,
 * 90% range and points), the one exchange between the two most opposed, the
 * steelman on a unanimous decision, the premortem and its tripwire, and the
 * verdict with Decide and Make it happen. Every answer in full, with its
 * evidence, is folded at the foot.
 *
 * A decision scored out of 10, from before plan #2581.8, keeps debate.tsx.
 */

const DOT = 36;

export function ForecastDecision({
  question,
  number,
  of,
  advisors,
  running,
  showQuestion,
  decide,
  decideOpen,
  decideError,
  make,
  makeFailed,
  openDot = null,
}: {
  question: DebateQuestion;
  number: number;
  of: number;
  advisors: readonly DebateAdvisor[];
  running: boolean;
  /** False when the page's title already is the question. */
  showQuestion: boolean;
  decide: DecideAction;
  decideOpen?: boolean;
  decideError?: string | null;
  make?: MakeProps;
  makeFailed?: string | null;
  /** For the gallery: the advisor key whose dot is open. */
  openDot?: string | null;
}) {
  const headingId = `board-q-${question.id}`;
  const forecasts = forecastsOf(question, advisors);
  const letter = leadingOption(question, forecasts);
  const option = question.options.find((o) => o.letter === letter) ?? null;
  const byId = new Map(advisors.map((a) => [a.id, a]));
  const exchange = theExchange(question);
  const steelman = steelmanOf(question);
  const lean = leanReplies(question);
  const opened = question.turns.filter((t) => t.round === 1);
  const finished = !running;
  const waiting = running ? waitingOf(question, advisors, forecasts) : [];
  const undecided = finished && question.verdict !== null && question.decision === null;

  return (
    <section
      aria-labelledby={headingId}
      className="space-y-6"
      data-board-question-debate
      data-board-forecast
    >
      <div className="space-y-3">
        <div className="space-y-1">
          {of > 1 && (
            <p className="text-small font-medium text-ink-muted">
              Question {number} of {of}
            </p>
          )}
          {showQuestion || of > 1 ? (
            <h2
              id={headingId}
              className="text-body font-semibold text-ink [overflow-wrap:anywhere]"
            >
              {question.question}
            </h2>
          ) : (
            <h2 id={headingId} className="sr-only">
              {question.question}
            </h2>
          )}
        </div>
        <p
          className="text-title font-semibold text-ink [overflow-wrap:anywhere]"
          data-board-headline
        >
          {headline(question, forecasts, running, question.seated.length)}
        </p>
        <SpreadCard
          waiting={waiting}
          question={question}
          forecasts={forecasts}
          letter={letter}
          optionText={option?.text ?? null}
          running={running}
          openDot={openDot}
        />
      </div>

      {forecasts.length > 0 && question.options.length > 0 && (
        <section aria-labelledby={`${headingId}-options`} className="space-y-2">
          <SectionHeading id={`${headingId}-options`} as="h3" title="The numbers behind it" />
          <OptionsCard question={question} forecasts={forecasts} />
        </section>
      )}

      {exchange.length > 0 && (
        <section aria-labelledby={`${headingId}-exchange`} className="space-y-2">
          <SectionHeading
            id={`${headingId}-exchange`}
            as="h3"
            title="The exchange"
            count={pairName(exchange, byId)}
          />
          <Conversation turns={exchange} byId={byId} question={question} />
        </section>
      )}

      {steelman && (
        <section aria-labelledby={`${headingId}-steelman`} className="space-y-2">
          <SectionHeading
            id={`${headingId}-steelman`}
            as="h3"
            title="The other side, argued"
            count={letter ? `every advisor bet most on ${letter}` : undefined}
          />
          <Conversation
            turns={[steelman.brief, ...(steelman.answer ? [steelman.answer] : [])]}
            byId={byId}
            question={question}
          />
        </section>
      )}

      {finished && (question.premortem.length > 0 || question.tripwire) && (
        <section aria-labelledby={`${headingId}-premortem`} className="space-y-2">
          <SectionHeading
            id={`${headingId}-premortem`}
            as="h3"
            title="If it goes badly"
            count={letter ? `a year on, having taken ${letter}` : undefined}
          />
          <PremortemCard question={question} advisors={advisors} />
        </section>
      )}

      {undecided && question.verdict?.recommended && (
        <div
          className={cn(
            cardVariants(),
            'sticky bottom-[calc(var(--dock-h)+env(safe-area-inset-bottom)+0.5rem)] z-over-link sm:hidden',
            'flex items-center justify-between gap-3 border border-border px-4 py-2.5',
          )}
          data-board-decide-bar
        >
          <span className="min-w-0 text-ui text-ink">
            The advisors recommend{' '}
            <span className="font-semibold">{question.verdict.recommended}</span>
          </span>
          <a href={`#decide-${question.id}`} className={buttonVariants({ size: 'sm' })}>
            Decide
          </a>
        </div>
      )}

      {finished && (question.verdict || question.decision) && (
        <div id={`decide-${question.id}`} className="scroll-mt-24">
          <VerdictAndDecision
            question={question}
            advisors={advisors}
            decide={decide}
            editing={decideOpen}
            error={decideError}
            make={make}
            makeFailed={makeFailed}
          />
        </div>
      )}

      {opened.length > 0 && (
        <SectionFold
          title="Every answer in full"
          count={opened.length + lean.length}
          defaultOpen={false}
        >
          <AnswersInFull opened={opened} lean={lean} byId={byId} question={question} />
        </SectionFold>
      )}
    </section>
  );
}

/** "Success: … · Hard to undo", at the head of the spread. */
function MeasureLine({ question }: { question: DebateQuestion }) {
  const parts = [
    question.door === 'one_way'
      ? 'hard to undo'
      : question.door === 'two_way'
        ? 'easy to undo'
        : null,
  ].filter(Boolean);
  if (!question.successMeasure && !parts.length) return null;
  return (
    <p className="card-pad-x border-b border-border py-3 text-ui text-ink-muted [overflow-wrap:anywhere]">
      {question.successMeasure && (
        <>
          <span className="font-medium text-ink">Success:</span> {question.successMeasure}
          {parts.length > 0 && ' · '}
        </>
      )}
      {parts.length > 0 && capital(parts.join(' · '))}
    </p>
  );
}

const capital = (words: string) => words.charAt(0).toUpperCase() + words.slice(1);

/** The strip of avatars along 0 to 100% for the leading option, and one line from each advisor. */
function SpreadCard({
  waiting,
  question,
  forecasts,
  letter,
  optionText,
  running,
  openDot,
}: {
  /** Who sits on it and has not answered, while the meeting runs. */
  waiting: readonly DebateAdvisor[];
  question: DebateQuestion;
  forecasts: readonly AdvisorForecast[];
  letter: string | null;
  optionText: string | null;
  running: boolean;
  openDot: string | null;
}) {
  const [open, setOpen] = useState<string | null>(openDot);
  const placed = letter
    ? stackDots(
        forecasts.flatMap((f) =>
          typeof f.probabilities[letter] === 'number'
            ? [{ forecast: f, p: f.probabilities[letter] }]
            : [],
        ),
      )
    : [];
  const rows = Math.max(1, ...placed.map((d) => d.row + 1));
  const mean = letter ? meanOf(question, forecasts, letter) : null;
  const agreement = letter ? agreementOn(forecasts, letter) : null;
  const shown = placed.find((d) => d.forecast.advisor.key === open) ?? null;

  return (
    <Card padding="none" data-board-spread>
      <MeasureLine question={question} />
      <div className="card-pad space-y-3">
        {letter && (
          <p className="text-small text-ink-muted [overflow-wrap:anywhere]">
            Chance that <span className="font-semibold text-ink">{letter}</span>
            {optionText && <>, {optionText},</>} meets your measure
          </p>
        )}
        <div className="relative" style={{ paddingInline: DOT / 2 }}>
          <div className="relative" style={{ height: rows * (DOT + 6) + 4 }}>
            {/* The line itself, along the foot of the dots. */}
            <div aria-hidden className="absolute inset-x-0 bottom-0 h-px bg-border-strong" />
            {mean !== null && placed.length > 1 && (
              <div
                aria-hidden
                className="absolute bottom-0 w-0.5 -translate-x-1/2 rounded-full bg-accent"
                style={{ left: `${mean * 100}%`, height: rows * (DOT + 6) + 4 }}
              />
            )}
            <ul aria-label={letter ? `Each advisor’s chance for ${letter}` : 'Forecasts'}>
              {placed.map(({ forecast, p, row }) => (
                <li
                  key={forecast.advisor.id}
                  className={cn(
                    'absolute -translate-x-1/2 transition-opacity duration-quick',
                    open && open !== forecast.advisor.key && 'opacity-25',
                  )}
                  style={{ left: `${p * 100}%`, bottom: 4 + row * (DOT + 6) }}
                >
                  <DotButton
                    forecast={forecast}
                    letter={letter!}
                    open={open === forecast.advisor.key}
                    onToggle={() =>
                      setOpen((k) => (k === forecast.advisor.key ? null : forecast.advisor.key))
                    }
                  />
                </li>
              ))}
            </ul>
          </div>
          <div
            aria-hidden
            className="tabular mt-1.5 flex justify-between text-small text-ink-muted"
            style={{ marginInline: -DOT / 2 }}
          >
            <span>0%</span>
            <span>50%</span>
            <span>100%</span>
          </div>
          {shown && letter && (
            <DotPopover
              forecast={shown.forecast}
              letter={letter}
              questionId={question.id}
              onClose={() => setOpen(null)}
            />
          )}
        </div>
        {placed.length > 1 && mean !== null && agreement && (
          <p className="text-small text-ink-muted">
            <span
              aria-hidden
              className="mr-1.5 inline-block h-3 w-0.5 translate-y-0.5 rounded-full bg-accent"
            />
            {question.verdict?.probability ? 'Weighted by track record' : 'Mean so far'},{' '}
            {pct(mean)}. From {pct(agreement.low)} to {pct(agreement.high)}.
          </p>
        )}
        {placed.length === 0 && (
          <p className="text-ui text-ink-muted">
            {running
              ? 'They answer blind, each from their own evidence, and land on the line one by one.'
              : 'The advisors gave no probability for this decision.'}
          </p>
        )}
        {waiting.length > 0 && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2" data-board-waiting>
            <span className="text-small text-ink-muted">Still answering</span>
            <ul className="flex flex-wrap items-center gap-2" aria-label="Still answering">
              {waiting.map((a) => (
                <li key={a.id} className="flex items-center gap-1.5 text-small text-ink-muted">
                  <span /* ui-ok: a hollow mark for an advisor still answering, not a grouping box */ className="rounded-full border border-dashed border-border-strong p-0.5 opacity-60">
                    <AdvisorAvatar advisorKey={a.key} name={a.name} decorative />
                  </span>
                  {a.name}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {forecasts.length > 0 && (
        <ul className="divide-y divide-border border-t border-border" data-board-lines>
          {forecasts.map((f) => (
            <li key={f.advisor.id} className="card-pad-x flex items-start gap-3 py-3">
              <Link
                href={advisorDecisionHref(f.advisor.key, question.id)}
                aria-label={`${f.advisor.name}’s profile`}
                className="press-area shrink-0 rounded-full"
              >
                <AdvisorAvatar
                  advisorKey={f.advisor.key}
                  name={f.advisor.name}
                  size="md"
                  decorative
                />
              </Link>
              <div className="min-w-0 flex-1 space-y-0.5">
                <p className="flex flex-wrap items-baseline gap-x-2 text-ui">
                  <Link
                    href={advisorDecisionHref(f.advisor.key, question.id)}
                    className="press-area rounded-control font-medium text-ink transition-colors duration-quick hover:text-accent"
                  >
                    {f.advisor.name}
                  </Link>
                  {letter && typeof f.probabilities[letter] === 'number' && (
                    <span className="tabular text-small text-ink-muted">
                      {pct(f.probabilities[letter])} on {letter}
                    </span>
                  )}
                </p>
                {f.line && <p className="text-body text-ink [overflow-wrap:anywhere]">{f.line}</p>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function DotButton({
  forecast,
  letter,
  open,
  onToggle,
}: {
  forecast: AdvisorForecast;
  letter: string;
  open: boolean;
  onToggle: () => void;
}) {
  const p = forecast.probabilities[letter];
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      aria-label={`${forecast.advisor.name}, ${pct(p)} on ${letter}. Show their range and reasoning`}
      data-board-dot={forecast.advisor.key}
      className={cn(
        'press block rounded-full ring-offset-2 ring-offset-raised transition-shadow duration-quick',
        open ? 'ring-2 ring-accent' : 'hover:ring-2 hover:ring-border-strong',
      )}
    >
      <AdvisorAvatar
        advisorKey={forecast.advisor.key}
        name={forecast.advisor.name}
        size="md"
        decorative
      />
    </button>
  );
}

/** One advisor's range and reasoning, opened from their dot. */
function DotPopover({
  forecast,
  letter,
  questionId,
  onClose,
}: {
  forecast: AdvisorForecast;
  letter: string;
  questionId: string;
  onClose: () => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  usePopover({ open: true, onClose, panelRef });
  const range = forecast.ranges?.[letter];
  const points = forecast.budget?.[letter];
  const first = forecast.first?.[letter];
  const p = forecast.probabilities[letter];
  return (
    <Popover
      ref={panelRef}
      anchor={null}
      padding="panel"
      role="dialog"
      aria-label={`${forecast.advisor.name} on ${letter}`}
      tabIndex={-1}
      className="absolute inset-x-0 top-full z-overlay mt-2 space-y-2"
      data-board-dot-popover
    >
      <div className="flex items-start gap-2.5">
        <AdvisorAvatar
          advisorKey={forecast.advisor.key}
          name={forecast.advisor.name}
          size="md"
          decorative
        />
        <div className="min-w-0 flex-1">
          <p className="text-ui font-semibold text-ink">{forecast.advisor.name}</p>
          <p className="tabular text-small text-ink-muted">
            {pct(p)} on {letter}
            {typeof first === 'number' && first !== p && `, from ${pct(first)} before the exchange`}
            {typeof points === 'number' && ` · ${points} of 100 points`}
          </p>
        </div>
        <Tooltip label="Close" align="end">
          <IconButton label="Close" size="sm" onClick={onClose}>
            <X aria-hidden strokeWidth={1.75} />
          </IconButton>
        </Tooltip>
      </div>
      {range && (
        <p className="text-ui text-ink">
          <span className="text-ink-muted">90% range: </span>
          <span className="tabular">{rangeText(range)}</span>
        </p>
      )}
      {forecast.assessment && (
        <p className="text-ui text-ink-muted [overflow-wrap:anywhere]">
          Answering: {forecast.assessment}
        </p>
      )}
      {forecast.opening && (
        <Prose markdown={withoutCitations(forecast.opening.text)} className="text-ui" />
      )}
      {forecast.changeMind && (
        <p className="text-ui text-ink [overflow-wrap:anywhere]">
          <span className="text-ink-muted">What would change their mind: </span>
          {forecast.changeMind}
        </p>
      )}
      <Link href={advisorDecisionHref(forecast.advisor.key, questionId)} className={linkVariants()}>
        {forecast.advisor.name}’s track record
      </Link>
    </Popover>
  );
}

/** Each option with every advisor's chance, 90% range and points. */
function OptionsCard({
  question,
  forecasts,
}: {
  question: DebateQuestion;
  forecasts: readonly AdvisorForecast[];
}) {
  const topOf = (f: AdvisorForecast) => {
    const budget = f.budget;
    if (!budget) return null;
    const ranked = Object.entries(budget).sort((x, y) => y[1] - x[1]);
    return ranked[0] && (!ranked[1] || ranked[1][1] < ranked[0][1]) ? ranked[0][0] : null;
  };
  const units = new Set(
    forecasts.flatMap((f) => Object.values(f.ranges ?? {}).map((r) => r.unit ?? '')),
  );
  const oneUnit = units.size === 1 ? [...units][0] : null;
  return (
    <Card padding="none" data-board-options>
      <ol className="card-pad space-y-2 border-b border-border">
        {question.options.map((option) => {
          const mean = meanOf(question, forecasts, option.letter);
          return (
            <li key={option.letter} className="flex items-start gap-2.5">
              <span className="tabular inline-flex size-5 shrink-0 translate-y-0.5 items-center justify-center rounded-control bg-sunken text-small font-semibold text-ink">
                {option.letter}
              </span>
              <span className="min-w-0 flex-1 text-body text-ink [overflow-wrap:anywhere]">
                {option.text}
              </span>
              <span className="tabular shrink-0 text-body font-semibold text-ink">
                {mean !== null ? pct(mean) : '–'}
              </span>
            </li>
          );
        })}
      </ol>
      <ul className="divide-y divide-border" aria-label="Each advisor on each option">
        {forecasts.map((f) => {
          const top = topOf(f);
          return (
            <li key={f.advisor.id} className="card-pad-x space-y-1.5 py-3">
              <p className="flex min-w-0 items-center gap-1.5 text-ui font-medium text-ink">
                <AdvisorAvatar advisorKey={f.advisor.key} name={f.advisor.name} decorative />
                <span className="[overflow-wrap:anywhere]">{f.advisor.name}</span>
              </p>
              <dl
                className="grid gap-x-3"
                style={{
                  gridTemplateColumns: `repeat(${question.options.length}, minmax(0, 1fr))`,
                }}
              >
                {question.options.map((option) => {
                  const p = f.probabilities[option.letter];
                  const range = f.ranges?.[option.letter];
                  const points = f.budget?.[option.letter];
                  const backs = top === option.letter;
                  return (
                    <div key={option.letter} className="min-w-0">
                      <dt className="sr-only">Option {option.letter}</dt>
                      <dd className="tabular text-ui">
                        <span className="text-small text-ink-muted">{option.letter} </span>
                        <span className={backs ? 'font-semibold text-ink' : 'text-ink-muted'}>
                          {typeof p === 'number' ? pct(p) : '–'}
                        </span>
                        {typeof points === 'number' && (
                          <span
                            className={cn(
                              'block text-small',
                              backs ? 'text-ink' : 'text-ink-muted',
                            )}
                          >
                            {points} pts
                          </span>
                        )}
                        {range && (
                          <span className="block text-small text-ink-muted [overflow-wrap:anywhere]">
                            {rangeText(range, true, oneUnit === null)}
                          </span>
                        )}
                      </dd>
                    </div>
                  );
                })}
              </dl>
            </li>
          );
        })}
      </ul>
      <p className="card-pad-x border-t border-border py-2 text-small text-ink-muted">
        For each advisor and option: their chance that it meets your measure, the points of 100 they
        bet on it, and their 90% range{oneUnit ? `, ${oneUnit}` : ''}. In bold, the option each bet
        most on. Beside each option above, the weighted chance.
      </p>
    </Card>
  );
}

function pairName(turns: readonly DebateTurn[], byId: ReadonlyMap<string, DebateAdvisor>): string {
  const ids = [...new Set(turns.flatMap((t) => [t.advisorId, t.addressedTo ?? t.advisorId]))];
  return ids.map((id) => byId.get(id)?.name ?? 'An advisor').join(' and ');
}

/** Turns as a conversation: the first speaker on the left, the other on the right. */
function Conversation({
  turns,
  byId,
  question,
}: {
  turns: readonly DebateTurn[];
  byId: ReadonlyMap<string, DebateAdvisor>;
  question: DebateQuestion;
}) {
  const first = turns[0]?.advisorId;
  return (
    <ol className="space-y-3" data-board-exchange>
      {turns.map((turn) => {
        const advisor = byId.get(turn.advisorId);
        const right = turn.advisorId !== first;
        const brief = /^Arguing for ([A-Z]), which nobody backed:/.exec(turn.text);
        const moved = turn.probabilities
          ? question.options
              .filter((o) => typeof turn.probabilities?.[o.letter] === 'number')
              .map((o) => `${o.letter} ${pct(turn.probabilities![o.letter])}`)
              .join(' · ')
          : null;
        return (
          <li
            key={turn.id}
            className={cn('flex items-start gap-2.5', right && 'flex-row-reverse')}
            data-board-turn
          >
            {advisor && (
              <Link
                href={advisorDecisionHref(advisor.key, question.id)}
                aria-label={`${advisor.name}’s profile`}
                className="press-area shrink-0 rounded-full"
              >
                <AdvisorAvatar advisorKey={advisor.key} name={advisor.name} size="md" decorative />
              </Link>
            )}
            <Card
              padding="standard"
              className={cn('min-w-0 flex-1 space-y-1.5', right ? 'sm:ml-12' : 'sm:mr-12')}
            >
              <p className="text-small font-medium text-ink-muted">
                {advisor?.name ?? 'An advisor'}
                {brief && (
                  <span className="font-normal">{` · a brief for ${brief[1]}, which nobody backed, not their own view`}</span>
                )}
                {moved && <span className="tabular font-normal"> · moves to {moved}</span>}
              </p>
              <Prose
                markdown={withoutCitations(
                  turn.text.replace(/^Arguing for [A-Z], which nobody backed:\s*/, ''),
                )}
              />
              <Evidence receipts={turn.receipts} written={[turn.text]} />
            </Card>
          </li>
        );
      })}
    </ol>
  );
}

/** Each advisor's failure story, and the tripwire set from them. */
function PremortemCard({
  question,
  advisors,
}: {
  question: DebateQuestion;
  advisors: readonly DebateAdvisor[];
}) {
  const byKey = new Map(advisors.map((a) => [a.key, a]));
  const wire = question.tripwire;
  return (
    <Card padding="none" data-board-premortem>
      {question.premortem.length > 0 && (
        <ul className="divide-y divide-border">
          {question.premortem.map((story) => {
            const advisor = byKey.get(story.advisor);
            return (
              <li key={story.advisor} className="card-pad-x space-y-1 py-3">
                <p className="flex items-center gap-1.5 text-ui font-medium text-ink">
                  <AdvisorAvatar
                    advisorKey={story.advisor}
                    name={advisor?.name ?? story.advisor}
                    decorative
                  />
                  {advisor?.name ?? story.advisor}
                </p>
                <p className="text-body text-ink [overflow-wrap:anywhere]">{story.text}</p>
                {story.signal && (
                  <p className="text-ui text-ink-muted [overflow-wrap:anywhere]">
                    Earliest sign: {story.signal}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {wire && (
        <div
          className={cn(
            'card-pad-x space-y-1 bg-sunken py-3',
            question.premortem.length > 0 && 'border-t border-border',
          )}
          data-board-tripwire
        >
          <p className="text-small font-medium text-ink-muted">
            The tripwire
            {wire.status === 'watching' &&
              wire.checkOn &&
              `, checked on ${heldOnLabel(wire.checkOn)}`}
            {wire.status === 'tripped' && ', tripped'}
            {wire.status === 'cleared' && ', cleared'}
          </p>
          <p className="text-body text-ink [overflow-wrap:anywhere]">
            {plainCondition(wire.condition)}
          </p>
          {wire.fact && (
            <p className="text-ui text-ink-muted [overflow-wrap:anywhere]">{wire.fact}</p>
          )}
          <p className="text-ui text-ink-muted">
            If it trips, the decision goes back to the council.
          </p>
        </div>
      )}
    </Card>
  );
}

/** Every round 1 answer as written, with its evidence, then what each said to the lean. */
function AnswersInFull({
  opened,
  lean,
  byId,
  question,
}: {
  opened: readonly DebateTurn[];
  lean: readonly DebateTurn[];
  byId: ReadonlyMap<string, DebateAdvisor>;
  question: DebateQuestion;
}) {
  return (
    <div className="space-y-3">
      <Card padding="none">
        <p className="card-pad-x border-b border-border bg-sunken py-2 text-small text-ink-muted">
          Each advisor answered blind, from their own evidence, before seeing the others or your
          lean.
        </p>
        <ul className="divide-y divide-border">
          {opened.map((turn) => {
            const advisor = byId.get(turn.advisorId);
            return (
              <li key={turn.id} className="card-pad-x space-y-1.5 py-3" data-board-turn>
                <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-ui">
                  {advisor && (
                    <Link
                      href={advisorDecisionHref(advisor.key, question.id)}
                      className="press-area inline-flex items-center gap-1.5 rounded-control font-medium text-ink transition-colors duration-quick hover:text-accent"
                    >
                      <AdvisorAvatar advisorKey={advisor.key} name={advisor.name} decorative />
                      {advisor.name}
                    </Link>
                  )}
                  {turn.assessment && (
                    <span className="text-small text-ink-muted">on {turn.assessment}</span>
                  )}
                </p>
                <Prose markdown={turn.text} />
                {turn.changeMind && (
                  <p className="text-ui text-ink [overflow-wrap:anywhere]">
                    <span className="text-ink-muted">What would change their mind: </span>
                    {turn.changeMind}
                  </p>
                )}
                <Evidence receipts={turn.receipts} written={[turn.text]} />
              </li>
            );
          })}
        </ul>
      </Card>
      {lean.length > 0 && (
        <Card padding="none">
          <p className="card-pad-x border-b border-border bg-sunken py-2 text-small text-ink-muted">
            Then they heard your lean{question.lean ? `, toward ${question.lean}` : ''}.
          </p>
          <ul className="divide-y divide-border">
            {lean.map((turn) => {
              const advisor = byId.get(turn.advisorId);
              return (
                <li key={turn.id} className="card-pad-x space-y-1 py-3" data-board-turn>
                  <p className="text-ui font-medium text-ink">{advisor?.name ?? 'An advisor'}</p>
                  <Prose markdown={turn.text.replace(/^On your lean:\s*/, '')} />
                </li>
              );
            })}
          </ul>
        </Card>
      )}
    </div>
  );
}
