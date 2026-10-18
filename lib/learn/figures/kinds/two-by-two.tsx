import { z } from 'zod';
import type { FigureKind } from '../types';
import { pickDiagramForm } from '../questions/pick-diagram';
import { DiagramSvg, LINE, Lines, charsIn, label, wrap } from './diagram';

/**
 * A two-by-two: two axes, each from low to high, splitting the square into
 * four named cells, with things placed on it, for a trade-off between two
 * qualities (plan #2321.2). One drawing serves every width, since the square
 * fits a phone as drawn.
 */

const MAX_ITEMS = 5;
const MAX_CELL_CHARS = 28;
const MAX_ITEM_CHARS = 22;

const axis = z.object({ label: label(24), low: label(14), high: label(14) });
const position = z.number().min(0).max(1);

const twoByTwoSpec = z.object({
  x: axis,
  y: axis,
  cells: z.object({
    top_left: label(MAX_CELL_CHARS),
    top_right: label(MAX_CELL_CHARS),
    bottom_left: label(MAX_CELL_CHARS),
    bottom_right: label(MAX_CELL_CHARS),
  }),
  items: z
    .array(z.object({ label: label(MAX_ITEM_CHARS), x: position, y: position }))
    .max(MAX_ITEMS)
    .optional(),
});

export type TwoByTwoSpec = z.infer<typeof twoByTwoSpec>;

const WIDTH = 340;
/** Room left of the square for the y axis, and under it for the x axis. */
const AXIS_ROOM = 2 * LINE + 6;
const SIDE = WIDTH - AXIS_ROOM - 1;
const PAD = 8;

function TwoByTwoSvg({ spec }: { spec: TwoByTwoSpec }) {
  const left = AXIS_ROOM;
  const top = 1;
  const half = SIDE / 2;
  const perLine = charsIn(half - 2 * PAD);
  const cells = [
    { text: spec.cells.top_left, x: left + PAD, y: top + PAD, align: 'start' as const, fromTop: true },
    { text: spec.cells.top_right, x: left + SIDE - PAD, y: top + PAD, align: 'end' as const, fromTop: true },
    { text: spec.cells.bottom_left, x: left + PAD, y: top + SIDE - PAD, align: 'start' as const, fromTop: false },
    { text: spec.cells.bottom_right, x: left + SIDE - PAD, y: top + SIDE - PAD, align: 'end' as const, fromTop: false },
  ];
  const below = top + SIDE + 4;
  const yMid = top + half;
  const title = `${spec.y.label} against ${spec.x.label}: ${[
    `${spec.y.high} and ${spec.x.low}, ${spec.cells.top_left}`,
    `${spec.y.high} and ${spec.x.high}, ${spec.cells.top_right}`,
    `${spec.y.low} and ${spec.x.low}, ${spec.cells.bottom_left}`,
    `${spec.y.low} and ${spec.x.high}, ${spec.cells.bottom_right}`,
  ].join('; ')}`;
  return (
    <DiagramSvg width={WIDTH} height={below + 2 * LINE + 2} title={title}>
      <rect x={left} y={top} width={SIDE} height={SIDE} rx={6} className="fill-none stroke-border" strokeWidth={1} strokeDasharray="3 3" />
      <line x1={left + half} y1={top} x2={left + half} y2={top + SIDE} className="stroke-border" strokeWidth={1} strokeDasharray="3 3" />
      <line x1={left} y1={top + half} x2={left + SIDE} y2={top + half} className="stroke-border" strokeWidth={1} strokeDasharray="3 3" />
      {cells.map((cell, index) => {
        const lines = wrap(cell.text, perLine, 2);
        const middle = cell.fromTop ? cell.y + (lines.length * LINE) / 2 : cell.y - (lines.length * LINE) / 2;
        return <Lines key={index} lines={lines} x={cell.x} y={middle} align={cell.align} className="fill-ink font-semibold" />;
      })}
      {(spec.items ?? []).map((item, index) => {
        const cx = left + PAD + item.x * (SIDE - 2 * PAD);
        const cy = top + SIDE - PAD - item.y * (SIDE - 2 * PAD);
        const toLeft = item.x > 0.6;
        return (
          <g key={index}>
            <circle cx={cx} cy={cy} r={4} className="fill-accent" />
            <Lines
              lines={wrap(item.label, charsIn(half - 3 * PAD), 2)}
              x={toLeft ? cx - 8 : cx + 8}
              y={cy}
              align={toLeft ? 'end' : 'start'}
              className="fill-ink-muted"
            />
          </g>
        );
      })}
      {/* The x axis: low and high at its ends, its name between. */}
      <Lines lines={[spec.x.low]} x={left} y={below + LINE / 2} align="start" className="fill-ink-muted" />
      <Lines lines={[spec.x.high]} x={left + SIDE} y={below + LINE / 2} align="end" className="fill-ink-muted" />
      <Lines lines={[`${spec.x.label} →`]} x={left + half} y={below + LINE * 1.5} className="fill-ink-muted text-[12px]" />
      {/* The y axis, turned to read upwards. */}
      <g transform={`translate(${LINE / 2 + 1} ${yMid}) rotate(-90)`}>
        <Lines lines={[`${spec.y.label} →`]} x={0} y={0} className="fill-ink-muted text-[12px]" />
      </g>
      <g transform={`translate(${LINE * 1.5 + 3} ${top + SIDE}) rotate(-90)`}>
        <Lines lines={[spec.y.low]} x={0} y={0} align="start" className="fill-ink-muted" />
      </g>
      <g transform={`translate(${LINE * 1.5 + 3} ${top}) rotate(-90)`}>
        <Lines lines={[spec.y.high]} x={0} y={0} align="end" className="fill-ink-muted" />
      </g>
    </DiagramSvg>
  );
}

const TWO_BY_TWO_EXAMPLE: TwoByTwoSpec = {
  x: { label: 'Can be fenced off', low: 'No', high: 'Yes' },
  y: { label: 'Use crowds others out', low: 'No', high: 'Yes' },
  cells: {
    top_left: 'Common resources',
    top_right: 'Private goods',
    bottom_left: 'Public goods',
    bottom_right: 'Club goods',
  },
  items: [
    { label: 'Free street parking', x: 0.2, y: 0.82 },
    { label: 'A flat to rent', x: 0.85, y: 0.88 },
    { label: 'Street lighting', x: 0.15, y: 0.2 },
    { label: 'A toll road', x: 0.82, y: 0.25 },
  ],
};

export const twoByTwoKind: FigureKind<TwoByTwoSpec> = {
  id: 'two_by_two',
  label: 'Quadrant',
  schema: twoByTwoSpec,
  writerLine: `two_by_two: two qualities as axes from low to high, splitting a square into four named cells, with up to ${MAX_ITEMS} things placed on it, for a trade-off or a classification on two questions: rival and excludable goods, cost against benefit. spec is {"x": {"label": the quality across, "low": its low end, "high": its high end}, "y": {the same for the quality upwards}, "cells": {"top_left", "top_right", "bottom_left", "bottom_right": each cell's name in at most ${MAX_CELL_CHARS} characters}, "items": optional [{"label": at most ${MAX_ITEM_CHARS} characters, "x": 0 to 1 from low to high, "y": 0 to 1 from low to high}]}. Top is high y, right is high x.`,
  example: {
    caption: 'Four kinds of goods a city provides, by whether use can be limited and whether one person’s use crowds out another’s.',
    spec: TWO_BY_TWO_EXAMPLE,
  },
  questions: [
    pickDiagramForm(twoByTwoSpec, {
      prompt: 'Which quadrant names the four kinds of goods correctly?',
      wrong: [
        {
          ...TWO_BY_TWO_EXAMPLE,
          cells: { ...TWO_BY_TWO_EXAMPLE.cells, top_left: 'Public goods', bottom_left: 'Common resources' },
        },
        {
          ...TWO_BY_TWO_EXAMPLE,
          cells: { ...TWO_BY_TWO_EXAMPLE.cells, top_right: 'Club goods', bottom_right: 'Private goods' },
        },
      ],
    }),
  ],
  Render: ({ spec }) => <TwoByTwoSvg spec={spec} />,
  data: 'none',
};
