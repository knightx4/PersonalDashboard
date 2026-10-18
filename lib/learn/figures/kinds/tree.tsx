import { z } from 'zod';
import type { FigureKind } from '../types';
import { pickDiagramForm } from '../questions/pick-diagram';
import {
  type Box,
  DiagramSvg,
  LARGE_WIDTH,
  LINE,
  Lines,
  Node,
  PHONE_WIDTH,
  PhoneAndWide,
  WIDE_WIDTH,
  box,
  charsIn,
  fitBox,
  label,
  wrap,
} from './diagram';

/**
 * A tree: one thing at the top, its parts beneath it, and their parts
 * beneath them, for a hierarchy or a breakdown (plan #2321.2). Wide, it is
 * drawn top down, each parent centred over its children; on a phone it is an
 * indented outline, since four boxes side by side would not leave a word a
 * line.
 */

const MAX_TREE_CHILDREN = 4;
const MAX_TREE_GRANDCHILDREN = 3;
const MAX_TREE_LEAVES = 6;
const MAX_NODE_CHARS = 32;

const leaf = z.object({ label: label(MAX_NODE_CHARS) });

const treeSpec = z
  .object({
    root: label(MAX_NODE_CHARS),
    children: z
      .array(leaf.extend({ children: z.array(leaf).max(MAX_TREE_GRANDCHILDREN).optional() }))
      .min(2)
      .max(MAX_TREE_CHILDREN),
  })
  .refine((spec) => leafCount(spec) <= MAX_TREE_LEAVES, {
    message: `At most ${MAX_TREE_LEAVES} at the bottom of the tree.`,
    path: ['children'],
  });

export type TreeSpec = z.infer<typeof treeSpec>;

function leafCount(spec: { children: readonly { children?: readonly unknown[] }[] }): number {
  return spec.children.reduce((sum, child) => sum + Math.max(1, child.children?.length ?? 0), 0);
}

type Placed = { b: Box; parent: Box | null; depth: number };

const LEVEL_GAP = 28;
const SIBLING_GAP = 12;

/**
 * Top down: each bottom node gets an equal slot, a parent sits over its
 * slots, and each box is as wide as its label needs within the room it has.
 */
function wideLayout(spec: TreeSpec, width: number): { nodes: Placed[]; height: number } {
  const slot = width / leafCount(spec);
  const leafW = Math.min(200, slot - SIBLING_GAP);
  const root = fitBox(spec.root, Math.min(320, width - 2), 2);
  const rowH = (row: { h: number }[]) => Math.max(0, ...row.map((b) => b.h));
  const kids = spec.children.map((child) => {
    const span = Math.max(1, child.children?.length ?? 0);
    return {
      span,
      b: fitBox(child.label, Math.min(240, span * slot - SIBLING_GAP)),
      grand: (child.children ?? []).map((g) => fitBox(g.label, leafW)),
    };
  });
  const y1 = root.h + LEVEL_GAP;
  const kidsH = rowH(kids.map((k) => k.b));
  const grandH = rowH(kids.flatMap((k) => k.grand));
  const y2 = y1 + kidsH + LEVEL_GAP;
  const rootBox: Box = { ...root, x: (width - root.w) / 2, y: 0 };
  const nodes: Placed[] = [{ b: rootBox, parent: null, depth: 0 }];
  let at = 0;
  for (const { span, b, grand } of kids) {
    const kidBox: Box = { ...b, x: (at + span / 2) * slot - b.w / 2, y: y1 };
    nodes.push({ b: kidBox, parent: rootBox, depth: 1 });
    grand.forEach((gb, index) => {
      nodes.push({ b: { ...gb, x: (at + index + 0.5) * slot - gb.w / 2, y: y2 }, parent: kidBox, depth: 2 });
    });
    at += span;
  }
  return { nodes, height: grandH ? y2 + grandH + 1 : y1 + kidsH + 1 };
}

const INDENT = 20;
const ROW_GAP = 4;

/** An outline: the root in its box, then each part a row of text, indented under its parent. */
function phoneLayout(spec: TreeSpec): { nodes: Placed[]; height: number } {
  const root: Box = { ...box(spec.root, PHONE_WIDTH - 2, 2), x: 1, y: 1 };
  const rows: { text: string; depth: number; parent: number }[] = [];
  spec.children.forEach((child) => {
    rows.push({ text: child.label, depth: 1, parent: 0 });
    const at = rows.length;
    for (const g of child.children ?? []) rows.push({ text: g.label, depth: 2, parent: at });
  });
  const nodes: Placed[] = [{ b: root, parent: null, depth: 0 }];
  let y = root.y + root.h + ROW_GAP;
  for (const row of rows) {
    const x = row.depth * INDENT + 4;
    const lines = wrap(row.text, charsIn(PHONE_WIDTH - x - 12), 2);
    const b: Box = { x, y, w: PHONE_WIDTH - x, h: lines.length * LINE + 8, lines };
    nodes.push({ b, parent: nodes[row.parent].b, depth: row.depth });
    y += b.h + ROW_GAP;
  }
  return { nodes, height: y - ROW_GAP + 1 };
}

function TreeSvg({ spec, width }: { spec: TreeSpec; width: number }) {
  const phone = width === PHONE_WIDTH;
  const { nodes, height } = phone ? phoneLayout(spec) : wideLayout(spec, width);
  const title = `${spec.root}: ${spec.children
    .map((child) => (child.children?.length ? `${child.label} (${child.children.map((g) => g.label).join(', ')})` : child.label))
    .join('; ')}`;
  return (
    <DiagramSvg width={width} height={height} title={title}>
      {nodes.map(({ b, parent, depth }, index) => {
        if (!parent) return null;
        if (!phone) {
          const px = parent.x + parent.w / 2;
          const py = parent.y + parent.h;
          const mid = py + LEVEL_GAP / 2;
          return (
            <path
              key={index}
              d={`M ${px} ${py} V ${mid} H ${b.x + b.w / 2} V ${b.y}`}
              fill="none"
              className="stroke-ink-muted"
              strokeWidth={1.25}
            />
          );
        }
        // Down from under the parent's first letter, then across into the row.
        const px = depth === 1 ? 4 + INDENT / 2 : parent.x + 10;
        const top = depth === 1 ? parent.y + parent.h : parent.y + LINE + 4;
        return (
          <path
            key={index}
            d={`M ${px} ${top} V ${b.y + LINE / 2 + 4} H ${b.x + 4}`}
            fill="none"
            className="stroke-border-strong"
            strokeWidth={1.25}
          />
        );
      })}
      {nodes.map(({ b, depth }, index) =>
        depth === 0 || !phone ? (
          <Node key={index} b={b} strong={depth === 0} align={phone ? 'start' : 'middle'} />
        ) : (
          <Lines key={index} lines={b.lines} x={b.x + 10} y={b.y + b.h / 2} align="start" className="fill-ink" />
        ),
      )}
    </DiagramSvg>
  );
}

export const treeKind: FigureKind<TreeSpec> = {
  id: 'tree',
  label: 'Tree',
  schema: treeSpec,
  writerLine: `tree: one thing at the top and its parts beneath it, two levels down at most, for a hierarchy or a breakdown: the kinds of something, what a total is made of. spec is {"root": the whole in at most ${MAX_NODE_CHARS} characters, "children": [2 to ${MAX_TREE_CHILDREN} of {"label": a part, "children": optional [up to ${MAX_TREE_GRANDCHILDREN} of {"label": a part of that part}]}]}, with at most ${MAX_TREE_LEAVES} at the bottom. Labels at most ${MAX_NODE_CHARS} characters.`,
  example: {
    caption: 'How land is used in a city with one centre, from the middle outwards.',
    spec: {
      root: 'Land in a one-centre city',
      children: [
        { label: 'Central business district', children: [{ label: 'Offices' }, { label: 'Shops' }] },
        { label: 'Residential ring', children: [{ label: 'Flats near the centre' }, { label: 'Houses further out' }] },
        { label: 'Farmland at the edge', children: [{ label: 'Crops and grazing' }] },
      ],
    },
  },
  questions: [
    pickDiagramForm(treeSpec, {
      prompt: 'Which tree shows how land is used in a city with one centre?',
      wrong: [
        {
          root: 'Land in a one-centre city',
          children: [
            { label: 'Central business district', children: [{ label: 'Offices' }, { label: 'Flats near the centre' }] },
            { label: 'Residential ring', children: [{ label: 'Shops' }, { label: 'Houses further out' }] },
            { label: 'Farmland at the edge', children: [{ label: 'Crops and grazing' }] },
          ],
        },
        {
          root: 'Land in a one-centre city',
          children: [
            { label: 'Central business district', children: [{ label: 'Offices' }, { label: 'Shops' }] },
            { label: 'Residential ring', children: [{ label: 'Flats near the centre' }, { label: 'Crops and grazing' }] },
            { label: 'Farmland at the edge', children: [{ label: 'Houses further out' }] },
          ],
        },
      ],
    }),
  ],
  Render: ({ spec }) => (
    <PhoneAndWide
      phone={<TreeSvg spec={spec} width={PHONE_WIDTH} />}
      wide={<TreeSvg spec={spec} width={WIDE_WIDTH} />}
      large={<TreeSvg spec={spec} width={LARGE_WIDTH} />}
    />
  ),
  data: 'none',
};
