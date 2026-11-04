'use client';

import { useState } from 'react';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/cn';
import { formatMoney } from '@/lib/money';
import type { MonthFlow } from '@/lib/finances/spending/model';
import { longMonth, shortMonth, usualSpentShare } from '@/lib/finances/spending/months';

/**
 * Money in against money spent, a pair of bars a month for the last twelve
 * (plan #2593.7). Drawn as the day bars are (components/ui/day-bar-chart.tsx):
 * a baseline in SVG, the bars in HTML over it, and pointing at a month,
 * tapping it or stepping with the arrow keys names it and both amounts
 * underneath, so the reading never rests on height or colour alone. At rest
 * the readout is the latest month. A month with nothing posted says so in
 * the readout and keeps a hollow stub on the baseline.
 *
 * Spent is after refunds; a month whose refunds outweigh its charges draws
 * no spent bar and its readout says how much came back.
 */
export function MonthFlowChart({
  months,
  currency = 'USD',
  heldMonth,
  className,
}: {
  /** Oldest first, every month present. */
  months: readonly MonthFlow[];
  currency?: string;
  /** A month to start with the readout on, as if pointed at. For the gallery. */
  heldMonth?: string;
  className?: string;
}) {
  const held = heldMonth ? months.findIndex((m) => m.month === heldMonth) : -1;
  const [active, setActive] = useState<number | null>(held >= 0 ? held : null);
  const count = months.length;
  const high = Math.max(1, ...months.map((m) => Math.max(m.inCents, m.spentCents)));
  // An empty month is drawn as an empty slot about as tall as a usual
  // month's spending, so it reads as a month with nothing in it rather than
  // as a speck on the baseline.
  const usualShare = usualSpentShare(months, high);
  const shown = months[active ?? count - 1];

  const pick = (event: React.PointerEvent<HTMLDivElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    const at = Math.floor(((event.clientX - box.left) / box.width) * count);
    setActive(Math.min(count - 1, Math.max(0, at)));
  };

  const step = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const by = { ArrowLeft: -1, ArrowRight: 1 }[event.key];
    if (event.key === 'Escape') setActive(null);
    if (!by) return;
    event.preventDefault();
    const from = active ?? count - 1;
    setActive(Math.min(count - 1, Math.max(0, from + by)));
  };

  const money = (cents: number) => formatMoney(cents, currency, { showCents: false });
  const readout = !shown
    ? ''
    : shown.count === 0 && shown.inCents === 0
      ? `${longMonth(shown.month)}: no transactions on your accounts`
      : shown.spentCents < 0
        ? `${longMonth(shown.month)}: ${money(shown.inCents)} in, ${money(-shown.spentCents)} more refunded than spent`
        : `${longMonth(shown.month)}: ${money(shown.inCents)} in, ${money(shown.spentCents)} spent`;

  const label = `Money in and spent each month, ${longMonth(months[0]?.month ?? '')} to ${longMonth(
    months[count - 1]?.month ?? '',
  )}. ${months
    .map((m) => `${shortMonth(m.month)}: ${money(m.inCents)} in, ${money(Math.max(0, m.spentCents))} spent`)
    .join('; ')}.`;

  return (
    <Card padding="standard" className={cn('space-y-3', className)}>
      {/* The tab above names the chart, so the card opens on its legend. */}
      <div className="flex justify-end">
        <p className="flex items-center gap-3 text-small text-ink-muted">
          <span className="flex items-center gap-1.5">
            <span aria-hidden className="size-2.5 rounded-pill bg-ink-ghost" />
            In
          </span>
          <span className="flex items-center gap-1.5">
            <span aria-hidden className="size-2.5 rounded-pill bg-accent" />
            Spent
          </span>
        </p>
      </div>
      <figure className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-2 gap-y-1">
        <div className="tabular flex min-w-12 flex-col justify-between text-right text-small text-ink-muted">
          <span className="-translate-y-1/2">{money(high)}</span>
          <span className="translate-y-1/2">0</span>
        </div>
        <div
          data-month-bars
          tabIndex={0}
          role="img"
          aria-label={label}
          className="relative h-44 min-w-0 cursor-crosshair touch-pan-y rounded-control outline-none focus-visible:ring-2 focus-visible:ring-accent"
          onPointerMove={pick}
          onPointerDown={pick}
          onPointerLeave={(event) => {
            if (event.pointerType === 'mouse') setActive(null);
          }}
          onKeyDown={step}
          onBlur={() => setActive(held >= 0 ? held : null)}
        >
          <svg
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            className="absolute inset-0 size-full overflow-visible"
            aria-hidden
          >
            <line x1={0} x2={100} y1={0} y2={0} className="stroke-border" strokeWidth={1} strokeDasharray="2 3" vectorEffect="non-scaling-stroke" />
            <line x1={0} x2={100} y1={100} y2={100} className="stroke-border-strong" strokeWidth={1} vectorEffect="non-scaling-stroke" />
          </svg>
          <div aria-hidden className="absolute inset-0 flex items-end gap-1 sm:gap-2">
            {months.map((m, index) => {
              const dim = active !== null && index !== active;
              const empty = m.count === 0 && m.inCents === 0;
              return (
                <div
                  key={m.month}
                  className={cn(
                    'flex h-full min-w-0 flex-1 items-end justify-center gap-[2px] rounded-t-control px-[1px]',
                    index === active && 'bg-accent-tint',
                  )}
                >
                  {empty ? (
                    <div
                      data-zero-month
                      className="w-full max-w-10 rounded-t-control border border-b-0 border-dashed border-border-strong" /* ui-ok: an empty month's slot, drawn hollow so zero reads as empty, not a box */
                      style={{ height: `${usualShare * 100}%` }}
                    />
                  ) : (
                    <>
                      <div
                        className={cn(
                          'w-1/2 max-w-5 rounded-t-control bg-ink-ghost transition-opacity duration-quick',
                          dim && 'opacity-45',
                        )}
                        style={{ height: m.inCents > 0 ? `max(2px, ${(m.inCents / high) * 100}%)` : '0' }}
                      />
                      <div
                        className={cn(
                          'w-1/2 max-w-5 rounded-t-control bg-accent transition-opacity duration-quick',
                          dim && 'opacity-45',
                        )}
                        style={{ height: m.spentCents > 0 ? `max(2px, ${(m.spentCents / high) * 100}%)` : '0' }}
                      />
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </div>
        <div className="tabular col-start-2 flex gap-1 text-small text-ink-muted sm:gap-2">
          {months.map((m, index) => (
            <span
              key={m.month}
              className={cn(
                'min-w-0 flex-1 text-center',
                // Every other month on a phone, so the names do not run together.
                index % 2 === (count - 1) % 2 ? '' : 'max-sm:invisible',
              )}
            >
              {shortMonth(m.month)}
            </span>
          ))}
        </div>
        <figcaption aria-live="polite" className="tabular col-start-2 pt-1 text-ui text-ink">
          {readout}
        </figcaption>
      </figure>
    </Card>
  );
}
