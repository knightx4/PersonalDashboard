'use client';

import {
  Fragment,
  startTransition,
  useActionState,
  useId,
  useRef,
  useState,
  type ComponentType,
} from 'react';
import { Check, ChevronUp, CircleAlert, Plus } from 'lucide-react';
import { ActionMenu, type ActionMenuItem } from '@/components/ui/action-menu';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { SectionLabel } from '@/components/ui/section-heading';
import { FieldError, InlineInput, Input, Label } from '@/components/ui/field';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { Tooltip } from '@/components/ui/tooltip';
import { useToast } from '@/components/ui/toast';
import { cn } from '@/lib/cn';
import type { TileType } from '@/lib/goals/dashboard';
import {
  countdownWords,
  formatValue,
  type ChartBody,
  type CountdownBody,
  type GridBody,
  type NumberBody,
  type QuickAdd,
  type RoomsBody,
  type SlotsBody,
  type TableBody,
  type TileBody,
  type TileView,
  type TrackerBody,
} from '@/lib/goals/dashboard-tiles';
import { stepHref } from '@/lib/goals/all-goals';
import { formatDay } from '@/lib/goals/dates';
import { VALUE_PREFIX, displayValue } from '@/lib/goals/information';
import { axisLabel, currentLabel } from '@/lib/goals/metric-chart';
import { formatNumber } from '@/lib/money';
import {
  addTileRowAction,
  logTileReadingAction,
  moveTileAction,
  removeTileAction,
  type TileActionState,
} from './dashboard-actions';
import { FieldInput } from './field-input';

/**
 * A goal's dashboard tiles (plan #2778.2). Each tile is a card: its title
 * with a menu (Move earlier, Move later, Remove) shown on hover, focus or
 * always on a phone; then its body, or the line saying what it will show once
 * its source holds something, or the line naming what is missing; then its
 * quick add where its source takes input. The views come from
 * lib/goals/dashboard-tiles.ts, so the gallery and the page draw the same.
 *
 * A body is drawn by the component TILE_BODIES names for its type; plan
 * #2778.3 added the parts, slots, tracker and grid bodies.
 */

/** Small tiles (number, countdown, slots) sit three to a row on a laptop; wide ones take the whole row. */
const WIDE: ReadonlySet<TileType> = new Set(['chart', 'table', 'rooms', 'tracker', 'grid']);

export type TileBodyProps<B extends TileBody = TileBody> = {
  body: B;
  view: TileView;
  goalId: string;
  /** For the gallery: hold a bar's tooltip open, or a part's card pressed open. */
  held?: number;
};

/** The component that draws each type's body. A new type adds its entry here. */
export const TILE_BODIES: Partial<Record<TileType, ComponentType<TileBodyProps>>> = {
  number: NumberTileBody as ComponentType<TileBodyProps>,
  countdown: CountdownTileBody as ComponentType<TileBodyProps>,
  chart: ChartTileBody as ComponentType<TileBodyProps>,
  table: TableTileBody as ComponentType<TileBodyProps>,
  rooms: RoomsTileBody as ComponentType<TileBodyProps>,
  slots: SlotsTileBody as ComponentType<TileBodyProps>,
  tracker: TrackerTileBody as ComponentType<TileBodyProps>,
  grid: GridTileBody as ComponentType<TileBodyProps>,
};

/** The tiles that draw anything, in their saved order. */
function drawnTiles(views: readonly TileView[]): TileView[] {
  return views.filter(
    (view) => view.problem || view.empty || (view.body && TILE_BODIES[view.type]),
  );
}

/**
 * How many tiles open the Dashboard before Dash's card on a phone (plan
 * #2778.4): the small ones at the top and the first wide one after them, as
 * the approved mockup's phone has the figures and the first part before
 * Dash's card and the files.
 */
export function leadTileCount(views: readonly TileView[]): number {
  const drawn = drawnTiles(views);
  const firstWide = drawn.findIndex((view) => WIDE.has(view.type));
  return firstWide === -1 ? drawn.length : firstWide + 1;
}

/**
 * The tiles in their saved order. Number, countdown and slots tiles sit side
 * by side; the rest take the whole row. `part` draws only the lead tiles or
 * the rest (leadTileCount), so the Dashboard can put Dash's card between
 * them on a phone; each tile still knows whether it is first or last of all.
 */
export function DashboardTiles({
  goalId,
  views,
  part,
  seams,
}: {
  goalId: string;
  views: readonly TileView[];
  part?: 'lead' | 'rest';
  /** For the gallery: open one tile's quick add or menu, or hold a tooltip. */
  seams?: { addOpen?: readonly number[]; menuOpen?: number; held?: { tile: number; at: number } };
}) {
  const all = drawnTiles(views);
  const lead = leadTileCount(views);
  const from = part === 'rest' ? lead : 0;
  const drawn = part === 'lead' ? all.slice(0, lead) : all.slice(from);
  if (drawn.length === 0) return null;
  return (
    // Small tiles in a row share its height, as the reference's do.
    // Laid out by the room it has rather than the window (plan #2778.4): on
    // the Dashboard the tiles share the row with Dash’s card and the files.
    <div className="@container">
      <div className="grid grid-cols-1 gap-4 @lg:grid-cols-2 @min-[40rem]:grid-cols-3">
        {drawn.map((view, position) => (
          <DashboardTile
            key={`${view.index}-${view.type}`}
            goalId={goalId}
            view={view}
            first={from + position === 0}
            last={from + position === all.length - 1}
            addOpen={seams?.addOpen?.includes(view.index)}
            menuOpen={seams?.menuOpen === view.index}
            held={seams?.held?.tile === view.index ? seams.held.at : undefined}
          />
        ))}
      </div>
    </div>
  );
}

export function DashboardTile({
  goalId,
  view,
  first,
  last,
  addOpen = false,
  menuOpen = false,
  held,
}: {
  goalId: string;
  view: TileView;
  first: boolean;
  last: boolean;
  addOpen?: boolean;
  menuOpen?: boolean;
  held?: number;
}) {
  const [adding, setAdding] = useState(addOpen);
  const headingId = useId();
  const wide = WIDE.has(view.type);
  const Body = view.body ? TILE_BODIES[view.type] : undefined;

  const add = view.add && !view.problem ? view.add : null;
  // A wide tile carries its add on the heading's line; a small one under its figure.
  const chip =
    add && !adding ? <AddChip label={add.label} onClick={() => setAdding(true)} /> : null;
  const meta = view.problem ? null : headingMeta(view);

  return (
    <Card
      padding="standard"
      aria-labelledby={headingId}
      role="region"
      // A small tile with its quick add open takes the whole row, so its neighbours keep their own height.
      className={cn(
        'group flex min-w-0 flex-col gap-3',
        (wide || (add && adding)) && '@lg:col-span-2 @min-[40rem]:col-span-3',
      )}
    >
      <div className="flex min-w-0 items-center justify-between gap-2">
        <h2
          id={headingId}
          className={cn(
            'min-w-0 [overflow-wrap:anywhere]',
            wide
              ? 'font-display text-body font-semibold text-ink'
              : 'text-micro font-semibold uppercase tracking-wider text-ink-muted',
          )}
        >
          {view.title}
        </h2>
        {meta && (
          <p className="tabular ml-auto min-w-0 text-right text-small text-ink-muted max-sm:hidden">
            {meta}
          </p>
        )}
        <div className={cn('-my-1 flex shrink-0 items-center gap-1', !meta && 'ml-auto')}>
          {wide && chip}
          <TileMenu goalId={goalId} view={view} first={first} last={last} open={menuOpen} />
        </div>
      </div>

      {meta && <p className="tabular -mt-1 text-small text-ink-muted sm:hidden">{meta}</p>}

      {view.problem ? (
        <p role="note" className="flex items-start gap-2 text-ui text-ink-muted">
          <CircleAlert
            className="mt-0.5 size-4 shrink-0 text-caution"
            strokeWidth={1.75}
            aria-hidden
          />
          <span>{view.problem}</span>
        </p>
      ) : view.body && Body ? (
        <Body body={view.body} view={view} goalId={goalId} held={held} />
      ) : (
        <p className="text-ui text-ink-muted">{view.empty}</p>
      )}

      {add && adding && <QuickAddForm goalId={goalId} add={add} onDone={() => setAdding(false)} />}
      {!wide && chip && <div className="mt-auto">{chip}</div>}
    </Card>
  );
}

/**
 * The count a parts or tracker tile sets on its heading's line, as the
 * apartment mockup's card heads do; on a phone it drops under the heading.
 */
function headingMeta(view: TileView): string | null {
  const body = view.body;
  if (body?.type === 'rooms') {
    return `${formatNumber(body.done)} of ${formatNumber(body.total)} steps done · press a card for its open steps`;
  }
  if (body?.type === 'tracker') {
    if (body.done === body.points.length) return `All ${formatNumber(body.points.length)} done`;
    const now = body.points.find((p) => p.state === 'now');
    return `${formatNumber(body.done)} of ${formatNumber(body.points.length)} done${now?.dueOn ? ` · next due ${formatDay(now.dueOn)}` : ''}`;
  }
  return null;
}

/** The quiet add: a small chip with a dashed edge that names what it adds, as the reference draws it. */
function AddChip({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'press inline-flex items-center gap-1 rounded-control border border-dashed border-border-strong px-2 py-0.5' /* ui-ok: a button's dashed edge, the reference's add chip, not a box that groups anything */,
        'text-small text-ink-muted transition-colors duration-quick hover:border-accent hover:text-accent',
      )}
    >
      <Plus className="size-3 shrink-0" strokeWidth={1.75} aria-hidden />
      {label}
    </button>
  );
}

/** Move earlier, Move later, Remove. Shown on hover or focus from a laptop up, always on a phone. */
function TileMenu({
  goalId,
  view,
  first,
  last,
  open,
}: {
  goalId: string;
  view: TileView;
  first: boolean;
  last: boolean;
  open: boolean;
}) {
  const toast = useToast();
  const run = (action: (form: FormData) => Promise<TileActionState>) => async (form: FormData) => {
    const result = await action(form);
    if (result.error) toast({ text: result.error });
  };
  const fields = { goalId, index: String(view.index) };
  const items: ActionMenuItem[] = [
    ...(first
      ? []
      : [
          {
            id: 'earlier',
            label: 'Move earlier',
            formAction: run(moveTileAction),
            formFields: { ...fields, by: '-1' },
          },
        ]),
    ...(last
      ? []
      : [
          {
            id: 'later',
            label: 'Move later',
            formAction: run(moveTileAction),
            formFields: { ...fields, by: '1' },
          },
        ]),
    {
      id: 'remove',
      label: 'Remove',
      destructive: true,
      confirm: 'Remove? What it reads stays',
      formAction: run(removeTileAction),
      formFields: fields,
    },
  ];
  return (
    <div
      className={cn(
        '-mr-1.5 -mt-0.5 shrink-0 transition-opacity duration-quick',
        // Hidden, it takes no room, so an add chip beside it ends on the card's edge.
        !open &&
          'sm:w-0 sm:overflow-hidden sm:opacity-0 sm:group-focus-within:w-auto sm:group-focus-within:opacity-100 sm:group-hover:w-auto sm:group-hover:opacity-100',
      )}
    >
      <ActionMenu label={`${view.title} tile actions`} items={items} defaultOpen={open} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Bodies
// ---------------------------------------------------------------------------

function NumberTileBody({ body }: TileBodyProps<NumberBody>) {
  return (
    <div className="space-y-1">
      <p className="font-display tabular text-figure font-semibold tracking-tight text-ink">
        {body.value}
      </p>
      <p className="text-small text-ink-muted [overflow-wrap:anywhere]">{body.caption}</p>
    </div>
  );
}

function CountdownTileBody({ body }: TileBodyProps<CountdownBody>) {
  return (
    <div className="space-y-1">
      <p className="font-display tabular text-figure font-semibold tracking-tight text-ink">
        <time dateTime={body.date}>{countdownWords(body.days)}</time>
      </p>
      <p className="text-small text-ink-muted [overflow-wrap:anywhere]">{body.caption}</p>
    </div>
  );
}

function ChartTileBody({ body, view, held }: TileBodyProps<ChartBody>) {
  return (
    <div className="space-y-3">
      <p className="tabular flex flex-wrap items-center gap-x-4 gap-y-1 text-small text-ink">
        <span>{body.summary}</span>
        {body.target && (
          <span className="inline-flex items-center gap-1.5 text-ink-muted">
            <span aria-hidden className="w-4 border-t border-dashed border-ink-muted" />
            {body.target.label}
          </span>
        )}
      </p>
      {body.style === 'line' ? (
        <LineChart body={body} title={view.title} />
      ) : (
        <BarChart body={body} title={view.title} held={held} />
      )}
    </div>
  );
}

type Bar = { key: string; label: string; value: number; share: number };

/** The bars and their scale: a metric's periods as the Overview draws them, or a field's readings. */
function barsOf(body: ChartBody): {
  bars: Bar[];
  high: number;
  targetShare: number | null;
  targetHighShare: number | null;
} {
  if (body.bars) {
    return {
      bars: body.bars.bars.map((b, i) => ({
        key: b.startsOn,
        label: body.points[i]?.label ?? b.label,
        value: b.count,
        share: b.share,
      })),
      high: body.bars.high,
      targetShare: body.bars.targetShare,
      targetHighShare: body.bars.targetHighShare,
    };
  }
  const high = Math.max(1, ...body.points.map((p) => p.value));
  return {
    bars: body.points.map((p) => ({
      key: p.on,
      label: p.label,
      value: p.value,
      share: Math.max(0, p.value) / high,
    })),
    high,
    targetShare: null,
    targetHighShare: null,
  };
}

/**
 * Bars on one scale from zero, the latest in full accent with its value
 * above it and the rest lighter. Pointing at or focusing a bar names it in a
 * tooltip; the arrow keys move along them, so the chart is one tab stop. A
 * table holds the same values for a screen reader.
 */
function BarChart({ body, title, held }: { body: ChartBody; title: string; held?: number }) {
  const { bars, high, targetShare, targetHighShare } = barsOf(body);
  const count = bars.length;
  const [focus, setFocus] = useState(Math.max(0, count - 1));
  const [picked, setPicked] = useState<number | null>(held ?? null);
  const refs = useRef<(HTMLSpanElement | null)[]>([]);
  const write = (value: number) => formatValue(body.field, value);
  const line = (bar: Bar) => `${bar.label}: ${write(bar.value)}`;
  const pct = (share: number) => `${share * 100}%`;
  const lastIndex = count - 1;

  const move = (event: React.KeyboardEvent) => {
    const by = { ArrowLeft: -1, ArrowRight: 1, Home: -count, End: count }[event.key];
    if (!by) return;
    event.preventDefault();
    const next = Math.min(count - 1, Math.max(0, focus + by));
    setFocus(next);
    refs.current[next]?.focus();
  };

  const firstLabel =
    body.period && body.bars ? axisLabel(body.period, bars[0].key) : formatDay(bars[0].key);
  const lastLabel = body.period ? currentLabel(body.period) : formatDay(bars[lastIndex].key);

  return (
    <figure className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-2 gap-y-1">
      <div
        aria-hidden
        className="tabular flex min-w-8 flex-col justify-between pt-5 text-right text-small text-ink-muted"
      >
        <span className="-translate-y-1/2">{write(high)}</span>
        <span className="translate-y-1/2">0</span>
      </div>
      <div className="relative h-40 min-w-0 pt-5">
        <div className="relative h-full">
          <div aria-hidden className="absolute inset-x-0 bottom-0 border-t border-border-strong" />
          {targetShare !== null && targetHighShare !== null && (
            <div
              aria-hidden
              className="pointer-events-none absolute inset-x-0 bg-accent/10"
              style={{ bottom: pct(targetShare), height: pct(targetHighShare - targetShare) }}
            />
          )}
          {/* The target sits under the bars, so a bar that reaches it covers the line. */}
          {targetShare !== null && (
            <div
              aria-hidden
              className="pointer-events-none absolute inset-x-0 border-t border-dashed border-border-strong"
              style={{ bottom: pct(targetShare) }}
            />
          )}
          <div
            role="group"
            aria-label={title}
            className="absolute inset-0 flex items-end gap-[2px]"
            onKeyDown={move}
          >
            {bars.map((bar, index) => {
              const latest = index === lastIndex;
              return (
                <Tooltip
                  key={bar.key}
                  label={line(bar)}
                  align={index > count / 2 ? 'end' : 'start'}
                  defaultOpen={held === index}
                  className="h-full min-w-0 flex-1"
                >
                  <span
                    ref={(node) => {
                      refs.current[index] = node;
                    }}
                    tabIndex={index === focus ? 0 : -1}
                    aria-label={line(bar)}
                    onFocus={() => {
                      setFocus(index);
                      setPicked(index);
                    }}
                    onBlur={() => setPicked(null)}
                    onPointerEnter={(event) => {
                      if (event.pointerType === 'mouse') setPicked(index);
                    }}
                    onPointerLeave={(event) => {
                      if (event.pointerType === 'mouse') setPicked(null);
                    }}
                    className="relative flex h-full w-full items-end justify-center rounded-t-control outline-none focus-visible:ring-2 focus-visible:ring-accent"
                  >
                    {latest && (
                      <span
                        aria-hidden
                        className="tabular absolute inset-x-0 text-center text-small font-semibold whitespace-nowrap text-ink"
                        style={{ bottom: `calc(${pct(bar.share)} + 2px)` }}
                      >
                        {write(bar.value)}
                      </span>
                    )}
                    {bar.value === 0 ? (
                      <span
                        className="h-1 w-full max-w-12 rounded-t-control border border-b-0 border-border-strong" /* ui-ok: a zero period's hollow stub on the baseline, a chart mark that groups nothing */
                      />
                    ) : (
                      <span
                        className={cn(
                          'w-full max-w-12 rounded-t-control transition-colors duration-quick',
                          picked === null
                            ? latest
                              ? 'bg-accent'
                              : 'bg-accent/45'
                            : picked === index
                              ? 'bg-accent'
                              : 'bg-accent/25',
                        )}
                        style={{ height: `max(2px, ${pct(bar.share)})` }}
                      />
                    )}
                  </span>
                </Tooltip>
              );
            })}
          </div>
        </div>
      </div>
      <div
        aria-hidden
        className="tabular col-start-2 flex justify-between gap-2 text-small text-ink-muted"
      >
        {count > 1 && <span>{firstLabel}</span>}
        <span className="ml-auto">{lastLabel}</span>
      </div>
      <SeriesTable
        title={title}
        rows={bars.map((b) => ({ key: b.key, label: b.label, value: write(b.value) }))}
        period={body.period}
      />
    </figure>
  );
}

/** A round step for about four gridlines up to `high`: 1, 2, 2.5 or 5 of a power of ten. */
function gridStep(high: number): number {
  if (high <= 0) return 1;
  const rough = high / 4;
  const power = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * power).find((s) => s >= rough) ?? 10 * power;
  return step;
}

/** "$150k", "$1.2m", "40": a gridline's label, short enough for the axis. */
function shortLabel(field: ChartBody['field'], value: number): string {
  const money = field?.type === 'money';
  const sign = money ? '$' : '';
  const tail = field?.type === 'percent' ? '%' : '';
  if (Math.abs(value) >= 1_000_000)
    return `${sign}${formatNumber(value / 1_000_000, { maximumFractionDigits: 1 })}m${tail}`;
  if (Math.abs(value) >= 1_000)
    return `${sign}${formatNumber(value / 1_000, { maximumFractionDigits: 1 })}k${tail}`;
  return `${sign}${formatNumber(value)}${tail}`;
}

const LINE_W = 600;
const LINE_H = 160;

/**
 * A line through the values by date on a scale from zero, so a balance on
 * its way to zero shows how far it has to go, with faint gridlines at round
 * values. The latest point is named under it; pointing along the line picks
 * the nearest point and names that instead.
 */
function LineChart({ body, title }: { body: ChartBody; title: string }) {
  const [active, setActive] = useState<number | null>(null);
  const points = body.points;
  const values = points.map((p) => p.value);
  if (body.target) values.push(body.target.value);
  const low = Math.min(0, ...values);
  const step = gridStep(Math.max(...values) - low);
  const top = Math.ceil(Math.max(...values) / step) * step || step;
  const bottom = low < 0 ? Math.floor(low / step) * step : 0;
  const ticks: number[] = [];
  for (let v = bottom; v <= top + step / 2; v += step) ticks.push(v);

  const DAY = 86_400_000;
  const days = points.map((p) => Date.parse(`${p.on}T00:00:00Z`) / DAY);
  const span = days[days.length - 1] - days[0];
  const x = (i: number) => (span === 0 ? 50 : ((days[i] - days[0]) / span) * 100);
  const y = (v: number) => ((top - v) / (top - bottom)) * 100;
  const path =
    points.length > 1
      ? `M${points.map((p, i) => `${(x(i) / 100) * LINE_W},${(y(p.value) / 100) * LINE_H}`).join('L')}`
      : null;

  const write = (value: number) => formatValue(body.field, value);
  const last = points.length - 1;
  const at = active ?? last;
  const shown = points[at];

  const pick = (event: React.PointerEvent<HTMLDivElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    const share = ((event.clientX - box.left) / box.width) * 100;
    let best = 0;
    points.forEach((_, index) => {
      if (Math.abs(x(index) - share) < Math.abs(x(best) - share)) best = index;
    });
    setActive(best);
  };

  return (
    <figure className="space-y-1">
      <div className="flex gap-2">
        <div
          aria-hidden
          className="tabular relative h-40 w-12 shrink-0 text-right text-small text-ink-muted"
        >
          {ticks.map((tick) => (
            <span
              key={tick}
              className="absolute right-0 -translate-y-1/2"
              style={{ top: `${y(tick)}%` }}
            >
              {shortLabel(body.field, tick)}
            </span>
          ))}
        </div>
        <div
          className="relative h-40 min-w-0 flex-1"
          onPointerMove={pick}
          onPointerDown={pick}
          onPointerLeave={() => setActive(null)}
        >
          {ticks.map((tick) => (
            <div
              key={tick}
              aria-hidden
              className={cn(
                'absolute inset-x-0 border-t',
                tick === 0 ? 'border-border-strong' : 'border-border',
              )}
              style={{ top: `${y(tick)}%` }}
            />
          ))}
          {body.target && (
            <div
              aria-hidden
              className="absolute inset-x-0 border-t border-dashed border-border-strong"
              style={{ top: `${y(body.target.value)}%` }}
            />
          )}
          <svg
            viewBox={`0 0 ${LINE_W} ${LINE_H}`}
            preserveAspectRatio="none"
            className="absolute inset-0 size-full text-accent"
            aria-hidden
          >
            {path && (
              <path
                d={path}
                fill="none"
                stroke="currentColor"
                /* ui-ok: the chart's line, drawn heavier than an icon on purpose */
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
              />
            )}
          </svg>
          {active !== null && (
            <div
              aria-hidden
              className="absolute inset-y-0 border-l border-border-strong"
              style={{ left: `${x(at)}%` }}
            />
          )}
          {points.map((point, index) => (
            <span
              key={point.on}
              aria-hidden
              className={cn(
                'absolute size-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent ring-2 ring-surface',
                index === at && 'size-2.5',
              )}
              style={{ left: `${x(index)}%`, top: `${y(point.value)}%` }}
            />
          ))}
        </div>
      </div>
      <figcaption
        aria-hidden
        className="tabular flex flex-wrap justify-between gap-x-3 pl-14 text-small text-ink-muted"
      >
        <span>{points[0].label}</span>
        <span>
          {shown.label}: {write(shown.value)}
        </span>
      </figcaption>
      <SeriesTable
        title={title}
        rows={points.map((p) => ({ key: p.on, label: p.label, value: write(p.value) }))}
        period={body.period}
      />
    </figure>
  );
}

/** The values a chart draws, for a screen reader. A table ignores sr-only's width, so the box that hides it is a div. */
function SeriesTable({
  title,
  rows,
  period,
}: {
  title: string;
  rows: { key: string; label: string; value: string }[];
  period: ChartBody['period'];
}) {
  return (
    <div className="sr-only">
      <table>
        <caption>{title}</caption>
        <thead>
          <tr>
            <th scope="col">
              {period === 'week' ? 'Week' : period === 'month' ? 'Month' : 'Date'}
            </th>
            <th scope="col">Value</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key}>
              <th scope="row">{row.label}</th>
              <td>{row.value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const NUMERIC = new Set(['number', 'money', 'percent', 'day_of_month']);

/**
 * A list's rows. From a tablet up, a table with each row numbered in the
 * list's order and, beside the first money column, a bar of each row's share
 * of its total. On a phone each row is two lines: its name with the leading
 * figure at the right, and the other values as one muted line under it.
 */
function TableTileBody({ body }: TileBodyProps<TableBody>) {
  const [name, ...rest] = body.columns;
  const money = body.columns.find((c) => c.type === 'money');
  const total = money
    ? body.rows.reduce(
        (sum, r) =>
          sum + (typeof r.data[money.key] === 'number' ? (r.data[money.key] as number) : 0),
        0,
      )
    : 0;
  const lead = money ?? rest.find((c) => NUMERIC.has(c.type));
  const shown = (
    column: (typeof body.columns)[number],
    data: TableBody['rows'][number]['data'],
  ) => {
    const value = data[column.key];
    if (typeof value === 'number' && column.type === 'money') return formatValue(column, value);
    if (column.type === 'date' && typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value))
      return formatDay(value);
    return displayValue(column, value);
  };
  const share = money && total > 0;
  const subline = (data: TableBody['rows'][number]['data']) =>
    rest
      .filter((c) => c !== lead)
      .map((c) => {
        const value = shown(c, data);
        if (!value) return null;
        return NUMERIC.has(c.type) ? value : `${c.label.toLowerCase()} ${value}`;
      })
      .filter(Boolean)
      .join(' · ');

  return (
    <div className="space-y-2">
      <div className="max-md:hidden">
        <Table flush stack={false} fit>
          <THead>
            <tr>
              <TH className="w-8">
                <span className="sr-only">Order</span>
              </TH>
              {body.columns.map((column) => (
                <Fragment key={column.key}>
                  <TH num={NUMERIC.has(column.type)}>{column.label}</TH>
                  {share && column === money && <TH>Share</TH>}
                </Fragment>
              ))}
            </tr>
          </THead>
          <TBody>
            {body.rows.map((row, position) => (
              <TR key={row.id}>
                <TD muted className="tabular w-8 pr-0">
                  {position + 1}
                </TD>
                {body.columns.map((column, index) => (
                  <Fragment key={column.key}>
                    <TD
                      primary={index === 0}
                      num={NUMERIC.has(column.type)}
                      muted={column.type === 'date'}
                    >
                      {shown(column, row.data) || <span className="text-ink-ghost">Not set</span>}
                    </TD>
                    {share && column === money && (
                      <TD>
                        <ShareBar
                          share={
                            typeof row.data[money.key] === 'number'
                              ? (row.data[money.key] as number) / total
                              : 0
                          }
                        />
                      </TD>
                    )}
                  </Fragment>
                ))}
              </TR>
            ))}
          </TBody>
        </Table>
      </div>
      <ul className="divide-y divide-border md:hidden">
        {body.rows.map((row, position) => {
          const under = subline(row.data);
          return (
            <li key={row.id} className="py-2 first:pt-0">
              <div className="flex items-baseline justify-between gap-3">
                <span className="min-w-0 text-ui font-medium text-ink [overflow-wrap:anywhere]">
                  {(name && shown(name, row.data)) || `Row ${position + 1}`}
                </span>
                {lead && (
                  <span className="tabular shrink-0 text-ui text-ink">{shown(lead, row.data)}</span>
                )}
              </div>
              {under && <p className="tabular text-small text-ink-muted">{under}</p>}
            </li>
          );
        })}
      </ul>
      {body.more > 0 && (
        <p className="text-small text-ink-muted">{formatNumber(body.more)} more on the list</p>
      )}
    </div>
  );
}

function ShareBar({ share }: { share: number }) {
  return (
    <span
      aria-label={`${Math.round(share * 100)}% of the total`}
      role="img"
      className="block h-1.5 w-20 overflow-hidden rounded-full bg-sunken"
    >
      <span
        className="block h-full rounded-full bg-accent"
        style={{ width: `${Math.max(0, Math.min(1, share)) * 100}%` }}
      />
    </span>
  );
}

/** Done out of all, as a ring with the percent inside, as the apartment mockup draws a room. */
function Ring({ done, total }: { done: number; total: number }) {
  const share = total > 0 ? done / total : 0;
  const r = 16;
  const around = 2 * Math.PI * r;
  return (
    <span className="relative grid size-11 shrink-0 place-items-center" aria-hidden>
      <svg viewBox="0 0 40 40" className="absolute inset-0 size-full -rotate-90">
        <circle cx="20" cy="20" r={r} fill="none" className="stroke-border" strokeWidth={4} />
        {share > 0 && (
          <circle
            cx="20"
            cy="20"
            r={r}
            fill="none"
            className="stroke-accent"
            strokeWidth={4}
            strokeLinecap="round"
            strokeDasharray={`${(around * share).toFixed(1)} ${around.toFixed(1)}`}
          />
        )}
      </svg>
      {/* A finished part shows a tick, which fits the ring where "100%" would not. */}
      {total > 0 && done === total ? (
        <Check className="relative size-4 text-accent" strokeWidth={2.5} />
      ) : (
        <span className="tabular relative text-micro font-semibold tracking-tight text-ink">
          {Math.round(share * 100)}%
        </span>
      )}
    </span>
  );
}

/**
 * A card per part: its ring, its name, how many of its steps are done and
 * when it last moved, and its next step; a finished part ends at its count.
 * Pressing a card lists its open steps across the whole width under that
 * card's row, so the cards keep their places and heights; the later cards
 * close up beside it (grid-flow-dense). Pressing it again folds them.
 */
function RoomsTileBody({ body, goalId, held }: TileBodyProps<RoomsBody>) {
  const [opened, setOpened] = useState<string | null>(
    held === undefined ? null : (body.parts[held]?.id ?? null),
  );
  const baseId = useId();
  return (
    <ul className="grid grid-flow-row-dense grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {body.parts.map((part) => {
        const open = opened === part.id;
        const listId = `${baseId}-${part.id}`;
        const next = part.open[0];
        const finished = part.total > 0 && part.done === part.total;
        const when = part.lastOn
          ? `last ${formatDay(part.lastOn)}`
          : part.done === 0
            ? 'not started'
            : null;
        return (
          <Fragment key={part.id}>
            <li
              className={cn(
                'min-w-0 rounded-card transition-colors duration-quick',
                // As the reference: a started part on the card colour with a hairline, one not started faintly sunken.
                part.done === 0
                  ? 'bg-sunken/60'
                  : 'border bg-surface' /* ui-ok: a part's card inside its tile, drawn with the reference's hairline since a surface on a surface shows no tone */,
                part.done !== 0 && (open ? 'border-accent' : 'border-border'),
                part.done === 0 && open && 'ring-1 ring-accent',
              )}
            >
              <button
                type="button"
                aria-expanded={open}
                aria-controls={open ? listId : undefined}
                onClick={() => setOpened(open ? null : part.id)}
                className="press grid h-full w-full content-start gap-2 rounded-card p-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                <span className="flex min-w-0 items-center gap-2.5">
                  <Ring done={part.done} total={part.total} />
                  <span className="min-w-0">
                    <span className="block text-body font-semibold leading-tight text-ink [overflow-wrap:anywhere]">
                      {part.title}
                    </span>
                    <span className="tabular block text-small text-ink-muted">
                      {part.done} of {part.total} done{when ? ` · ${when}` : ''}
                    </span>
                  </span>
                  {open && (
                    <ChevronUp
                      aria-hidden
                      strokeWidth={1.75}
                      className="ml-auto size-4 shrink-0 text-ink-muted"
                    />
                  )}
                </span>
                {next && !finished && (
                  <span className="block border-t border-border pt-2 text-ui text-ink">
                    <SectionLabel as="span" className="block">
                      Next
                    </SectionLabel>
                    {next.title}
                  </span>
                )}
              </button>
            </li>
            {open && (
              <li
                id={listId}
                className="col-span-full min-w-0 rounded-card bg-sunken/60 px-3 pt-2 pb-3"
              >
                <SectionLabel
                  count={
                    part.open.length + part.moreOpen === 0
                      ? 'nothing open'
                      : `${part.open.length + part.moreOpen} open`
                  }
                >
                  {part.title}
                </SectionLabel>
                {part.open.length > 0 && (
                  <ol className="mt-1 grid gap-x-6 sm:grid-cols-2 lg:grid-cols-3">
                    {part.open.map((step) => (
                      <li key={step.id} className="border-t border-border py-1.5">
                        {/* The padding, taken back by the margin, makes a 44px press target without moving the line. */}
                        <a
                          href={stepHref(goalId, step.id)}
                          className="-my-3 block py-3 text-ui text-ink hover:text-accent [overflow-wrap:anywhere]"
                        >
                          {step.title}
                        </a>
                        {(step.under || step.blocked || step.dueOn) && (
                          <span className="block text-small text-ink-muted">
                            {[
                              step.under,
                              step.blocked ? 'Blocked' : null,
                              step.dueOn ? `Due ${formatDay(step.dueOn)}` : null,
                            ]
                              .filter(Boolean)
                              .join(' · ')}
                          </span>
                        )}
                      </li>
                    ))}
                  </ol>
                )}
                {part.moreOpen > 0 && (
                  <p className="pt-1 text-small text-ink-muted">
                    and {formatNumber(part.moreOpen)} more on the Plan tab
                  </p>
                )}
              </li>
            )}
          </Fragment>
        );
      })}
    </ul>
  );
}

/** "3 of 10" with a row of slots, the filled ones in accent, and who filled them. */
function SlotsTileBody({ body }: TileBodyProps<SlotsBody>) {
  const filled = Math.min(body.filled.length, body.count);
  return (
    <div className="space-y-2">
      <p className="font-display tabular text-figure font-semibold tracking-tight text-ink">
        {formatNumber(filled)} <span className="text-ink-muted">of {formatNumber(body.count)}</span>
      </p>
      <div
        role="img"
        aria-label={`${filled} of ${body.count} filled`}
        className="grid gap-1"
        style={{ gridTemplateColumns: `repeat(${Math.min(body.count, 10)}, minmax(0, 1fr))` }}
      >
        {Array.from({ length: body.count }, (_, index) => (
          <span
            key={index}
            className={cn('h-2 rounded-full', index < filled ? 'bg-accent' : 'bg-sunken')}
          />
        ))}
      </div>
      <p className="text-small text-ink-muted [overflow-wrap:anywhere]">{body.caption}</p>
    </div>
  );
}

/**
 * Checkpoints in order: done ones filled with a tick and their date, the
 * next one ringed, the rest hollow. Side by side once the tiles are 56rem wide
 * and there are few enough to read across, one under another otherwise.
 */
function TrackerTileBody({ body, goalId }: TileBodyProps<TrackerBody>) {
  const across = body.points.length <= 7;
  const last = body.points.length - 1;
  // The date: when a checkpoint was done, or when the next and later ones are due.
  const dateOf = (point: TrackerBody['points'][number]) =>
    point.state === 'done'
      ? point.closedOn
        ? formatDay(point.closedOn)
        : 'Done'
      : point.dueOn
        ? `due ${formatDay(point.dueOn)}`
        : point.state === 'now'
          ? 'next'
          : '';
  return (
    <div>
      <ol
        className={cn('grid', across ? '@min-[56rem]:auto-cols-fr @min-[56rem]:grid-flow-col' : '')}
      >
        {body.points.map((point, index) => (
          <li
            key={point.id}
            className={cn(
              'relative flex min-w-0 gap-3 pb-4 last:pb-0',
              across &&
                '@min-[56rem]:flex-col @min-[56rem]:gap-2 @min-[56rem]:pr-3 @min-[56rem]:pb-0',
            )}
          >
            {index < last && (
              <>
                <span
                  aria-hidden
                  className={cn(
                    'absolute top-6 bottom-1 left-[9px] w-px',
                    point.state === 'done' ? 'bg-accent' : 'bg-border',
                    across && '@min-[56rem]:hidden',
                  )}
                />
                {across && (
                  <span
                    aria-hidden
                    className={cn(
                      'absolute top-[9px] right-1 left-6 hidden h-px @min-[56rem]:block',
                      point.state === 'done' ? 'bg-accent' : 'bg-border',
                    )}
                  />
                )}
              </>
            )}
            <span
              aria-hidden
              className={cn(
                'relative grid size-[19px] shrink-0 place-items-center rounded-full',
                point.state === 'done' && 'bg-accent text-fill-ink',
                point.state === 'now' && 'border-2 border-accent bg-surface',
                point.state === 'later' && 'border border-border-strong bg-surface',
              )}
            >
              {point.state === 'done' && <Check className="size-3" strokeWidth={2.5} />}
            </span>
            {/* One under another, the date ends the title's line, so the dates line up as the reference's do; read across, it sits under the title. */}
            <span
              className={cn(
                'flex min-w-0 flex-1 items-baseline justify-between gap-3',
                across && '@min-[56rem]:block',
              )}
            >
              <a
                href={stepHref(goalId, point.id)}
                className={cn(
                  // The padding, taken back by the margin, makes a 44px press target without moving the line.
                  '-my-3 min-w-0 py-3 text-ui [overflow-wrap:anywhere] hover:text-accent',
                  across && '@min-[56rem]:block',
                  point.state === 'now'
                    ? 'font-semibold text-ink'
                    : point.state === 'done'
                      ? 'text-ink'
                      : 'text-ink-muted',
                )}
              >
                {point.title}
              </a>
              <span
                className={cn(
                  'tabular shrink-0 text-small text-ink-muted',
                  across && '@min-[56rem]:block',
                  point.state === 'now' && 'text-ink',
                )}
              >
                {dateOf(point) || ' '}
              </span>
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

/** A yes/no value as a mark: a tick for yes, a hollow dot for no. Not a control. */
function Mark({ yes, label }: { yes: boolean; label: string }) {
  return yes ? (
    <span className="inline-flex items-center text-accent">
      <Check className="size-4" strokeWidth={2.25} aria-hidden />
      <span className="sr-only">{label}: yes</span>
    </span>
  ) : (
    <span className="inline-flex items-center">
      <span
        aria-hidden
        className="size-3 rounded-full border border-border-strong" /* ui-ok: a hollow dot marking no, a mark that groups nothing */
      />
      <span className="sr-only">{label}: no</span>
    </span>
  );
}

/**
 * A list's rows by its columns, yes/no ones drawn as marks with how many of
 * the rows are yes under each. On a phone each row is its name and other
 * values, then its marks with their labels.
 */
function GridTileBody({ body }: TileBodyProps<GridBody>) {
  const marks = body.columns.filter((c) => c.type === 'yes_no');
  const others = body.columns.filter((c) => c.type !== 'yes_no');
  const shown = (column: GridBody['columns'][number], data: GridBody['rows'][number]['data']) => {
    const value = data[column.key];
    if (column.type === 'date' && typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value))
      return formatDay(value);
    if (typeof value === 'number' && column.type === 'money') return formatValue(column, value);
    return displayValue(column, value);
  };
  return (
    <div className="space-y-2">
      <div className="max-md:hidden">
        <Table flush stack={false} fit>
          <THead>
            <tr>
              <TH>{body.name?.label ?? 'Row'}</TH>
              {body.columns.map((column) => (
                <TH
                  key={column.key}
                  num={NUMERIC.has(column.type)}
                  className={cn(column.type === 'yes_no' && 'text-center')}
                >
                  {column.label}
                </TH>
              ))}
            </tr>
          </THead>
          <TBody>
            {body.rows.map((row) => (
              <TR key={row.id}>
                <TD primary>{row.name}</TD>
                {body.columns.map((column) => (
                  <TD
                    key={column.key}
                    num={NUMERIC.has(column.type)}
                    muted={column.type === 'date'}
                    className={cn(column.type === 'yes_no' && 'text-center')}
                  >
                    {column.type === 'yes_no' ? (
                      <Mark yes={row.data[column.key] === true} label={column.label} />
                    ) : (
                      shown(column, row.data) || <span className="text-ink-ghost">Not set</span>
                    )}
                  </TD>
                ))}
              </TR>
            ))}
            {marks.length > 0 && (
              <TR>
                <TD muted className="text-small">
                  Done
                </TD>
                {body.columns.map((column) => (
                  <TD
                    key={column.key}
                    muted
                    className={cn('tabular text-small', column.type === 'yes_no' && 'text-center')}
                  >
                    {column.type === 'yes_no'
                      ? `${body.totals[column.key] ?? 0} of ${body.of}`
                      : null}
                  </TD>
                ))}
              </TR>
            )}
          </TBody>
        </Table>
      </div>
      <ul className="divide-y divide-border md:hidden">
        {body.rows.map((row) => {
          // A date ends the name's line as a plain date; the other values go under it.
          const date = others.find((c) => c.type === 'date');
          const under = others
            .filter((c) => c !== date)
            .map((c) => {
              const value = shown(c, row.data);
              return value ? `${c.label.toLowerCase()} ${value}` : null;
            })
            .filter(Boolean)
            .join(' · ');
          const on = date ? shown(date, row.data) : '';
          return (
            <li key={row.id} className="space-y-1 py-2 first:pt-0">
              <p className="flex items-baseline justify-between gap-3">
                <span className="min-w-0 text-ui font-medium text-ink [overflow-wrap:anywhere]">
                  {row.name}
                </span>
                {on && (
                  <span className="tabular shrink-0 text-small text-ink-muted">
                    <span className="sr-only">{date?.label} </span>
                    {on}
                  </span>
                )}
              </p>
              {under && <p className="tabular text-small text-ink-muted">{under}</p>}
              {marks.length > 0 && (
                <p className="flex flex-wrap gap-x-3 gap-y-1">
                  {marks.map((c) => {
                    const yes = row.data[c.key] === true;
                    return (
                      <span
                        key={c.key}
                        className={cn(
                          'inline-flex items-center gap-1 text-small',
                          yes ? 'text-ink' : 'text-ink-muted',
                        )}
                      >
                        <Mark yes={yes} label={c.label} />
                        <span aria-hidden>{c.label}</span>
                      </span>
                    );
                  })}
                </p>
              )}
            </li>
          );
        })}
      </ul>
      {(body.more > 0 || (marks.length > 0 && body.rows.length > 0)) && (
        <p className="tabular flex flex-wrap gap-x-3 text-small text-ink-muted md:hidden">
          {marks.map((c) => (
            <span key={c.key} className="whitespace-nowrap">
              {c.label} {body.totals[c.key] ?? 0} of {body.of}
            </span>
          ))}
        </p>
      )}
      {body.more > 0 && (
        <p className="text-small text-ink-muted">{formatNumber(body.more)} more on the list</p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Quick add
// ---------------------------------------------------------------------------

const initial: TileActionState = {};

/**
 * The quick add, open in its card: a new row's fields in one compact row, or
 * each row's value to type over. Escape or Cancel closes it.
 */
function QuickAddForm({
  goalId,
  add,
  onDone,
}: {
  goalId: string;
  add: QuickAdd;
  onDone: () => void;
}) {
  const id = useId();
  const [state, save, saving] = useActionState(async (prev: TileActionState, form: FormData) => {
    const result =
      add.kind === 'row'
        ? await addTileRowAction(prev, form)
        : await logTileReadingAction(prev, form);
    if (!result.error) startTransition(onDone);
    return result;
  }, initial);

  return (
    <form
      action={save}
      aria-label={add.kind === 'row' ? `Add to ${add.listName}` : `${add.label} on ${add.listName}`}
      className="space-y-2.5 border-t border-border pt-3"
      onKeyDown={(event) => {
        if (event.key === 'Escape') onDone();
      }}
    >
      <input type="hidden" name="goalId" value={goalId} />
      <input type="hidden" name="listId" value={add.listId} />
      {add.kind === 'row' ? <RowFields id={id} add={add} /> : <ReadingFields id={id} add={add} />}
      {state.error && <FieldError>{state.error}</FieldError>}
      <div className="flex items-center gap-2">
        <Button type="submit" size="sm" pending={saving}>
          {saving ? 'Saving…' : add.kind === 'row' ? 'Add' : add.label}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onDone} disabled={saving}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

/** The types typed into a plain box, which can carry their name as a placeholder. */
const TYPED = new Set(['text', 'number', 'money', 'percent', 'day_of_month', 'link', 'date']);

/** A new row's fields side by side, each named by its placeholder, as a row of the list would read. */
function RowFields({ id, add }: { id: string; add: Extract<QuickAdd, { kind: 'row' }> }) {
  return (
    <div
      className={cn('grid grid-cols-2 gap-2', add.fields.length >= 3 && 'md:grid-cols-4')}
      ref={(node) => {
        node?.querySelector<HTMLElement>('input, select')?.focus({ preventScroll: true });
      }}
    >
      {add.fields.map((field, index) => (
        <div
          key={field.key}
          className={cn(index === 0 && add.fields.length % 2 === 1 && 'max-md:col-span-2')}
        >
          <Label htmlFor={`${id}-${field.key}`} className="sr-only">
            {field.label}
          </Label>
          {TYPED.has(field.type) ? (
            <Input
              id={`${id}-${field.key}`}
              name={`${VALUE_PREFIX}${field.key}`}
              placeholder={field.label}
              autoComplete="off"
              inputMode={
                field.type === 'text' || field.type === 'date'
                  ? undefined
                  : field.type === 'link'
                    ? 'url'
                    : 'decimal'
              }
              // A date box shows its name until it is used, then the browser's date picker.
              onFocus={
                field.type === 'date' ? (event) => (event.currentTarget.type = 'date') : undefined
              }
              /* ui-ok: a 44px touch target on a phone, where the quick add is typed with a thumb */
              className={cn('max-sm:h-11', NUMERIC.has(field.type) && 'tabular')}
            />
          ) : (
            <FieldInput id={`${id}-${field.key}`} field={field} value={undefined} />
          )}
        </div>
      ))}
    </div>
  );
}

/**
 * Each row with its value now, to type over in place (law 12). Only the
 * values changed are logged.
 */
function ReadingFields({ id, add }: { id: string; add: Extract<QuickAdd, { kind: 'reading' }> }) {
  return (
    // Kept to a readable width, so each name stays near its value on a wide card.
    <ul className="max-w-xl divide-y divide-border">
      <input type="hidden" name="field" value={add.field.key} />
      {add.rows.map((row, index) => (
        <li key={row.id} className="flex items-center justify-between gap-3 py-1.5 first:pt-0">
          <label
            htmlFor={`${id}-${row.id}`}
            className="min-w-0 text-ui text-ink [overflow-wrap:anywhere]"
          >
            {row.name}
          </label>
          <InlineInput
            id={`${id}-${row.id}`}
            name={`value:${row.id}`}
            defaultValue={row.input}
            inputMode="decimal"
            autoComplete="off"
            aria-label={`${add.field.label} of ${row.name}, now ${row.value || 'not set'}`}
            /* ui-ok: a 44px touch target on a phone, where the quick add is typed with a thumb */
            className="tabular w-32 shrink-0 text-right max-sm:h-11"
            // The form opens because the person asked for it.
            autoFocus={index === 0}
          />
        </li>
      ))}
    </ul>
  );
}
