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
  OUTPUT_MAX,
  SIZE_MAX,
  curve,
  millions,
  peak,
  thousands,
  type AgglomerationValues,
} from './agglomeration-curves';

/**
 * The agglomeration plot (plan #2321.8): output per worker up the side, the
 * city's size along the foot, the curve in the accent with its peak marked
 * by a dot and guides down to each axis. Once a slider has moved, the curve
 * where it started stays drawn as faint dashes, so the old peak can be read
 * against the new one.
 *
 * Colours are the `--c-*` values read on the plot's own box, as the
 * supply-and-demand plot's are; the legend names each line in words.
 */

const AXIS_TICK = { fill: 'var(--c-ink-muted)', fontSize: 12 };
const OUTPUT_TICKS = [0, 35, 70, 105, 140];
const SIZE_TICKS = [0, 2, 4, 6, 8, 10];

function read(values: Record<string, number>): AgglomerationValues {
  return {
    sharing: values.sharing ?? 3,
    matching: values.matching ?? 3,
    learning: values.learning ?? 3,
    congestion: values.congestion ?? 4.5,
  };
}

export function AgglomerationPlot({ values, from, animate }: ModelPlotProps) {
  const now = read(values);
  const start = read(from);
  const moved = (Object.keys(now) as Array<keyof AgglomerationValues>).some(
    (key) => now[key] !== start[key],
  );
  const top = peak(now);
  const motion = { isAnimationActive: animate, animationDuration: MOTION_MS.quick };
  return (
    <div>
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-small text-ink">
        <li className="inline-flex items-center gap-1.5">
          <span aria-hidden className="h-0.5 w-4 rounded-full bg-accent" />
          Output per worker
        </li>
        <li className="inline-flex items-center gap-1.5">
          <span aria-hidden className="size-2.5 rounded-full bg-accent" />
          Where it peaks
        </li>
        {moved && (
          <li className="inline-flex items-center gap-1.5 text-ink-muted">
            <span aria-hidden className="w-4 border-t-[1.5px] border-dashed border-border-strong" />
            Where it started
          </li>
        )}
      </ul>
      <div
        role="img"
        aria-label={`Output per worker against city size, peaking at ${thousands(top.output)} ${top.past ? `past ${millions(SIZE_MAX)}` : `at ${millions(top.size)}`}`}
        className="mt-2 h-56 w-full [--ag-faint:var(--c-border-strong)] [--ag-lit:var(--c-accent)] sm:h-64"
      >
        <ResponsiveContainer width="100%" height="100%">
          <LineChart margin={{ top: 8, right: 12, bottom: 16, left: 4 }}>
            <CartesianGrid stroke="var(--c-border)" strokeDasharray="2 4" />
            <XAxis
              type="number"
              dataKey="n"
              domain={[0, SIZE_MAX]}
              ticks={SIZE_TICKS}
              tick={AXIS_TICK}
              tickLine={false}
              axisLine={{ stroke: 'var(--c-border)' }}
              tickMargin={6}
              allowDataOverflow
              label={{
                value: 'City size, millions',
                position: 'insideBottom',
                offset: -12,
                fill: 'var(--c-ink-muted)',
                fontSize: 12,
              }}
            />
            <YAxis
              type="number"
              dataKey="y"
              domain={[0, OUTPUT_MAX]}
              ticks={OUTPUT_TICKS}
              tick={AXIS_TICK}
              tickLine={false}
              axisLine={false}
              width={68}
              allowDataOverflow
              tickFormatter={(value: number) => `£${value}k`}
              label={{
                value: 'Per worker',
                angle: -90,
                position: 'insideLeft',
                offset: 4,
                fill: 'var(--c-ink-muted)',
                fontSize: 12,
              }}
            />
            {moved && (
              <Line
                data={curve(start)}
                dataKey="y"
                stroke="var(--ag-faint)"
                strokeWidth={1.5}
                strokeDasharray="4 4"
                dot={false}
                activeDot={false}
                isAnimationActive={false}
              />
            )}
            <Line
              data={curve(now)}
              dataKey="y"
              name="Output per worker"
              stroke="var(--ag-lit)"
              strokeWidth={2.5}
              dot={false}
              activeDot={false}
              {...motion}
            />
            <ReferenceLine
              segment={[
                { x: top.size, y: 0 },
                { x: top.size, y: top.output },
              ]}
              stroke="var(--c-ink-muted)"
              strokeDasharray="2 3"
            />
            <ReferenceLine
              segment={[
                { x: 0, y: top.output },
                { x: top.size, y: top.output },
              ]}
              stroke="var(--c-ink-muted)"
              strokeDasharray="2 3"
            />
            <ReferenceDot
              x={top.size}
              y={top.output}
              r={5}
              fill="var(--ag-lit)"
              stroke="var(--c-surface)"
              strokeWidth={2}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
