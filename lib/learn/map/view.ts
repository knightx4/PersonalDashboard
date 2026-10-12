import type { KnowledgeState } from '@/lib/learn/graph/model';
import type { Point } from './layout';

/**
 * What the Idea Space page draws, worked out apart from the page (plan #1857)
 * so the gallery and the tests reach it without a database.
 *
 * The page's view state lives in the address (law 5): which layout, what the
 * colour means, whether the field names are on, and which idea is open.
 */

export const SPACE_HREF = '/learn/space';

export type MapLayout = 'neighbours' | 'axes';
export type MapColour = 'state' | 'domain';

export type MapParams = {
  layout: MapLayout;
  colour: MapColour;
  labels: boolean;
  idea: string | null;
};

/**
 * The neighbour map is the default: it pulls each idea towards its six
 * nearest, so groups read as groups. The axes layout is the honest flat
 * projection, and the page says how little of the spread two axes keep.
 */
export const DEFAULT_PARAMS: MapParams = { layout: 'neighbours', colour: 'state', labels: false, idea: null };

type Search = Record<string, string | string[] | undefined>;

function one(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export function parseMapParams(search: Search): MapParams {
  const idea = one(search.idea)?.trim();
  return {
    layout: one(search.layout) === 'axes' ? 'axes' : 'neighbours',
    colour: one(search.colour) === 'domain' ? 'domain' : 'state',
    labels: one(search.labels) === 'on',
    idea: idea ? idea : null,
  };
}

/** The page's address with `change` applied. Defaults are left out of it. */
export function mapHref(params: MapParams, change: Partial<MapParams> = {}): string {
  const next = { ...params, ...change };
  const query = new URLSearchParams();
  if (next.layout !== DEFAULT_PARAMS.layout) query.set('layout', next.layout);
  if (next.colour !== DEFAULT_PARAMS.colour) query.set('colour', next.colour);
  if (next.labels) query.set('labels', 'on');
  if (next.idea) query.set('idea', next.idea);
  const text = query.toString();
  return text ? `${SPACE_HREF}?${text}` : SPACE_HREF;
}

// -- Placing on the frame ----------------------------------------------------

/**
 * The margin kept inside the frame, as a share of its side, so a dot at the
 * edge of the layout is drawn whole and a label beside it has room.
 */
const INSET = 4;

/**
 * A layout point as left and top percentages of a square frame. The layouts
 * fill −1..1; a field projected onto the axes can land outside that square,
 * and is held at its edge in the same direction rather than drawn off the map.
 */
export function framePosition(point: Point): { left: number; top: number } {
  const clamp = (n: number) => Math.max(-1, Math.min(1, n));
  const span = 100 - 2 * INSET;
  return {
    left: INSET + ((clamp(point.x) + 1) / 2) * span,
    top: INSET + ((1 - clamp(point.y)) / 2) * span,
  };
}

/**
 * Which way a label hangs off its point: from its left edge near the left of
 * the frame, from its right edge near the right, centred between, so no
 * label runs past the frame.
 */
export type Anchor = 'start' | 'middle' | 'end';

export function anchorAt(left: number): Anchor {
  if (left < 25) return 'start';
  if (left > 75) return 'end';
  return 'middle';
}

// -- Marks -------------------------------------------------------------------

/**
 * The four states the screen names (components/learn/concept-state.tsx), each
 * with its own shape on the map so the state reads without colour (law 4).
 */
export type StateMark = 'known' | 'getting-there' | 'unseen' | 'mixed-up';

export const STATE_MARKS: readonly StateMark[] = ['known', 'getting-there', 'unseen', 'mixed-up'];

export const STATE_MARK_LABEL: Record<StateMark, string> = {
  known: 'Known',
  'getting-there': 'Getting there',
  unseen: 'Not seen yet',
  'mixed-up': 'Mixed up',
};

export function markOf(state: KnowledgeState): StateMark {
  switch (state) {
    case 'known':
    case 'sharp':
      return 'known';
    case 'recognised':
    case 'shaky':
      return 'getting-there';
    case 'misconception':
      return 'mixed-up';
    default:
      return 'unseen';
  }
}

/**
 * The domain colours, in fixed order, light and dark.
 *
 * Three, because on a scatter every pair of colours sits beside every other,
 * and past three no set of hues stays apart for a reader with red-green
 * colour blindness (checked with the dataviz palette validator, all pairs:
 * worst ΔE 8.1 light, 10.8 dark). The three domains with the most ideas
 * take them; the rest share the muted ink and are counted in the legend.
 * Green, red and amber are left out because each already means something
 * here (law 4). These colours mean "this domain" on this map and nowhere
 * else.
 */
export const DOMAIN_HUES: readonly { light: string; dark: string }[] = [
  { light: '#2a78d6', dark: '#3987e5' },
  { light: '#eb6834', dark: '#d95926' },
  { light: '#c04aa8', dark: '#c04aa8' },
];

/** A hue as CSS that follows the theme's colour scheme. */
export function hueFill(slot: number): string {
  const hue = DOMAIN_HUES[slot]!;
  return `light-dark(${hue.light}, ${hue.dark})`;
}

/**
 * The colour slot of each domain that gets one: the domains with the most
 * ideas on the map, most first, ties by name. A domain with no ideas gets
 * none, since nothing on the map would wear it.
 */
export function domainSlots(domains: readonly { id: string; name: string; ideaCount: number }[]): Map<string, number> {
  const ranked = domains
    .filter((domain) => domain.ideaCount > 0)
    .sort((a, b) => b.ideaCount - a.ideaCount || a.name.localeCompare(b.name));
  return new Map(ranked.slice(0, DOMAIN_HUES.length).map((domain, slot) => [domain.id, slot]));
}

// -- Labels ------------------------------------------------------------------

export type AreaLabel = {
  id: string;
  text: string;
  /** `idea` is the open idea's own name, which every other label gives way to. */
  kind: 'domain' | 'field' | 'idea';
  left: number;
  top: number;
  /** Higher goes down first, and keeps its room when two collide. */
  priority: number;
  /** Drawn this many pixels above its point rather than on it. */
  raise?: number;
};

/** Rough text widths in pixels: 13px semibold for a domain or an idea, 12px for a field. */
const CHAR_PX: Record<AreaLabel['kind'], number> = { domain: 7.4, idea: 7.4, field: 6.4 };
const LINE_PX: Record<AreaLabel['kind'], number> = { domain: 20, idea: 22, field: 18 };
/** The label's padding, either side. */
const PAD_PX = 8;
/** A label is cut short past this, as `max-w-xs` cuts it on the page. */
const MAX_LABEL_PX = 320;

type Box = { left: number; right: number; top: number; bottom: number };

function boxOf(label: AreaLabel, width: number): Box {
  const w = Math.min(label.text.length * CHAR_PX[label.kind] + PAD_PX, MAX_LABEL_PX);
  const h = LINE_PX[label.kind];
  const x = (label.left / 100) * width;
  const y = (label.top / 100) * width - (label.raise ?? 0);
  const anchor = anchorAt(label.left);
  const left = anchor === 'start' ? x : anchor === 'end' ? x - w : x - w / 2;
  return { left, right: left + w, top: y - h / 2, bottom: y + h / 2 };
}

function overlaps(a: Box, b: Box): boolean {
  return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
}

/**
 * The labels that fit a square frame `width` pixels wide without covering
 * one another, highest priority first. A label that would cover one already
 * placed is left off; its point is still marked on the map, and its name is
 * on the point's title.
 */
export function labelsThatFit(labels: readonly AreaLabel[], width: number): Set<string> {
  const placed: Box[] = [];
  const kept = new Set<string>();
  const ordered = [...labels].sort((a, b) => b.priority - a.priority || a.text.localeCompare(b.text));
  for (const label of ordered) {
    const box = boxOf(label, width);
    if (placed.some((other) => overlaps(box, other))) continue;
    placed.push(box);
    kept.add(label.id);
  }
  return kept;
}

/**
 * The two frame widths labels are fitted for: a phone's map, and the
 * narrowest the map is from the `sm` breakpoint up. Fitting for the narrow
 * end of each range means a label that fits there fits everywhere in it.
 */
export const LABEL_FRAMES = { phone: 340, wide: 600 } as const;

/**
 * A cosine similarity to two places, as the duplicate threshold is written
 * (0.86). Not a percentage: it is not a share of anything.
 */
export function similarityText(similarity: number): string {
  return similarity.toFixed(2);
}
