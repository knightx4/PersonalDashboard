import { z } from 'zod';
import type { FigureKind } from '../types';
import { pickDiagramForm } from '../questions/pick-diagram';
import {
  Arrow,
  type Box,
  DiagramSvg,
  Head,
  LARGE_WIDTH,
  Node,
  PHONE_WIDTH,
  PhoneAndWide,
  WIDE_WIDTH,
  box,
  edgeOf,
  label,
} from './diagram';

/**
 * A flow: steps joined by arrows, left to right with branches, for a process
 * or a cause chain (plan #2321.2). The writer names the steps and which leads
 * to which; each step's column is its distance from the first, so a branch
 * stacks its steps in one column. On a phone the flow runs top to bottom.
 */

export const MAX_FLOW_STEPS = 7;
const MAX_FLOW_COLUMNS = 5;
const MAX_FLOW_PER_COLUMN = 3;
const MAX_STEP_CHARS = 36;

const flowSpec = z
  .object({
    steps: z
      .array(z.object({ id: z.string().trim().min(1).max(24), label: label(MAX_STEP_CHARS) }))
      .min(2)
      .max(MAX_FLOW_STEPS),
    links: z
      .array(z.object({ from: z.string().trim(), to: z.string().trim() }))
      .max(MAX_FLOW_STEPS * 2)
      .optional(),
  })
  .superRefine((spec, ctx) => {
    const ids = spec.steps.map((step) => step.id);
    if (new Set(ids).size !== ids.length) ctx.addIssue({ code: 'custom', message: 'Step ids are unique.', path: ['steps'] });
    for (const link of spec.links ?? []) {
      if (!ids.includes(link.from) || !ids.includes(link.to) || link.from === link.to) {
        ctx.addIssue({ code: 'custom', message: `The link ${link.from} to ${link.to} joins two steps.`, path: ['links'] });
        return;
      }
    }
    const columns = flowColumns(spec);
    if (!columns) {
      ctx.addIssue({ code: 'custom', message: 'A flow has no loop; use cycle for one.', path: ['links'] });
      return;
    }
    if (columns.length > MAX_FLOW_COLUMNS || columns.some((column) => column.length > MAX_FLOW_PER_COLUMN)) {
      ctx.addIssue({
        code: 'custom',
        message: `At most ${MAX_FLOW_COLUMNS} steps in a row and ${MAX_FLOW_PER_COLUMN} side by side.`,
        path: ['links'],
      });
    }
  });

export type FlowSpec = z.infer<typeof flowSpec>;
type Link = { from: string; to: string };

/** The links given, or each step leading to the next when none are. */
function linksOf(spec: Pick<FlowSpec, 'steps' | 'links'>): Link[] {
  if (spec.links && spec.links.length > 0) return spec.links;
  return spec.steps.slice(1).map((step, index) => ({ from: spec.steps[index].id, to: step.id }));
}

/**
 * The steps' ids by column: a step's column is the longest chain of links
 * leading to it. Within a column, steps sit in the order of what leads to
 * them, so lines cross as little as a short flow needs. Null for a loop.
 */
export function flowColumns(spec: Pick<FlowSpec, 'steps' | 'links'>): string[][] | null {
  const ids = spec.steps.map((step) => step.id);
  const links = linksOf(spec);
  const column = new Map<string, number>();
  const visiting = new Set<string>();
  const depth = (id: string): number | null => {
    const known = column.get(id);
    if (known !== undefined) return known;
    if (visiting.has(id)) return null;
    visiting.add(id);
    let best = 0;
    for (const link of links) {
      if (link.to !== id) continue;
      const before = depth(link.from);
      if (before === null) return null;
      best = Math.max(best, before + 1);
    }
    visiting.delete(id);
    column.set(id, best);
    return best;
  };
  for (const id of ids) if (depth(id) === null) return null;
  const columns: string[][] = [];
  for (const id of ids) (columns[column.get(id)!] ??= []).push(id);
  const placed = new Map<string, number>();
  return columns.map((ids) => {
    const meanBefore = (id: string) => {
      const before = links.filter((link) => link.to === id).map((link) => placed.get(link.from) ?? 0);
      return before.length ? before.reduce((sum, n) => sum + n, 0) / before.length : 0;
    };
    const sorted = ids
      .map((id, index) => ({ id, index, at: meanBefore(id) }))
      .sort((a, b) => a.at - b.at || a.index - b.index)
      .map(({ id }) => id);
    sorted.forEach((id, index) => placed.set(id, index));
    return sorted;
  });
}

const GAP_ACROSS = 28;
const GAP_ALONG = 14;

type Layout = { boxes: Map<string, Box>; height: number; width: number; phone: boolean };

/** Columns left to right, a column's steps stacked and centred. */
function wideLayout(spec: FlowSpec, columns: string[][], width: number): Layout {
  const labels = new Map(spec.steps.map((step) => [step.id, step.label]));
  const colWidth = width / columns.length;
  const w = Math.min(200, colWidth - GAP_ACROSS);
  const sized = columns.map((ids) => ids.map((id) => ({ id, ...box(labels.get(id)!, w) })));
  const stackHeight = (col: typeof sized[number]) => col.reduce((sum, b) => sum + b.h, 0) + GAP_ALONG * (col.length - 1);
  const height = Math.max(...sized.map(stackHeight)) + 4;
  const boxes = new Map<string, Box>();
  sized.forEach((col, index) => {
    let y = (height - stackHeight(col)) / 2;
    for (const b of col) {
      boxes.set(b.id, { ...b, x: index * colWidth + (colWidth - w) / 2, y });
      y += b.h + GAP_ALONG;
    }
  });
  return { boxes, height, width, phone: false };
}

/** Where a branch's line runs down, left of the steps it leads to. */
const TRUNK_X = 12;
const BRANCH_INDENT = 28;

/**
 * Top to bottom, one step a row across the width. A column of two or three
 * steps is a branch: its steps are indented under the step before, and one
 * line runs down their left side with an arrow into each.
 */
function phoneLayout(spec: FlowSpec, columns: string[][]): Layout {
  const labels = new Map(spec.steps.map((step) => [step.id, step.label]));
  const boxes = new Map<string, Box>();
  let y = 1;
  for (const ids of columns) {
    const x = ids.length > 1 ? BRANCH_INDENT : 1;
    ids.forEach((id, index) => {
      const b: Box = { ...box(labels.get(id)!, PHONE_WIDTH - x - 1, 3), x, y };
      boxes.set(id, b);
      y += b.h + (index < ids.length - 1 ? 10 : GAP_ACROSS);
    });
  }
  return { boxes, height: y - GAP_ACROSS + 1, width: PHONE_WIDTH, phone: true };
}

function FlowSvg({ spec, layout }: { spec: FlowSpec; layout: Layout }) {
  const { boxes, height, width, phone } = layout;
  return (
    <DiagramSvg width={width} height={height} title={spec.steps.map((step) => step.label).join(', then ')}>
      {linksOf(spec).map((link, index) => {
        const a = boxes.get(link.from)!;
        const b = boxes.get(link.to)!;
        if (phone && b.x > a.x) {
          // Into a branch: down the trunk, then across into the step.
          const top = a.y + a.h;
          const mid = b.y + b.h / 2;
          return (
            <g key={index}>
              <path d={`M ${TRUNK_X} ${top} V ${mid} H ${b.x - 3}`} fill="none" className="stroke-ink-muted" strokeWidth={1.25} />
              <Head x={b.x - 3} y={mid} angle={0} />
            </g>
          );
        }
        if (phone && b.y > a.y) {
          // Straight down to the next step, from under the start of the one before.
          const x = Math.max(a.x, b.x) + Math.min(a.w, b.w) / 2;
          return <Arrow key={index} from={[x, a.y + a.h]} to={[x, b.y]} />;
        }
        const from = edgeOf(a, b.x + b.w / 2, b.y + b.h / 2);
        const to = edgeOf(b, a.x + a.w / 2, a.y + a.h / 2);
        return <Arrow key={index} from={from} to={to} />;
      })}
      {spec.steps.map((step) => (
        <Node key={step.id} b={boxes.get(step.id)!} />
      ))}
    </DiagramSvg>
  );
}

export const flowKind: FigureKind<FlowSpec> = {
  id: 'flow',
  label: 'Flow',
  schema: flowSpec,
  writerLine: `flow: steps joined by arrows, for a process or a chain of causes: how a policy works its way through a market, what happens after a shock. Drawn left to right; a step that leads to two others branches. spec is {"steps": [2 to ${MAX_FLOW_STEPS} of {"id": a short id, "label": the step in at most ${MAX_STEP_CHARS} characters}], "links": [{"from": id, "to": id}, ...]}. Leave links out for a plain chain in the order of steps. No loops (that is a cycle), at most ${MAX_FLOW_COLUMNS} steps from start to end and ${MAX_FLOW_PER_COLUMN} side by side.`,
  example: {
    caption: 'How a new rail line raises the price of land near its stations.',
    spec: {
      steps: [
        { id: 'line', label: 'A rail line opens' },
        { id: 'commute', label: 'Commutes from nearby get shorter' },
        { id: 'bids', label: 'Households bid more for land nearby' },
        { id: 'owners', label: 'Landowners gain' },
        { id: 'renters', label: 'Renters there pay more' },
        { id: 'dense', label: 'Builders put up taller buildings' },
      ],
      links: [
        { from: 'line', to: 'commute' },
        { from: 'commute', to: 'bids' },
        { from: 'bids', to: 'owners' },
        { from: 'bids', to: 'renters' },
        { from: 'bids', to: 'dense' },
      ],
    },
  },
  questions: [
    pickDiagramForm(flowSpec, {
      prompt: 'Which flow shows how a new rail line raises the price of land near its stations?',
      wrong: [
        {
          steps: [
            { id: 'line', label: 'A rail line opens' },
            { id: 'bids', label: 'Households bid more for land nearby' },
            { id: 'commute', label: 'Commutes from nearby get shorter' },
            { id: 'owners', label: 'Landowners gain' },
            { id: 'renters', label: 'Renters there pay more' },
            { id: 'dense', label: 'Builders put up taller buildings' },
          ],
          links: [
            { from: 'line', to: 'bids' },
            { from: 'bids', to: 'commute' },
            { from: 'commute', to: 'owners' },
            { from: 'commute', to: 'renters' },
            { from: 'commute', to: 'dense' },
          ],
        },
        {
          steps: [
            { id: 'line', label: 'A rail line opens' },
            { id: 'commute', label: 'Commutes from nearby get shorter' },
            { id: 'dense', label: 'Builders put up taller buildings' },
            { id: 'bids', label: 'Households bid more for land nearby' },
            { id: 'owners', label: 'Landowners gain' },
            { id: 'renters', label: 'Renters there pay more' },
          ],
          links: [
            { from: 'line', to: 'commute' },
            { from: 'commute', to: 'dense' },
            { from: 'dense', to: 'bids' },
            { from: 'bids', to: 'owners' },
            { from: 'bids', to: 'renters' },
          ],
        },
      ],
    }),
  ],
  Render: ({ spec }) => {
    const columns = flowColumns(spec) ?? [spec.steps.map((step) => step.id)];
    return (
      <PhoneAndWide
        phone={<FlowSvg spec={spec} layout={phoneLayout(spec, columns)} />}
        wide={<FlowSvg spec={spec} layout={wideLayout(spec, columns, WIDE_WIDTH)} />}
        large={<FlowSvg spec={spec} layout={wideLayout(spec, columns, LARGE_WIDTH)} />}
      />
    );
  },
  data: 'none',
};
