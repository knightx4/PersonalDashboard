'use client';

import { useRef, useState } from 'react';
import { BookOpen, Check, CircleHelp, PenLine, Play } from 'lucide-react';
import Link from '@/components/ui/link';
import { buttonVariants } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Meter } from '@/components/ui/meter';
import { cn } from '@/lib/cn';
import type { MapLayout } from '@/lib/learn/courses/plan';
import { hours } from '../format';

/**
 * A course's plan as a map you press (docs/LEARN-DIGEST-SPEC.md, "The plan").
 * Each stage is a place on it, set under the stages it rests on, with a line
 * from each of those. A ring round the place fills as its steps are done.
 * Pressing a place opens that stage beside the map, or under it on a phone:
 * what it gets you, the button that takes you to its next step, and its steps.
 * The map opens on the stage that holds the next step.
 */

export type MapStep = {
  key: string;
  title: string;
  gain: string | null;
  minutes: number;
  clips: number;
  figure: boolean;
  reading: boolean;
  check: boolean;
  done: boolean;
};

export type MapStage = {
  key: string;
  /** The stage's name on the map. */
  short: string;
  title: string;
  about: string;
  /** The names of the stages it comes after. */
  after: string[];
  /** Every stage it comes after is finished, or it is where the course starts. */
  open: boolean;
  steps: MapStep[];
};

// A place is a 44px ring, up to three lines of name and a line under it; rows sit a gap apart.
const RING = 44;
const PLACE = 112;
const GAP = 30;
const ROW = PLACE + GAP;
/** The widest a column gets, so a course of one line is not stretched across the card. */
const COLUMN = 136;

const taken = (stage: MapStage) => stage.steps.filter((step) => step.done).length;
const minutesOf = (stage: MapStage) => stage.steps.reduce((sum, step) => sum + step.minutes, 0);

export function PlanMap({
  courseId,
  stages,
  layout,
  nextStage,
}: {
  courseId: string;
  stages: MapStage[];
  layout: MapLayout;
  /** The stage that holds the step to take next; null when every step is done. */
  nextStage: string | null;
}) {
  const [chosen, setChosen] = useState(nextStage ?? stages[0]?.key ?? '');
  const panel = useRef<HTMLDivElement>(null);
  const map = useRef<HTMLDivElement>(null);
  const byKey = new Map(stages.map((stage) => [stage.key, stage]));
  const at = new Map(layout.nodes.map((node) => [node.key, node]));
  const stage = byKey.get(chosen) ?? stages[0];
  if (!stage) return null;

  const choose = (key: string) => {
    setChosen(key);
    // Where the stage opens under the map it is below the fold: bring it up.
    const beside =
      panel.current && map.current && panel.current.offsetTop === map.current.offsetTop;
    if (!beside) {
      requestAnimationFrame(() =>
        panel.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
      );
    }
  };

  const height = layout.rows * ROW - GAP;
  const middle = (x: number) => (x + 0.5) * 100;

  return (
    <div className="@container">
      <div className="grid gap-5 @4xl:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] @4xl:items-start">
        <div ref={map} className="@4xl:sticky @4xl:top-4">
          <Card padding="dense" className="space-y-3">
            <p className="text-small text-ink-muted">
              The course from top to bottom. Press a stage to open it.
            </p>
            <nav
              aria-label="The course's stages"
              className="relative -mx-2 sm:mx-auto"
              style={{ height, maxWidth: layout.columns * COLUMN }}
            >
              <svg
                aria-hidden
                className="absolute inset-0 size-full"
                viewBox={`0 0 ${layout.columns * 100} ${height}`}
                preserveAspectRatio="none"
                fill="none"
              >
                {layout.edges.map((edge) => {
                  const from = at.get(edge.from);
                  const to = at.get(edge.to);
                  if (!from || !to) return null;
                  const top = to.row * ROW;
                  const start = from.row * ROW + PLACE;
                  // A line to the row below is one curve. One that passes a row first runs
                  // straight down its own column, which holds nothing else, and curves at the end.
                  const turn = Math.max(start, top - GAP);
                  const walked = (byKey.get(edge.from)?.steps ?? []).every((step) => step.done);
                  return (
                    <path
                      key={`${edge.from}-${edge.to}`}
                      d={`M ${middle(from.x)} ${start} L ${middle(from.x)} ${turn} C ${middle(from.x)} ${turn + GAP * 0.6}, ${middle(to.x)} ${top - GAP * 0.6}, ${middle(to.x)} ${top - 4}`}
                      stroke="currentColor"
                      strokeWidth={1.75}
                      vectorEffect="non-scaling-stroke"
                      className={walked ? 'text-accent' : 'text-border-strong'}
                    />
                  );
                })}
              </svg>

              {layout.nodes.map((node) => {
                const item = byKey.get(node.key);
                if (!item) return null;
                return (
                  <Place
                    key={node.key}
                    stage={item}
                    chosen={item.key === stage.key}
                    next={item.key === nextStage}
                    style={{
                      left: `${(middle(node.x) / (layout.columns * 100)) * 100}%`,
                      top: node.row * ROW,
                      width: `${100 / layout.columns}%`,
                      maxWidth: COLUMN,
                      height: PLACE,
                    }}
                    onChoose={() => choose(item.key)}
                  />
                );
              })}
            </nav>
          </Card>
        </div>

        <div ref={panel} className="scroll-mt-4">
          <StagePanel courseId={courseId} stage={stage} next={stage.key === nextStage} />
        </div>
      </div>
    </div>
  );
}

function Place({
  stage,
  chosen,
  next,
  style,
  onChoose,
}: {
  stage: MapStage;
  chosen: boolean;
  next: boolean;
  style: React.CSSProperties;
  onChoose: () => void;
}) {
  const done = taken(stage);
  const total = stage.steps.length;
  const finished = done === total;
  // The ring is drawn on a circle of radius 19, so its length is 2π × 19.
  const round = 2 * Math.PI * 19;

  return (
    <button
      type="button"
      onClick={onChoose}
      aria-pressed={chosen}
      aria-label={`${stage.short}: ${done} of ${total} steps done, ${hours(minutesOf(stage))}${next ? ', up next' : ''}`}
      style={style}
      className="group absolute flex -translate-x-1/2 cursor-pointer flex-col items-center gap-1 px-0.5 text-center"
    >
      <span
        className={cn(
          'relative grid shrink-0 place-items-center rounded-full transition-[outline-color] duration-quick',
          'outline-2 outline-offset-2',
          chosen ? 'outline-accent' : 'outline-transparent group-hover:outline-border-strong',
          finished ? 'bg-accent text-fill-ink' : 'bg-sunken text-ink',
        )}
        style={{ width: RING, height: RING }}
      >
        {!finished && (
          <svg aria-hidden viewBox="0 0 44 44" className="absolute inset-0 size-full -rotate-90">
            <circle
              cx="22"
              cy="22"
              r="19"
              fill="none"
              stroke="currentColor"
              strokeWidth={2.5}
              strokeDasharray={stage.open ? undefined : '3 4'}
              className={stage.open || done > 0 ? 'text-border-strong' : 'text-border'}
            />
            {done > 0 && (
              <circle
                cx="22"
                cy="22"
                r="19"
                fill="none"
                stroke="currentColor"
                strokeWidth={2.5}
                strokeLinecap="round"
                strokeDasharray={`${(done / total) * round} ${round}`}
                className="text-accent"
              />
            )}
          </svg>
        )}
        {finished ? (
          <Check className="size-5" strokeWidth={1.75} aria-hidden />
        ) : (
          <span
            className={cn(
              'tabular relative text-small',
              stage.open || done > 0 ? 'text-ink' : 'text-ink-muted',
            )}
          >
            {done}/{total}
          </span>
        )}
      </span>
      <span
        className={cn(
          // The name may run a little past its column, which on a phone is 68px, so
          // that a long word stays whole; names beside each other are short enough to clear.
          'line-clamp-3 w-max max-w-[5.25rem] shrink-0 text-small leading-tight [overflow-wrap:break-word]',
          chosen ? 'font-medium text-ink' : 'text-ink',
        )}
      >
        {stage.short}
      </span>
      <span
        className={cn('tabular text-micro', next ? 'font-medium text-accent' : 'text-ink-muted')}
      >
        {next ? (done > 0 ? 'Continue' : 'Start here') : hours(minutesOf(stage))}
      </span>
    </button>
  );
}

function StagePanel({
  courseId,
  stage,
  next,
}: {
  courseId: string;
  stage: MapStage;
  next: boolean;
}) {
  const done = taken(stage);
  const total = stage.steps.length;
  const upNext = stage.steps.find((step) => !step.done) ?? null;
  const href = (key: string) => `/learn/courses/${courseId}/l/${encodeURIComponent(key)}`;
  const left = stage.steps.reduce((sum, step) => sum + (step.done ? 0 : step.minutes), 0);

  return (
    <Card padding="none">
      <div className="card-pad-x space-y-3 border-b border-border py-4">
        <div className="space-y-1">
          <p className="text-small text-ink-muted [overflow-wrap:anywhere]">
            {stage.after.length === 0
              ? 'Where the course starts'
              : `After ${stage.after.join(' and ')}`}
          </p>
          <h2 className="text-title text-ink [overflow-wrap:anywhere]">{stage.title}</h2>
          <p className="text-body text-ink-muted [overflow-wrap:anywhere]">{stage.about}</p>
        </div>
        <div className="space-y-1.5">
          <Meter value={done} max={total} label={`${done} of ${total} steps done`} moves />
          <p className="tabular text-small text-ink-muted">
            {done} of {total} steps
            {upNext ? ` · ${hours(left)} left` : ' · finished'}
          </p>
        </div>
        {upNext && (
          <Link
            href={href(upNext.key)}
            className={cn(
              buttonVariants({ variant: next || stage.open ? 'primary' : 'secondary', size: 'lg' }),
              'h-auto min-h-11 w-full justify-start py-2.5 sm:w-auto',
            )}
          >
            <Play className="size-4 shrink-0" strokeWidth={1.75} aria-hidden />
            <span className="min-w-0 whitespace-normal text-left [overflow-wrap:anywhere]">
              {done > 0 ? 'Continue' : 'Start'}: {upNext.title}
              <span className="tabular font-normal opacity-80"> · {upNext.minutes} min</span>
            </span>
          </Link>
        )}
        {!stage.open && upNext && (
          <p className="text-small text-ink-muted [overflow-wrap:anywhere]">
            This builds on {stage.after.join(' and ')}, which you have not finished. You can start
            it anyway.
          </p>
        )}
      </div>
      <ol className="divide-y divide-border">
        {stage.steps.map((step, index) => (
          <li key={step.key}>
            <Link
              href={href(step.key)}
              className="card-pad-x row-pad flex min-h-11 items-start gap-3 transition-colors duration-quick hover:bg-sunken"
            >
              <span
                className={cn(
                  'tabular mt-0.5 grid size-5 shrink-0 place-items-center rounded-full text-small',
                  step.done ? 'bg-accent text-fill-ink' : 'text-ink-muted',
                )}
              >
                {step.done ? (
                  <Check className="size-3" strokeWidth={1.75} aria-label="Done" />
                ) : (
                  index + 1
                )}
              </span>
              <span className="min-w-0 flex-1 space-y-0.5">
                <span
                  className={cn(
                    'block text-body [overflow-wrap:anywhere]',
                    step.done ? 'text-ink-muted' : 'font-medium text-ink',
                  )}
                >
                  {step.title}
                </span>
                {step.gain && (
                  <span className="block text-ui text-ink-muted [overflow-wrap:anywhere]">
                    {step.gain}
                  </span>
                )}
                <StepParts step={step} />
              </span>
            </Link>
          </li>
        ))}
      </ol>
    </Card>
  );
}

/** How long a step is and what is in it, as marks: a clip to watch, a drawing, a reading, a question. */
function StepParts({ step }: { step: MapStep }) {
  const parts = [
    step.clips > 0
      ? { Icon: Play, label: step.clips === 1 ? 'a clip' : `${step.clips} clips` }
      : null,
    step.figure ? { Icon: PenLine, label: 'a drawing' } : null,
    step.reading ? { Icon: BookOpen, label: 'a reading' } : null,
    step.check ? { Icon: CircleHelp, label: 'a question' } : null,
  ].filter((part) => part !== null);
  return (
    <span className="flex items-center gap-2 pt-0.5 text-small text-ink-muted">
      <span className="tabular">{step.minutes} min</span>
      <span
        className="flex items-center gap-1.5"
        title={parts.map((part) => part.label).join(', ')}
      >
        {parts.map(({ Icon, label }) => (
          <Icon key={label} className="size-3.5" strokeWidth={1.75} aria-label={label} />
        ))}
      </span>
    </span>
  );
}
