'use client';

import { useLayoutEffect, useRef, useState } from 'react';
import { ChevronRight } from 'lucide-react';

import { DashMark, type DashActivity, type DashState } from '@/components/ui/dash-mark';
import { Card } from '@/components/ui/card';
import { Disclosure } from '@/components/ui/disclosure';
import { LinkedText } from '@/components/ui/linked-text';
import { StatusGlyph } from '@/components/ui/status-glyph';
import { RUN_ACTIVITY_LABEL, type RunActivity } from '@/lib/core/run-activities';
import { runPose } from '@/lib/core/run-pose';
import { choiceKey, openQuestion } from '@/lib/core/run-questions';
import { RunAnswer, type AnswerRunAction } from './run-answer';
import { exactTime, shortWhen } from '@/lib/comments/when';
import type { StatusGlyph as GlyphName } from '@/lib/status-glyphs';
import { useClockNow } from '@/lib/use-clock-now';
import { cn } from '@/lib/cn';
import type { FeatureStep } from '@/lib/digest/night';
import { featureLines, type LineGroup, type StepBucket } from '@/lib/plan/feature-lines';

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
 * the shape of the latest line, read the same way as the runner card's
 * Dashes (lib/core/run-pose.ts): reading, searching, testing, writing or
 * thinking. Waiting, it asks, since the work is yours now. Gone quiet, it
 * sleeps, because it has to be woken. Ended, it rests.
 */
function markFor(
  state: RunLinesState,
  connection: RunLinesConnection,
  lines: readonly RunActivity[],
): { state: DashState; activity?: DashActivity } {
  if (state === 'stale') return { state: 'asleep' };
  if (state === 'waiting') return { state: 'asking' };
  if (state !== 'live' || connection === 'lost') return { state: 'idle' };
  return runPose(lines[lines.length - 1]);
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
  feature,
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
  /**
   * The feature a session is building, with its steps: the lines fold under
   * the step each is about, and lines about other features are left out
   * (lib/plan/feature-lines.ts). Left out, the lines are one list.
   */
  feature?: { ref: string; steps: readonly FeatureStep[] };
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
  const asking = open && answer ? { id: open.id, action: answer } : null;
  const list = feature ? (
    <StepLines lines={lines} feature={feature} now={now} arrived={arrived} open={asking} />
  ) : (
    <LineList lines={lines} now={now} arrived={arrived} open={asking} />
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

/** What a step's fold says about where it stands. */
const STEP_STATE: Record<FeatureStep['status'], string> = {
  in_progress: 'Being built',
  blocked: 'Blocked',
  done: 'Done',
  not_started: 'Not started',
  proposed: 'Not started',
  dropped: 'Dropped',
};

/**
 * A feature session's lines, in a box of fixed height that keeps the newest
 * line in view, with that line pinned above it under "Now" so what Dash is
 * doing reads first. Inside the box there is one fold for each step: the one
 * holding the newest line, a question waiting on you or a step being built
 * opens by itself, and the rest fold to their state and how many lines they
 * hold. Scrolling up through older lines stops the box following the newest
 * one until it is scrolled back down.
 */
function StepLines({
  lines,
  feature,
  now,
  open,
  arrived,
}: {
  lines: readonly RunActivity[];
  feature: { ref: string; steps: readonly FeatureStep[] };
  now: number;
  arrived?: ReadonlySet<string>;
  open: { id: string; action: AnswerRunAction } | null;
}) {
  const { buckets, hidden } = featureLines(lines, feature.ref, feature.steps);
  let newest: { group: LineGroup; bucket: StepBucket } | null = null;
  for (const bucket of buckets) {
    for (const group of bucket.groups) {
      if (!newest || group.at >= newest.group.at) newest = { group, bucket };
    }
  }
  const newestId = newest?.group.lastId ?? null;

  const box = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  const moving = useRef(false);
  const [toggled, setToggled] = useState<Readonly<Record<string, boolean>>>({});

  // Keep the newest line at the foot of the box while following.
  useLayoutEffect(() => {
    const el = box.current;
    if (!el || !follow.current || !newestId) return;
    const target = el.querySelector<HTMLElement>(`[data-line="${CSS.escape(newestId)}"]`);
    if (!target) return;
    moving.current = true;
    el.scrollTop = Math.max(0, target.offsetTop + target.offsetHeight - el.clientHeight + 12);
    requestAnimationFrame(() => {
      moving.current = false;
    });
  }, [newestId, toggled]);

  const onScroll = () => {
    const el = box.current;
    if (!el || moving.current || !newestId) return;
    const target = el.querySelector<HTMLElement>(`[data-line="${CSS.escape(newestId)}"]`);
    // Following again once the newest line is back in view.
    follow.current = !target || target.offsetTop + target.offsetHeight <= el.scrollTop + el.clientHeight + 24;
  };

  return (
    <div className="space-y-2">
      {newest && (
        <div className="rounded-control border border-accent/40 bg-accent-tint px-3 py-2">
          <p className="flex flex-wrap items-baseline gap-x-2 text-small">
            <span className="font-medium text-accent">Now</span>
            {newest.bucket.ref && <span className="tabular text-ink-ghost">{newest.bucket.ref}</span>}
            <span className="min-w-0 truncate text-ink-muted">{newest.bucket.title}</span>
            <time dateTime={newest.group.at} className="tabular ml-auto text-ink-ghost">
              {shortWhen(newest.group.at, now)}
            </time>
          </p>
          <p className="text-ui break-words text-ink">
            {newest.group.summary ?? <LinkedText text={newest.group.line.body} />}
          </p>
        </div>
      )}
      <div
        ref={box}
        onScroll={onScroll}
        className="max-h-80 overflow-y-auto overscroll-contain rounded-control border border-border bg-sunken p-1.5"
      >
        <ol className="space-y-1">
          {buckets.map((bucket) => {
            const auto =
              bucket.status === 'in_progress' ||
              bucket.status === 'blocked' ||
              bucket.groups.some((group) => group.line.id === open?.id || group.lastId === newestId);
            const isOpen = toggled[bucket.key] ?? auto;
            return (
              <li key={bucket.key}>
                <StepFold
                  bucket={bucket}
                  lines={lines}
                  now={now}
                  arrived={arrived}
                  open={open}
                  isOpen={isOpen}
                  live={bucket === newest?.bucket}
                  onToggle={() => setToggled((was) => ({ ...was, [bucket.key]: !isOpen }))}
                />
              </li>
            );
          })}
        </ol>
      </div>
      {hidden > 0 && (
        <p className="text-small text-ink-ghost">
          {hidden} {hidden === 1 ? 'line' : 'lines'} about other features left out
        </p>
      )}
    </div>
  );
}

function StepFold({
  bucket,
  lines,
  now,
  arrived,
  open,
  isOpen,
  live,
  onToggle,
}: {
  bucket: StepBucket;
  lines: readonly RunActivity[];
  now: number;
  arrived?: ReadonlySet<string>;
  open: { id: string; action: AnswerRunAction } | null;
  isOpen: boolean;
  /** Holds the newest line. */
  live: boolean;
  onToggle: () => void;
}) {
  const said = bucket.count === 0 ? null : bucket.count === 1 ? '1 line' : `${bucket.count} lines`;
  const meta = [bucket.status ? STEP_STATE[bucket.status] : null, said].filter(Boolean).join(' · ');
  const body = `step-lines-${bucket.key.replace(/\W/g, '-')}`;
  return (
    <div className={cn('rounded-control border bg-surface', live ? 'border-accent/50' : 'border-border')}>
      <button
        type="button"
        aria-expanded={isOpen}
        aria-controls={body}
        onClick={onToggle}
        className="press flex w-full min-w-0 items-center gap-2 px-2.5 py-2 text-left text-ui"
      >
        <ChevronRight
          aria-hidden
          strokeWidth={1.75}
          className={cn('size-3.5 shrink-0 text-ink-ghost transition-transform duration-quick', isOpen && 'rotate-90')}
        />
        {bucket.ref && <span className="tabular shrink-0 text-ink-ghost">{bucket.ref}</span>}
        <span className="min-w-0 flex-1 truncate font-medium text-ink">{bucket.title}</span>
        <span className="flex shrink-0 items-center gap-1.5 text-small text-ink-muted">
          {bucket.status && <StatusGlyph glyph={STEP_GLYPH[bucket.status]} size={12} />}
          <span className="max-sm:sr-only">{meta}</span>
        </span>
      </button>
      {isOpen && (
        <div id={body} className="px-2.5 pb-2">
          {bucket.groups.length === 0 ? (
            <p className="pl-5.5 text-small text-ink-muted">Nothing written about this step yet.</p>
          ) : (
            <ol>
              {bucket.groups.map((group) =>
                group.line.kind === 'question' || group.line.kind === 'response' ? (
                  <RunLine
                    key={group.line.id}
                    line={group.line}
                    group={group}
                    now={now}
                    arrived={arrived?.has(group.line.id) ?? false}
                    answer={group.line.kind === 'question' ? answerAfter(lines, lines.indexOf(group.line)) : null}
                    answerWith={open?.id === group.line.id ? open.action : undefined}
                  />
                ) : (
                  <CompactLine key={group.line.id} group={group} now={now} arrived={arrived?.has(group.line.id) ?? false} />
                ),
              )}
            </ol>
          )}
        </div>
      )}
    </div>
  );
}

/** The shape each step's state takes beside it, from the plan's own set. */
const STEP_GLYPH: Record<FeatureStep['status'], GlyphName> = {
  in_progress: 'three-quarters',
  blocked: 'cross',
  done: 'check',
  not_started: 'empty',
  proposed: 'empty',
  dropped: 'empty',
};

/** One line under a step, on one row: what kind, what it said, and when. */
function CompactLine({ group, now, arrived }: { group: LineGroup; now: number; arrived: boolean }) {
  const { line } = group;
  return (
    <li
      data-line={group.lastId}
      className={cn(
        'grid grid-cols-[4.5rem_minmax(0,1fr)_auto] gap-x-3 border-t border-border/60 py-1.5 first:border-t-0',
        'max-sm:grid-cols-[minmax(0,1fr)_auto]',
        arrived && 'run-line-in',
      )}
    >
      <span
        className={cn(
          'pt-px text-small max-sm:col-span-2',
          line.kind === 'error' ? 'text-danger' : 'text-ink-ghost',
        )}
      >
        {RUN_ACTIVITY_LABEL[line.kind]}
        {group.repeats > 1 && <span className="tabular"> &times;{group.repeats}</span>}
      </span>
      <span className="min-w-0 text-ui break-words text-ink">
        {group.summary ?? <LinkedText text={line.body} />}
        {group.files.length > 0 && (
          <span className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5">
            {group.files.map((file) => (
              <span key={file} className="min-w-0 font-mono text-small break-all text-ink-muted">
                {file}
              </span>
            ))}
          </span>
        )}
      </span>
      <time
        dateTime={group.at}
        title={exactTime(group.at)}
        className="tabular pt-px text-small text-ink-ghost"
      >
        {shortWhen(group.at, now)}
      </time>
    </li>
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
  group,
  now,
  arrived,
  answer,
  answerWith,
}: {
  line: RunActivity;
  /** The repeats and file runs folded into this line, under a step (feature-lines.ts). */
  group?: LineGroup;
  now: number;
  arrived: boolean;
  answer: string | null;
  /** Given on the question the run is waiting on: its choices become presses. */
  answerWith?: AnswerRunAction;
}) {
  const yours = line.kind === 'response';

  return (
    <li data-line={group?.lastId ?? line.id} className={cn('min-w-0 py-1', arrived && 'run-line-in', !yours && '-mx-2 rounded-control bg-sunken px-2 py-1.5')}>
      <p className="flex flex-wrap items-baseline gap-x-2 text-small">
        <span className={cn('font-medium', line.kind === 'error' ? 'text-danger' : 'text-ink-muted')}>
          {RUN_ACTIVITY_LABEL[line.kind]}
        </span>
        <time dateTime={group?.at ?? line.created_at} title={exactTime(group?.at ?? line.created_at)} className="tabular text-ink-ghost">
          {shortWhen(group?.at ?? line.created_at, now)}
        </time>
        {group && group.repeats > 1 && (
          <span className="tabular text-ink-ghost" title={`Written ${group.repeats} times in a row`}>
            &times;{group.repeats}
          </span>
        )}
      </p>
      <p className="text-ui break-words whitespace-pre-wrap text-ink">
        {group?.summary ?? <LinkedText text={line.body} />}
      </p>
      {group && group.files.length > 0 && (
        <ul className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5" aria-label="The files">
          {group.files.map((file) => (
            <li key={file} className="min-w-0 font-mono text-small break-all text-ink-muted">
              {file}
            </li>
          ))}
        </ul>
      )}
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
