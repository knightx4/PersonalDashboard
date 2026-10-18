'use client';

import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceDot,
  ReferenceLine,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from 'recharts';
import { MOTION_MS } from '@/lib/motion';
import type { ModelPlotProps } from './types';
import {
  PRICE_MAX,
  QUANTITY_MAX,
  demandLine,
  equilibrium,
  pounds,
  supplyLine,
  units,
} from './supply-demand-curves';

/**
 * The supply-and-demand plot (plan #2321.7): price up the side, quantity
 * along the foot, the curve the person moved in the accent and the other in
 * ink, their crossing marked with an accent dot and guides down to each axis. Once either curve has
 * moved, where the two started stays drawn as faint dashes, so the old
 * crossing can be read against the new one.
 *
 * Colours are the `--c-*` values read on the plot's own box, as the chart
 * kind's are (`../kinds/chart-plot.tsx`): the `--color-*` names compute at
 * :root, where the workspace's accent is empty. The legend above names each
 * line in words, so colour is never the only way to tell them apart.
 */

const AXIS_TICK = { fill: 'var(--c-ink-muted)', fontSize: 12 };
const PRICE_TICKS = [0, 3, 6, 9, 12];
const QUANTITY_TICKS = [0, 35, 70, 105, 140];

export function SupplyDemandPlot({ values, from, animate }: ModelPlotProps) {
  const now = { demand: values.demand ?? 0, supply: values.supply ?? 0 };
  const start = { demand: from.demand ?? 0, supply: from.supply ?? 0 };
  const meet = equilibrium(now);
  const demandMoved = now.demand !== start.demand;
  const supplyMoved = now.supply !== start.supply;
  const moved = demandMoved || supplyMoved;
  // The accent goes to the curve the person moved, so the eye follows the
  // change; with neither or both moved, demand keeps it.
  const supplyLit = supplyMoved && !demandMoved;
  const motion = { isAnimationActive: animate, animationDuration: MOTION_MS.quick };
  return (
    <div>
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-small text-ink">
        <li className="inline-flex items-center gap-1.5">
          <span aria-hidden className={`h-0.5 w-4 rounded-full ${supplyLit ? 'bg-ink' : 'bg-accent'}`} />
          Demand
        </li>
        <li className="inline-flex items-center gap-1.5">
          <span aria-hidden className={`h-0.5 w-4 rounded-full ${supplyLit ? 'bg-accent' : 'bg-ink'}`} />
          Supply
        </li>
        {moved && (
          <li className="inline-flex items-center gap-1.5 text-ink-muted">
            <span aria-hidden className="w-4 border-t-[1.5px] border-dashed border-border-strong" />
            Where they started
          </li>
        )}
      </ul>
      <div
        role="img"
        aria-label={`Demand and supply curves crossing at ${pounds(meet.price)} and a quantity of ${units(meet.quantity)}`}
        className="mt-2 h-56 w-full [--sd-faint:var(--c-border-strong)] [--sd-lit:var(--c-accent)] [--sd-plain:var(--c-ink)] sm:h-64"
      >
        <ResponsiveContainer width="100%" height="100%">
          <LineChart margin={{ top: 8, right: 12, bottom: 16, left: 4 }}>
            <CartesianGrid stroke="var(--c-border)" strokeDasharray="2 4" />
            <XAxis
              type="number"
              dataKey="q"
              domain={[0, QUANTITY_MAX]}
              ticks={QUANTITY_TICKS}
              tick={AXIS_TICK}
              tickLine={false}
              axisLine={{ stroke: 'var(--c-border)' }}
              tickMargin={6}
              allowDataOverflow
              label={{
                value: 'Quantity',
                position: 'insideBottom',
                offset: -12,
                fill: 'var(--c-ink-muted)',
                fontSize: 12,
              }}
            />
            <YAxis
              type="number"
              dataKey="p"
              domain={[0, PRICE_MAX]}
              ticks={PRICE_TICKS}
              tick={AXIS_TICK}
              tickLine={false}
              axisLine={false}
              width={52}
              allowDataOverflow
              tickFormatter={(value: number) => `£${value}`}
              label={{
                value: 'Price',
                angle: -90,
                position: 'insideLeft',
                offset: 4,
                fill: 'var(--c-ink-muted)',
                fontSize: 12,
              }}
            />
            {moved && (
              <>
                <Line
                  data={demandLine(start.demand)}
                  dataKey="p"
                  stroke="var(--sd-faint)"
                  strokeWidth={1.5}
                  strokeDasharray="4 4"
                  dot={false}
                  activeDot={false}
                  isAnimationActive={false}
                />
                <Line
                  data={supplyLine(start.supply)}
                  dataKey="p"
                  stroke="var(--sd-faint)"
                  strokeWidth={1.5}
                  strokeDasharray="4 4"
                  dot={false}
                  activeDot={false}
                  isAnimationActive={false}
                />
              </>
            )}
            <Line
              data={demandLine(now.demand)}
              dataKey="p"
              name="Demand"
              stroke={supplyLit ? 'var(--sd-plain)' : 'var(--sd-lit)'}
              strokeWidth={2.5}
              dot={false}
              activeDot={false}
              {...motion}
            />
            <Line
              data={supplyLine(now.supply)}
              dataKey="p"
              name="Supply"
              stroke={supplyLit ? 'var(--sd-lit)' : 'var(--sd-plain)'}
              strokeWidth={2.5}
              dot={false}
              activeDot={false}
              {...motion}
            />
            <ReferenceLine
              segment={[
                { x: meet.quantity, y: 0 },
                { x: meet.quantity, y: meet.price },
              ]}
              stroke="var(--c-ink-muted)"
              strokeDasharray="2 3"
            />
            <ReferenceLine
              segment={[
                { x: 0, y: meet.price },
                { x: meet.quantity, y: meet.price },
              ]}
              stroke="var(--c-ink-muted)"
              strokeDasharray="2 3"
            />
            <ReferenceDot
              x={meet.quantity}
              y={meet.price}
              r={5}
              fill="var(--sd-lit)"
              stroke="var(--c-surface)"
              strokeWidth={2}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
