import { z } from 'zod';
import type { FigureKind } from '../types';
import { pickDiagramForm } from '../questions/pick-diagram';
import { type Box, DiagramSvg, Head, Lines, Node, box, charsIn, label, wrap } from './diagram';

/**
 * A cycle: stages on a ring, each leading to the next and the last back to
 * the first, for a loop that feeds itself (plan #2321.2). One drawing serves
 * every width: a ring is as tall as it is wide, so it fits a phone as drawn.
 */

export const MAX_CYCLE_STAGES = 6;
const MAX_STAGE_CHARS = 32;

const cycleSpec = z.object({
  stages: z.array(label(MAX_STAGE_CHARS)).min(3).max(MAX_CYCLE_STAGES),
  centre: label(24).optional(),
});

export type CycleSpec = z.infer<typeof cycleSpec>;

/** Boxes narrow for six stages, and the ring is wide enough to leave an arrow between neighbours. */
function ringFor(n: number): { boxW: number; radius: number } {
  const boxW = n >= 6 ? 92 : n === 5 ? 100 : 108;
  return { boxW, radius: Math.max(96, (boxW + 40) / (2 * Math.sin(Math.PI / n))) };
}

/** Where the ring leaves a box, walking from its centre in `step` radians. */
function exitAngle(b: Box, cx: number, cy: number, radius: number, start: number, step: number): number {
  const inside = (angle: number) => {
    const x = cx + radius * Math.cos(angle);
    const y = cy + radius * Math.sin(angle);
    return x >= b.x - 4 && x <= b.x + b.w + 4 && y >= b.y - 4 && y <= b.y + b.h + 4;
  };
  let angle = start;
  for (let i = 0; i < 180 && inside(angle); i++) angle += step;
  return angle;
}

function CycleSvg({ spec }: { spec: CycleSpec }) {
  const n = spec.stages.length;
  const { boxW, radius: RADIUS } = ringFor(n);
  const sized = spec.stages.map((stage) => box(stage, boxW, 4));
  const tallest = Math.max(...sized.map((b) => b.h));
  const WIDTH = 2 * RADIUS + boxW + 4;
  const cx = WIDTH / 2;
  const cy = RADIUS + tallest / 2 + 2;
  const height = 2 * cy;
  const angles = spec.stages.map((_, index) => -Math.PI / 2 + (index * 2 * Math.PI) / n);
  const boxes: Box[] = sized.map((b, index) => ({
    ...b,
    x: cx + RADIUS * Math.cos(angles[index]) - b.w / 2,
    y: cy + RADIUS * Math.sin(angles[index]) - b.h / 2,
  }));
  const step = Math.PI / 180;
  return (
    <DiagramSvg width={WIDTH} height={height} title={`${spec.stages.join(', then ')}, and round again`}>
      {boxes.map((b, index) => {
        const next = (index + 1) % n;
        const start = exitAngle(b, cx, cy, RADIUS, angles[index], step);
        const target = angles[index] + (2 * Math.PI) / n;
        const end = exitAngle(boxes[next], cx, cy, RADIUS, target, -step) - 2 * step;
        if (end <= start) return null;
        const [x1, y1] = [cx + RADIUS * Math.cos(start), cy + RADIUS * Math.sin(start)];
        const [x2, y2] = [cx + RADIUS * Math.cos(end), cy + RADIUS * Math.sin(end)];
        const large = end - start > Math.PI ? 1 : 0;
        return (
          <g key={index}>
            <path
              d={`M ${x1} ${y1} A ${RADIUS} ${RADIUS} 0 ${large} 1 ${x2} ${y2}`}
              fill="none"
              className="stroke-ink-muted"
              strokeWidth={1.25}
            />
            <Head x={x2} y={y2} angle={end + Math.PI / 2} />
          </g>
        );
      })}
      {boxes.map((b, index) => (
        <Node key={index} b={b} />
      ))}
      {spec.centre ? (
        <Lines lines={wrap(spec.centre, charsIn(RADIUS), 2)} x={cx} y={cy} className="fill-ink-muted font-semibold" />
      ) : null}
    </DiagramSvg>
  );
}

export const cycleKind: FigureKind<CycleSpec> = {
  id: 'cycle',
  label: 'Cycle',
  schema: cycleSpec,
  writerLine: `cycle: stages on a ring, each leading to the next and the last back to the first, for a loop that feeds itself: a virtuous or vicious circle, a boom that brings on its own bust. spec is {"stages": [3 to ${MAX_CYCLE_STAGES} stages in order, each at most ${MAX_STAGE_CHARS} characters], "centre": optional name of the loop in at most 24 characters}. A process with an end is a flow.`,
  example: {
    caption: 'Why firms keep clustering in a city that already has many of them.',
    spec: {
      stages: [
        'Firms cluster in the city',
        'A pool of skilled workers forms',
        'Workers and firms match better',
        'Wages and output per worker rise',
        'More firms and workers move in',
      ],
      centre: 'Agglomeration',
    },
  },
  questions: [
    pickDiagramForm(cycleSpec, {
      prompt: 'Which cycle shows why firms keep clustering in a city that already has many of them?',
      wrong: [
        {
          stages: [
            'Firms cluster in the city',
            'Workers and firms match better',
            'A pool of skilled workers forms',
            'Wages and output per worker rise',
            'More firms and workers move in',
          ],
          centre: 'Agglomeration',
        },
        {
          stages: [
            'Firms cluster in the city',
            'More firms and workers move in',
            'Wages and output per worker rise',
            'Workers and firms match better',
            'A pool of skilled workers forms',
          ],
          centre: 'Agglomeration',
        },
      ],
    }),
  ],
  Render: ({ spec }) => <CycleSvg spec={spec} />,
  data: 'none',
};
