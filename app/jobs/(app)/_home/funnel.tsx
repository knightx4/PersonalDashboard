'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ChevronRight, X } from 'lucide-react';
import { cn } from '@/lib/cn';
import Link from '@/components/ui/link';
import { Card } from '@/components/ui/card';
import { IconButton } from '@/components/ui/icon-button';
import { SectionLabel } from '@/components/ui/section-heading';
import {
  FUNNEL_WINDOW_DAYS,
  STALE_DAYS,
  type FunnelDrop,
  type FunnelFlow,
  type FunnelStage,
  type FunnelStageKey,
  type FunnelView,
} from '@/lib/jobs/home/funnel';
import styles from './funnel.module.css';

/**
 * The funnel at the top of Now (lib/jobs/home/funnel.ts): every role in the
 * search as a bead in its stage's tube, what moved between the stages in the
 * last FUNNEL_WINDOW_DAYS days as bands of light, and what left the search
 * as a stream falling to the floor.
 *
 * Opening a stage widens its tube where it stands into the list of what is
 * in it, and the other tubes narrow to slivers, so the whole search stays in
 * view. Each row opens its role. Nothing here acts on a row: that is the Jobs
 * Inbox's (decision #1937.3).
 *
 * Laptop width draws the tubes; a phone draws the same stages as a column
 * with the bands running down it. Both are rendered and the width picks one,
 * so neither appears late.
 */

const TONE: Record<FunnelStageKey, string> = {
  sourcing: 'var(--c-accent)',
  leads: 'var(--c-status-lead)',
  applied: 'var(--c-status-submitted)',
  traction: 'var(--c-status-process)',
  waiting: 'var(--c-status-final)',
  offers: 'var(--c-status-offer)',
};

type Tone = React.CSSProperties & Record<`--${string}`, string | number>;

function tone(key: FunnelStageKey, extra?: Tone): Tone {
  return { '--tone': TONE[key], ...extra };
}

/** 0 to n - 1, for drawing n of something. */
function times(n: number): number[] {
  return Array.from({ length: Math.max(0, n) }, (_, i) => i);
}

function initials(name: string): string {
  const words = name.trim().split(/\s+/);
  return (words.length > 1 ? words[0]![0]! + words[1]![0]! : name.slice(0, 2)).toUpperCase();
}

function age(days: number | null): string {
  return days === null || days === 0 ? '' : `${days}d`;
}

export function Funnel({ view }: { view: FunnelView }) {
  const [open, setOpen] = useState<FunnelStageKey | null>(null);
  const toggle = (key: FunnelStageKey | null) => setOpen((current) => (current === key ? null : key));

  return (
    <section aria-label="Where the search stands" className="space-y-4">
      <p className="font-display text-title tracking-tight text-ink sm:text-figure sm:leading-tight">
        {view.headline.parts.map((part, i) =>
          part.stage ? (
            <span key={i} className={styles.warm} style={tone(part.stage)}>
              {part.text}
            </span>
          ) : (
            <span key={i}>{part.text}</span>
          ),
        )}
      </p>
      <Card className={cn(styles.stage, 'max-sm:hidden')}>
        <Tubes view={view} open={open} onOpen={toggle} />
      </Card>
      <Card className="sm:hidden">
        <Column view={view} open={open} onOpen={toggle} />
      </Card>
      <p className="flex flex-wrap items-center gap-x-5 gap-y-1 text-small text-ink-muted">
        <span className="inline-flex items-center gap-1.5">
          <span className={styles.dot} style={tone('leads')} aria-hidden />
          one bead per role
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className={cn(styles.dot, styles.beadStale)} aria-hidden />
          {STALE_DAYS} days or more without moving
        </span>
        <span>Bands show the last {FUNNEL_WINDOW_DAYS} days.</span>
      </p>
    </section>
  );
}

// -- laptop width: the tubes --------------------------------------------------

const HEIGHT = 572;
const CY = 262;
const FLOOR = 512;
const COMPACT_W = [96, 88, 80, 72, 64, 58];
const COMPACT_H = [290, 250, 214, 172, 140, 108];
const SLIVER = 44;
const PITCH = 14;

type Box = { x: number; w: number; h: number; top: number };

function layout(width: number, openIndex: number, counts: readonly number[]): Box[] {
  const margin = width < 900 ? 24 : 48;
  const inner = width - 2 * margin;
  const scale = Math.max(0.6, Math.min(1, width / 1200));
  const widths = COMPACT_W.map((w, i) => {
    if (openIndex < 0) return Math.round(w * scale);
    if (i !== openIndex) return SLIVER;
    return Math.round(Math.min(440, inner - 5 * SLIVER - 5 * 56));
  });
  const heights = COMPACT_H.map((h, i) =>
    i === openIndex ? (counts[i] ? Math.max(208, Math.min(360, 112 + counts[i]! * 58)) : 172) : h,
  );
  const gap = (inner - widths.reduce((a, b) => a + b, 0)) / 5;
  let x = margin;
  return widths.map((w, i) => {
    const box = { x, w, h: heights[i]!, top: CY - heights[i]! / 2 };
    x += w + gap;
    return box;
  });
}

function lerp(a: Box, b: Box, t: number): Box {
  return { x: a.x + (b.x - a.x) * t, w: a.w + (b.w - a.w) * t, h: a.h + (b.h - a.h) * t, top: a.top + (b.top - a.top) * t };
}

/** The motion token in milliseconds, which reduced motion sets to nearly nothing. */
function momentMs(): number {
  const raw = getComputedStyle(document.documentElement).getPropertyValue('--motion-moment').trim();
  const value = parseFloat(raw);
  if (!Number.isFinite(value)) return 0;
  return raw.endsWith('ms') ? value : value * 1000;
}

/**
 * The tubes' boxes, eased from where they are to where they are going when a
 * stage opens or closes, and moved at once when the width changes. Easing the
 * numbers rather than the CSS keeps the bands, which are drawn from the boxes,
 * on the tubes in every browser.
 */
function useBoxes(target: Box[], open: FunnelStageKey | null): Box[] {
  const [shown, setShown] = useState(target);
  const current = useRef(target);
  const lastOpen = useRef(open);
  const key = target.map((b) => `${b.x},${b.w},${b.h}`).join(';');

  useEffect(() => {
    const from = current.current;
    const animate = lastOpen.current !== open;
    lastOpen.current = open;
    const duration = animate ? momentMs() * 0.9 : 0;
    if (duration < 16) {
      current.current = target;
      setShown(target);
      return;
    }
    const start = performance.now();
    let frame = 0;
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      const next = from.map((box, i) => lerp(box, target[i]!, eased));
      current.current = next;
      setShown(next);
      if (t < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
    // The key stands for the target; the boxes are new objects every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, open]);

  return shown;
}

function useWidth(fallback: number): [React.RefObject<HTMLDivElement | null>, number] {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(fallback);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      if (el.clientWidth > 0) setWidth(el.clientWidth);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, width];
}

/** How high the liquid stands in a tube holding `count` beads. */
function liquidLevel(count: number, h: number): number {
  if (count === 0) return 0;
  if (count <= 4) return Math.min(h - 12, 24 + count * 36);
  return Math.min(h - 12, Math.ceil(count / 4) * PITCH + 28);
}

function bandWidth(count: number): number {
  return count === 0 ? 0 : Math.round(Math.min(20, 3 + Math.sqrt(count) * 3.4));
}

function Tubes({
  view,
  open,
  onOpen,
}: {
  view: FunnelView;
  open: FunnelStageKey | null;
  onOpen: (key: FunnelStageKey | null) => void;
}) {
  const [ref, width] = useWidth(1104);
  const openIndex = view.stages.findIndex((s) => s.key === open);
  const counts = view.stages.map((s) => s.items.length);
  const boxes = useBoxes(layout(width, openIndex, counts), open);
  const gap = boxes[1]!.x - (boxes[0]!.x + boxes[0]!.w);
  const narrow = openIndex >= 0 || gap < 96;

  // Where a band meets a tube: just under the liquid's surface, or the middle
  // of an opened stage.
  const attach = (i: number, band: number) => {
    const box = boxes[i]!;
    if (i === openIndex) return CY;
    const bottom = box.top + box.h;
    const y = bottom - liquidLevel(counts[i]!, box.h) + band / 2 + 5;
    return Math.max(box.top + band / 2 + 8, Math.min(bottom - band / 2 - 8, y));
  };

  const bands = view.flows.map((flow, i) => {
    const a = boxes[i]!;
    const b = boxes[i + 1]!;
    const w = bandWidth(flow.count);
    const y0 = attach(i, Math.max(w, 2));
    const y1 = attach(i + 1, Math.max(w, 2));
    // Each end starts inside its tube, behind the glass, so the band comes out of the edge.
    const x0 = a.x + a.w - 14;
    const x1 = b.x + 14;
    const m = (a.x + a.w + b.x) / 2;
    return {
      flow,
      w,
      d: `M${x0} ${y0} C${m} ${y0} ${m} ${y1} ${x1} ${y1}`,
      mid: m,
      top: Math.min(y0, y1),
      lit: openIndex < 0 || openIndex === i || openIndex === i + 1,
      labelShown: openIndex < 0 || openIndex === i || openIndex === i + 1,
    };
  });

  const drops = view.drops.map((drop) => {
    const i = view.stages.findIndex((s) => s.key === drop.from);
    const box = boxes[i]!;
    const cx = box.x + box.w / 2;
    const bottom = box.top + box.h;
    return { drop, cx, line: `M${cx} ${bottom + 6} L${cx} ${FLOOR - 10}`, path: `M${cx} ${bottom - 8} L${cx} ${FLOOR - 2}` };
  });

  return (
    <div ref={ref} className={styles.canvas} style={{ height: HEIGHT }}>
      <svg className={styles.svg} width={width} height={HEIGHT} aria-hidden>
        <defs>
          {view.flows.map((flow, i) => (
            <linearGradient key={flow.from} id={`funnel-band-${i}`} x1="0" x2="1" y1="0" y2="0">
              <stop offset="0" stopColor={TONE[view.stages[i]!.key]} />
              <stop offset="1" stopColor={TONE[view.stages[i + 1]!.key]} />
            </linearGradient>
          ))}
          <linearGradient id="funnel-drop" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="var(--c-ink-ghost)" stopOpacity="0.55" />
            <stop offset="1" stopColor="var(--c-ink-ghost)" stopOpacity="0" />
          </linearGradient>
          <filter id="funnel-glow" x="-20%" y="-80%" width="140%" height="260%">
            <feGaussianBlur stdDeviation="7" />
          </filter>
        </defs>
        <line x1={24} x2={width - 24} y1={FLOOR} y2={FLOOR} stroke="var(--c-border)" strokeWidth={1} />
        <g filter="url(#funnel-glow)" fill="none" opacity={0.5}>
          {bands.map((band, i) =>
            band.w > 0 ? <path key={i} d={band.d} stroke={`url(#funnel-band-${i})`} strokeWidth={band.w} /> : null,
          )}
        </g>
        <g fill="none">
          {bands.map((band, i) =>
            band.w > 0 ? (
              <path
                key={i}
                d={band.d}
                stroke={`url(#funnel-band-${i})`}
                strokeWidth={band.w}
                opacity={band.lit ? 0.9 : 0.3}
              />
            ) : (
              <path
                key={i}
                d={band.d}
                stroke={TONE[view.stages[i + 1]!.key]}
                strokeWidth={1.5}
                strokeDasharray="2 6"
                strokeLinecap="round"
                opacity={0.7}
              />
            ),
          )}
          {drops.map(({ drop, cx, line }) => (
            <g key={drop.from}>
              <path d={line} stroke="url(#funnel-drop)" strokeWidth={1.5} strokeLinecap="round" />
              <ellipse cx={cx} cy={FLOOR} rx={14 + Math.min(16, Math.sqrt(drop.count) * 1.6)} ry={2.5} fill="var(--c-ink-ghost)" opacity={0.25} />
            </g>
          ))}
        </g>
      </svg>

      {bands.map((band, i) =>
        times(Math.min(6, Math.ceil(band.flow.count / 4))).map((k, _, all) => (
          <span
            key={`${i}-${k}`}
            className={styles.particle}
            style={tone(view.stages[i]!.key, { offsetPath: `path('${band.d}')`, '--i': k, '--n': all.length })}
            aria-hidden
          />
        )),
      )}
      {drops.map(({ drop, path }) =>
        times(Math.min(5, 2 + Math.floor(drop.count / 25))).map((k, _, all) => (
          <span key={`${drop.from}-${k}`} className={styles.drip} style={{ offsetPath: `path('${path}')`, '--i': k, '--n': all.length } as Tone} aria-hidden />
        )),
      )}

      {bands.map((band, i) => (
        <div
          key={band.flow.from}
          className="pointer-events-none absolute flex w-36 flex-col items-center text-center transition-opacity duration-move"
          style={{ left: band.mid - 72, top: band.top - (band.flow.rate && !narrow ? 50 : 36), opacity: band.labelShown ? 1 : 0 }}
          aria-hidden={!band.labelShown}
        >
          <FlowLabel flow={band.flow} narrow={narrow} last={i === view.flows.length - 1} />
          {band.flow.rate && !narrow && (
            <span className="whitespace-nowrap text-micro" style={{ color: TONE[view.stages[i + 1]!.key] }}>
              {band.flow.rate}
            </span>
          )}
        </div>
      ))}

      {view.stages.map((stage, i) => (
        <TubeView
          key={stage.key}
          stage={stage}
          box={boxes[i]!}
          state={i === openIndex ? 'open' : openIndex >= 0 ? 'sliver' : 'compact'}
          watched={stage.key === 'sourcing' ? view.watched : null}
          onOpen={() => onOpen(stage.key)}
          onClose={() => onOpen(null)}
        />
      ))}

      {drops.map(({ drop, cx }) => (
        <DropLabel key={drop.from} drop={drop} left={Math.max(4, Math.min(width - 228, cx - 112))} />
      ))}
    </div>
  );
}

function FlowLabel({ flow, narrow, last }: { flow: FunnelFlow; narrow: boolean; last: boolean }) {
  if (last && flow.count === 0) {
    return <span className="whitespace-nowrap text-small" style={{ color: TONE.offers }}>the first lands here</span>;
  }
  return (
    <span className="whitespace-nowrap text-ui text-ink-muted">
      <span className="tabular font-semibold text-ink">{flow.count}</span> {narrow ? flow.short : flow.label}
    </span>
  );
}

function DropLabel({ drop, left }: { drop: FunnelDrop; left: number }) {
  return (
    <div className="pointer-events-none absolute flex w-56 flex-col items-center text-center" style={{ left, top: FLOOR + 12 }}>
      <span className="text-ui text-ink-muted">
        <span className="tabular font-semibold text-ink">{drop.count}</span> {drop.label}
      </span>
      {drop.parts && <span className="whitespace-nowrap text-micro text-ink-ghost">{drop.parts}</span>}
    </div>
  );
}

function TubeView({
  stage,
  box,
  state,
  watched,
  onOpen,
  onClose,
}: {
  stage: FunnelStage;
  box: Box;
  state: 'compact' | 'sliver' | 'open';
  watched: number | null;
  onOpen: () => void;
  onClose: () => void;
}) {
  const count = stage.items.length;
  const level = liquidLevel(count, box.h);
  const panelId = `funnel-${stage.key}`;
  const half = `${Math.round(box.w / 2)}px`;

  return (
    <>
      <div
        className="pointer-events-none absolute flex w-36 flex-col items-center text-center transition-opacity duration-move"
        style={{ left: box.x + box.w / 2 - 72, top: box.top - (state === 'sliver' ? 52 : 74), opacity: state === 'open' ? 0 : 1 }}
      >
        <SectionLabel as="span">
          <span style={{ color: TONE[stage.key] }}>{stage.label}</span>
        </SectionLabel>
        <span className={cn('tabular font-display text-ink', state === 'sliver' ? 'text-title' : 'text-figure')}>{count}</span>
      </div>

      <div
        className={cn(styles.tube, state === 'open' && styles.tubeOpen, stage.key === 'offers' && state === 'compact' && styles.breathe)}
        style={tone(stage.key, { left: box.x, top: box.top, width: box.w, height: box.h, '--half': half })}
      >
        {state !== 'open' && (
          <>
            {level > 0 && (
              <>
                <span className={styles.liquid} style={{ height: level }} />
                <span className={styles.meniscus} style={{ bottom: level }} />
              </>
            )}
            {state === 'compact' && <Beads stage={stage} box={box} />}
            {stage.key === 'sourcing' && state === 'compact' && watched !== null && watched > 0 && (
              <>
                <span className="absolute inset-x-0 top-4 text-center text-micro" style={{ color: TONE.sourcing }}>
                  {watched} watched
                </span>
                {[0.3, 0.62, 0.45, 0.72, 0.24, 0.54].map((at, k) => (
                  <span key={k} className={styles.drift} style={{ left: `${at * 100}%`, top: 40 + (k % 3) * 6, '--i': k } as Tone} aria-hidden />
                ))}
              </>
            )}
            <button
              type="button"
              className={styles.hit}
              onClick={onOpen}
              aria-expanded={false}
              aria-controls={panelId}
              aria-label={`Open ${stage.label}, ${count}`}
            />
          </>
        )}
        {state === 'open' && <Panel stage={stage} id={panelId} onClose={onClose} />}
      </div>
    </>
  );
}

function Beads({ stage, box }: { stage: FunnelStage; box: Box }) {
  const count = stage.items.length;
  if (count === 0) return null;
  if (count <= 4) {
    return (
      <>
        {stage.items.map((item, j) => (
          <span
            key={item.id}
            className={cn(styles.chip, item.stale && styles.chipStale)}
            style={{ left: Math.round((box.w - 30) / 2), top: box.h - 18 - 30 - j * 36 }}
            title={item.name}
          >
            {initials(item.name)}
          </span>
        ))}
      </>
    );
  }
  const columns = 4;
  const rows = Math.max(1, Math.floor((box.h - 40) / PITCH));
  const fits = columns * rows;
  const shown = count > fits ? stage.items.slice(0, fits - columns) : stage.items;
  const placed = shown.length;
  const lastRow = Math.floor((placed - 1) / columns);
  const inLast = placed - lastRow * columns;
  const x0 = Math.round((box.w - (columns * PITCH - 4)) / 2);
  return (
    <>
      {shown.map((item, j) => {
        const row = Math.floor(j / columns);
        const shift = row === lastRow ? ((columns - inLast) * PITCH) / 2 : 0;
        return (
          <span
            key={item.id}
            className={cn(styles.bead, item.stale && styles.beadStale)}
            style={{ left: x0 + shift + (j % columns) * PITCH, top: box.h - 28 - row * PITCH }}
            title={item.name}
          />
        );
      })}
      {shown.length < count && (
        <span className={styles.more} style={{ top: box.h - 28 - (lastRow + 1) * PITCH - 4 }}>
          +{count - shown.length}
        </span>
      )}
    </>
  );
}

function Panel({ stage, id, onClose }: { stage: FunnelStage; id: string; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => closeRef.current?.focus({ preventScroll: true }), []);
  const few = stage.items.length <= 4;

  return (
    <div id={id} className="absolute inset-0 flex flex-col gap-2.5 px-4 pb-2 pt-4">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <h3 className="text-body font-semibold" style={{ color: TONE[stage.key] }}>
            {stage.label} · <span className="tabular">{stage.items.length}</span>
          </h3>
          <p className="text-ui text-ink-muted">{stage.note}</p>
        </div>
        <IconButton ref={closeRef} onClick={onClose} label={`Close ${stage.label}`} aria-expanded aria-controls={id}>
          <X strokeWidth={1.75} />
        </IconButton>
      </div>
      <div className={cn(styles.list, !few && styles.listFades, '-mx-2 flex-1 overflow-y-auto px-2 pb-3')}>
        {stage.items.length === 0 ? (
          <p className="border-t border-border pt-3 text-body" style={{ color: TONE[stage.key] }}>
            Nothing here yet.
          </p>
        ) : (
          <ul className="divide-y divide-border border-t border-border">
            {stage.items.map((item) => (
              <li key={item.id}>
                <Link
                  href={item.href}
                  className={cn(styles.row, 'flex min-h-11 items-center gap-2.5 rounded-control px-1.5 py-1.5')}
                >
                  <span className={cn(styles.dot, item.stale && styles.beadStale)} aria-hidden />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-body font-semibold text-ink">{item.name}</span>
                    {item.what && (
                      <span className={cn('text-small text-ink-muted', few ? 'line-clamp-2' : 'truncate')}>{item.what}</span>
                    )}
                  </span>
                  <span className={cn('tabular shrink-0 text-small', item.stale ? 'text-caution' : 'text-ink-muted')}>
                    {age(item.days)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

// -- a phone: the column --------------------------------------------------------

function Column({
  view,
  open,
  onOpen,
}: {
  view: FunnelView;
  open: FunnelStageKey | null;
  onOpen: (key: FunnelStageKey | null) => void;
}) {
  return (
    <ol className="px-3 py-3">
      {view.stages.map((stage, i) => {
        const flow = view.flows[i];
        const next = view.stages[i + 1];
        const drop = view.drops.find((d) => d.from === stage.key);
        const isOpen = open === stage.key;
        const count = stage.items.length;
        const size = count === 0 ? 18 : Math.round(Math.min(34, 14 + Math.sqrt(count) * 3.6));
        return (
          <li key={stage.key} style={tone(stage.key, next ? { '--next': TONE[next.key] } : undefined)}>
            <button
              type="button"
              onClick={() => onOpen(stage.key)}
              aria-expanded={isOpen}
              aria-controls={`funnel-phone-${stage.key}`}
              className="press flex min-h-14 w-full items-center gap-3 rounded-control px-2 text-left transition-colors duration-quick hover:bg-sunken"
            >
              <span className="flex w-10 shrink-0 justify-center">
                <span className={cn(styles.node, count === 0 && styles.nodeEmpty)} style={{ width: size, height: size }} />
              </span>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="text-ui font-semibold" style={{ color: TONE[stage.key] }}>
                  {stage.label}
                </span>
                <span className="truncate text-small text-ink-muted">{stage.note}</span>
              </span>
              <span className="tabular font-display text-title text-ink">{count}</span>
              <ChevronRight
                strokeWidth={1.75}
                className={cn('size-4 shrink-0 text-ink-muted transition-transform duration-quick', isOpen && 'rotate-90')}
              />
            </button>
            {isOpen && count > 0 && (
              <ul id={`funnel-phone-${stage.key}`} className="mb-2 ml-14 divide-y divide-border border-t border-border">
                {stage.items.slice(0, 8).map((item) => (
                  <li key={item.id}>
                    <Link href={item.href} className="flex min-h-11 items-center gap-2 py-1.5">
                      <span className={cn(styles.dot, item.stale && styles.beadStale)} aria-hidden />
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="truncate text-body font-semibold text-ink">{item.name}</span>
                        <span className="truncate text-small text-ink-muted">{item.what}</span>
                      </span>
                      <span className={cn('tabular shrink-0 text-small', item.stale ? 'text-caution' : 'text-ink-muted')}>
                        {age(item.days)}
                      </span>
                    </Link>
                  </li>
                ))}
                {count > 8 && (
                  <li className="py-2 text-small text-ink-muted">and {count - 8} more, in Pipeline</li>
                )}
              </ul>
            )}
            {flow && (
              <div className="flex min-h-16 items-stretch gap-3 px-2">
                <span className="flex w-10 shrink-0 justify-center">
                  <span className={cn(styles.rail, flow.count === 0 && styles.railEmpty)}>
                    {times(Math.min(4, Math.ceil(flow.count / 5))).map((k, _, all) => (
                      <span key={k} className={styles.fall} style={{ '--i': k, '--n': all.length } as Tone} aria-hidden />
                    ))}
                  </span>
                </span>
                <span className="flex flex-1 flex-wrap items-center justify-between gap-x-3 text-ui text-ink-muted">
                  <span>
                    <span className="tabular font-semibold text-ink">{flow.count}</span> {flow.label}
                    {flow.rate && <span className="ml-2 text-small" style={{ color: TONE[next!.key] }}>{flow.rate}</span>}
                  </span>
                  {drop && (
                    <span className="text-small text-ink-ghost">
                      {drop.count} {drop.label}
                    </span>
                  )}
                </span>
              </div>
            )}
          </li>
        );
      })}
    </ol>
  );
}
