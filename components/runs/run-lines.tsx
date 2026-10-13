'use client';

import { DashMark, type DashActivity, type DashState } from '@/components/ui/dash-mark';
import { Card } from '@/components/ui/card';
import { Disclosure } from '@/components/ui/disclosure';
import { LinkedText } from '@/components/ui/linked-text';
import { StatusGlyph } from '@/components/ui/status-glyph';
import { RUN_ACTIVITY_LABEL, type RunActivity } from '@/lib/core/run-activities';
import { choiceKey, openQuestion } from '@/lib/core/run-questions';
import { RunAnswer, type AnswerRunAction } from './run-answer';
import { exactTime, shortWhen } from '@/lib/comments/when';
import type { StatusGlyph as GlyphName } from '@/lib/status-glyphs';
import { useClockNow } from '@/lib/use-clock-now';
import { cn } from '@/lib/cn';

/**
 * Where a run stands, as its lines are drawn (plan #1826).
 *
 * live: going, and the page is listening for its next line. waiting: it asked
 * you something and is waiting on the answer. stale: it stopped writing lines
 * and stays here until you acknowledge it. ended: finished or failed, so
 * nothing more will arrive.
 */
export type RunLinesState = 'live' | 'waiting' | 'stale' | 'ended';

/** Whether the page is still hearing from Realtime: connecting, heard, or cut off. */
export type RunLinesConnection = 'connecting' | 'open' | 'lost';

/**
 * The state line and its shape. The shapes are the plan's own: a run going
 * is the claimed step's three-quarter hexagon, a question the question mark,
 * a run gone quiet the cross a run that stopped takes, and a lost connection
 * the dashed one of something waiting.
 */
const STATE_LINE: Record<Exclude<RunLinesState, 'ended'>, { text: string; glyph: GlyphName }> = {
  live: { text: 'Dash is working', glyph: 'three-quarters' },
  waiting: { text: 'Waiting on your answer', glyph: 'question' },
  stale: { text: 'Dash has stopped writing lines', glyph: 'cross' },
};

/**
 * The mark beside the title follows the run (plan #1827). Going, it works in
 * the shape of the latest line: thinking after a thought, writing after an
 * action. Waiting, it stands level and blinks, since the work is yours now.
 * Gone quiet, it sleeps, because it has to be woken. Ended, it is still.
 */
function markFor(
  state: RunLinesState,
  connection: RunLinesConnection,
  lines: readonly RunActivity[],
): { state: DashState; activity?: DashActivity } {
  if (state === 'stale') return { state: 'asleep' };
  if (state !== 'live' || connection === 'lost') return { state: 'idle' };
  const last = lines[lines.length - 1]?.kind;
  return { state: 'working', activity: last === 'thought' ? 'thinking' : last === 'action' ? 'writing' : undefined };
}

const LOST = {
  text: 'Lost the live connection. Reload to see the newest lines.',
  glyph: 'dashed' as GlyphName,
};

/**
 * The lines a Dash run wrote, oldest first, on one card (the thread pattern):
 * the run's state first, then each line with what kind it is and when, Dash's
 * on the recessed ground and your answers on the card's own. A question shows
 * its choices, with the one you picked ticked once your answer is under it.
 * While the run is waiting on its newest question and `answer` is given, that
 * question's choices are presses that answer it, with a box for your own
 * words (plan #1824, components/runs/run-answer.tsx).
 *
 * Open while the run is going. Once it has ended the lines fold under their
 * count, since the summary and the changes on the page already say what the
 * run did.
 *
 * Drawn the same on a plan step's run and on a goal run's page. The
 * subscription that keeps it filling is LiveRunLines (live-run-lines.tsx);
 * this part only draws, so the gallery can draw it from fixtures.
 */
export function RunLinesView({
  lines,
  state,
  connection = 'open',
  acknowledge,
  answer,
  arrived,
  className,
}: {
  lines: readonly RunActivity[];
  state: RunLinesState;
  connection?: RunLinesConnection;
  /** The acknowledge press for a stale run; drawn beside its state line. */
  acknowledge?: React.ReactNode;
  /** The runs table's answer action, which makes a waiting question answerable here. */
  answer?: AnswerRunAction;
  /** Ids of lines that came in while the page was open; each rises in once. */
  arrived?: ReadonlySet<string>;
  className?: string;
}) {
  const now = useClockNow();
  const following = state === 'live' || state === 'waiting';
  const open = state === 'waiting' && answer ? openQuestion(lines) : null;
  const title = (
    <span className="flex min-w-0 items-center gap-1.5 text-body font-medium text-ink">
      <DashMark size="2xs" decorative className="text-ink-muted" {...markFor(state, connection, lines)} />
      Dash&rsquo;s lines
    </span>
  );
  const list = (
    <LineList lines={lines} now={now} arrived={arrived} open={open && answer ? { id: open.id, action: answer } : null} />
  );

  if (state === 'ended') {
    return (
      <Card padding="standard" className={className}>
        <Disclosure title={title} meta={`${lines.length}`} bodyClassName="pt-2">
          {list}
        </Disclosure>
      </Card>
    );
  }

  const line = following && connection === 'lost' ? LOST : STATE_LINE[state];
  const caution = state === 'stale' || line === LOST;

  return (
    <Card padding="standard" className={cn('space-y-2', className)}>
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        {title}
        {acknowledge}
      </div>
      <p
        role={following ? 'status' : undefined}
        className={cn('flex items-center gap-1.5 text-small', caution ? 'text-caution' : 'text-ink-muted')}
      >
        <StatusGlyph glyph={line.glyph} size={14} />
        <span>{line.text}</span>
      </p>
      {lines.length === 0 ? (
        <p className="text-small text-ink-muted">
          {following ? 'No lines yet. Each one appears here as Dash writes it.' : 'This run wrote no lines.'}
        </p>
      ) : (
        <div aria-live={following ? 'polite' : undefined}>{list}</div>
      )}
    </Card>
  );
}

function LineList({
  lines,
  now,
  open,
  arrived,
}: {
  lines: readonly RunActivity[];
  now: number;
  arrived?: ReadonlySet<string>;
  /** The question still waiting, and the action that answers it. */
  open: { id: string; action: AnswerRunAction } | null;
}) {
  return (
    <ol className="space-y-1">
      {lines.map((line, index) => (
        <RunLine
          key={line.id}
          line={line}
          now={now}
          arrived={arrived?.has(line.id) ?? false}
          answer={line.kind === 'question' ? answerAfter(lines, index) : null}
          answerWith={open?.id === line.id ? open.action : undefined}
        />
      ))}
    </ol>
  );
}

/** The answer written under a question: the next response, before any later question. */
function answerAfter(lines: readonly RunActivity[], index: number): string | null {
  for (const next of lines.slice(index + 1)) {
    if (next.kind === 'response') return choiceKey(next.body);
    if (next.kind === 'question') return null;
  }
  return null;
}

function RunLine({
  line,
  now,
  arrived,
  answer,
  answerWith,
}: {
  line: RunActivity;
  now: number;
  arrived: boolean;
  answer: string | null;
  /** Given on the question the run is waiting on: its choices become presses. */
  answerWith?: AnswerRunAction;
}) {
  const yours = line.kind === 'response';

  return (
    <li className={cn('min-w-0 py-1', arrived && 'run-line-in', !yours && '-mx-2 rounded-control bg-sunken px-2 py-1.5')}>
      <p className="flex flex-wrap items-baseline gap-x-2 text-small">
        <span className={cn('font-medium', line.kind === 'error' ? 'text-danger' : 'text-ink-muted')}>
          {RUN_ACTIVITY_LABEL[line.kind]}
        </span>
        <time dateTime={line.created_at} title={exactTime(line.created_at)} className="tabular text-ink-ghost">
          {shortWhen(line.created_at, now)}
        </time>
      </p>
      <p className="text-ui break-words whitespace-pre-wrap text-ink">
        <LinkedText text={line.body} />
      </p>
      {answerWith ? (
        <RunAnswer runId={line.run_id} options={line.options} action={answerWith} />
      ) : line.options && (
        <ul className="mt-1 space-y-0.5" aria-label="Its choices">
          {line.options.map((option) => {
            const picked = answer !== null && answer === choiceKey(option);
            return (
              <li
                key={option}
                className={cn(
                  'flex items-center gap-1.5 text-small',
                  answer === null || picked ? 'text-ink' : 'text-ink-ghost',
                )}
              >
                <StatusGlyph glyph={picked ? 'check' : 'empty'} size={12} label={picked ? 'Picked' : undefined} />
                <span>{option}</span>
              </li>
            );
          })}
        </ul>
      )}
    </li>
  );
}
