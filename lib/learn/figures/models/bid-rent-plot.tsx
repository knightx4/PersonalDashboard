'use client';

import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from 'recharts';
import { MOTION_MS } from '@/lib/motion';
import type { ModelPlotProps } from './types';
import {
  DISTANCE_MAX,
  RENT_MAX,
  cityEdge,
  envelope,
  km,
  officesEnd,
  type BidRentValues,
} from './bid-rent-curves';

/**
 * The bid-rent plot (plan #2321.8): rent up the side, distance from the
 * centre along the foot, and each use's bid drawn over the land it wins:
 * offices in ink, homes in the accent, farms muted. Dotted guides stand where
 * the land changes use, and a rail line is a thick bar along the foot out to
 * where it ends. Once a slider has moved, the rents where they started stay
 * drawn as faint dashes.
 *
 * Colours are the `--c-*` values read on the plot's own box, as the
 * supply-and-demand plot's are; the legend names each line in words.
 */

const AXIS_TICK = { fill: 'var(--c-ink-muted)', fontSize: 12 };
const RENT_TICKS = [0, 100, 200, 300, 400, 500];
const DISTANCE_TICKS = [0, 10, 20, 30, 40, 50];

function read(values: Record<string, number>): BidRentValues {
  return { commute: values.commute ?? 10, income: values.income ?? 40, rail: values.rail ?? 0 };
}

export function BidRentPlot({ values, from, animate }: ModelPlotProps) {
  const now = read(values);
  const start = read(from);
  const moved =
    now.commute !== start.commute || now.income !== start.income || now.rail !== start.rail;
  const lines = envelope(now);
  const was = envelope(start);
  const end = officesEnd(now);
  const edge = cityEdge(now);
  const motion = { isAnimationActive: animate, animationDuration: MOTION_MS.quick };
  const faint = (data: Array<{ x: number; r: number }>, key: string) => (
    <Line
      key={key}
      data={data}
      dataKey="r"
      stroke="var(--br-faint)"
      strokeWidth={1.5}
      strokeDasharray="4 4"
      dot={false}
      activeDot={false}
      isAnimationActive={false}
    />
  );
  return (
    <div>
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-small text-ink">
        <li className="inline-flex items-center gap-1.5">
          <span aria-hidden className="h-0.5 w-4 rounded-full bg-ink" />
          Offices
        </li>
        <li className="inline-flex items-center gap-1.5">
          <span aria-hidden className="h-0.5 w-4 rounded-full bg-accent" />
          Homes
        </li>
        <li className="inline-flex items-center gap-1.5">
          <span aria-hidden className="h-0.5 w-4 rounded-full bg-ink-muted" />
          Farms
        </li>
        {now.rail > 0 && (
          <li className="inline-flex items-center gap-1.5">
            <span aria-hidden className="h-1 w-4 rounded-full bg-ink-muted" />
            Rail line
          </li>
        )}
        {moved && (
          <li className="inline-flex items-center gap-1.5 text-ink-muted">
            <span aria-hidden className="w-4 border-t-[1.5px] border-dashed border-border-strong" />
            Where rents started
          </li>
        )}
      </ul>
      <div
        role="img"
        aria-label={`Rent falling with distance from the centre: offices to ${km(end)}, homes to ${km(edge)}, farms beyond`}
        className="mt-2 h-56 w-full [--br-faint:var(--c-border-strong)] [--br-homes:var(--c-accent)] [--br-offices:var(--c-ink)] [--br-farms:var(--c-ink-muted)] sm:h-64"
      >
        <ResponsiveContainer width="100%" height="100%">
          <LineChart margin={{ top: 8, right: 12, bottom: 16, left: 4 }}>
            <CartesianGrid stroke="var(--c-border)" strokeDasharray="2 4" />
            <XAxis
              type="number"
              dataKey="x"
              domain={[0, DISTANCE_MAX]}
              ticks={DISTANCE_TICKS}
              tick={AXIS_TICK}
              tickLine={false}
              axisLine={{ stroke: 'var(--c-border)' }}
              tickMargin={6}
              allowDataOverflow
              label={{
                value: 'Distance from the centre, km',
                position: 'insideBottom',
                offset: -12,
                fill: 'var(--c-ink-muted)',
                fontSize: 12,
              }}
            />
            <YAxis
              type="number"
              dataKey="r"
              domain={[0, RENT_MAX]}
              ticks={RENT_TICKS}
              tick={AXIS_TICK}
              tickLine={false}
              axisLine={false}
              width={52}
              allowDataOverflow
              tickFormatter={(value: number) => `£${value}`}
              label={{
                value: 'Rent a m²',
                angle: -90,
                position: 'insideLeft',
                offset: 4,
                fill: 'var(--c-ink-muted)',
                fontSize: 12,
              }}
            />
            {moved && [
              faint(was.offices, 'was-offices'),
              faint(was.homes, 'was-homes'),
              faint(was.farms, 'was-farms'),
            ]}
            <ReferenceLine x={end} stroke="var(--c-ink-muted)" strokeDasharray="2 3" />
            <ReferenceLine x={edge} stroke="var(--c-ink-muted)" strokeDasharray="2 3" />
            {now.rail > 0 && (
              <ReferenceLine
                segment={[
                  { x: 0, y: 6 },
                  { x: now.rail, y: 6 },
                ]}
                stroke="var(--br-farms)"
                strokeWidth={4}
              />
            )}
            <Line
              data={lines.offices}
              dataKey="r"
              name="Offices"
              stroke="var(--br-offices)"
              strokeWidth={2.5}
              dot={false}
              activeDot={false}
              {...motion}
            />
            <Line
              data={lines.homes}
              dataKey="r"
              name="Homes"
              stroke="var(--br-homes)"
              strokeWidth={2.5}
              dot={false}
              activeDot={false}
              {...motion}
            />
            <Line
              data={lines.farms}
              dataKey="r"
              name="Farms"
              stroke="var(--br-farms)"
              strokeWidth={2.5}
              dot={false}
              activeDot={false}
              {...motion}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
