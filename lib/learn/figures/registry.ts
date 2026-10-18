import type { FigureBlock, FigureKind } from './types';
import { compareKind } from './kinds/compare';
import { tableKind } from './kinds/table';
import { sourceFigureKind } from './kinds/source-figure';
import { chartKind } from './kinds/chart';

/**
 * Every figure kind a lesson can carry (plan #2321.1), and the reads that go
 * through them. The writer's prompt and tool, the store and the page all
 * read this list, so a kind added here reaches all three.
 */

export const FIGURE_KINDS: readonly FigureKind[] = [tableKind, compareKind, chartKind, sourceFigureKind] as unknown as readonly FigureKind[];

/** At most this many figures on one lesson: a lesson teaches one idea, and an idea gets one figure. */
export const MAX_FIGURES_PER_LESSON = 1;

const MAX_CAPTION_CHARS = 200;

export function figureKind(id: string): FigureKind | null {
  return FIGURE_KINDS.find((kind) => kind.id === id) ?? null;
}

/** The kinds' ids, for the writer tool's enum. */
export function figureKindIds(): string[] {
  return FIGURE_KINDS.map((kind) => kind.id);
}

/** The kinds' writer lines, one paragraph each, for the writer's prompt. */
export function figureWriterLines(): string {
  return FIGURE_KINDS.map((kind) => `- ${kind.writerLine}`).join('\n');
}

function caption(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
}

/**
 * The figures a lesson row stores, as the page reads them. Keeps every block
 * with a kind and a caption, known or not, and leaves the spec unparsed:
 * `parseFigure` decides what draws.
 */
export function readStoredFigures(value: unknown): FigureBlock[] {
  if (!Array.isArray(value)) return [];
  const blocks: FigureBlock[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const { kind, caption: text, spec } = item as Record<string, unknown>;
    const said = caption(text);
    if (typeof kind !== 'string' || !said) continue;
    blocks.push({ kind, caption: said, spec: spec ?? null });
  }
  return blocks;
}

/**
 * The figures the writer reported, kept only when each is a known kind whose
 * spec parses, up to `MAX_FIGURES_PER_LESSON`. A figure that fails is left
 * off and the lesson is served without it: a bad table is no reason to drop
 * the lesson.
 */
export function readWrittenFigures(value: unknown): FigureBlock[] {
  if (!Array.isArray(value)) return [];
  const blocks: FigureBlock[] = [];
  for (const item of value) {
    if (blocks.length >= MAX_FIGURES_PER_LESSON) break;
    if (!item || typeof item !== 'object') continue;
    const { kind: id, caption: text, spec } = item as Record<string, unknown>;
    const kind = typeof id === 'string' ? figureKind(id) : null;
    const said = caption(text);
    if (!kind || !said || said.length > MAX_CAPTION_CHARS) continue;
    const parsed = kind.schema.safeParse(spec);
    if (!parsed.success) continue;
    blocks.push({ kind: kind.id, caption: said, spec: parsed.data });
  }
  return blocks;
}

/** A block ready to draw: its kind and its parsed spec, or null when only the caption can show. */
export function parseFigure(block: FigureBlock): { kind: FigureKind; spec: unknown } | null {
  const kind = figureKind(block.kind);
  if (!kind) return null;
  const parsed = kind.schema.safeParse(block.spec);
  return parsed.success ? { kind, spec: parsed.data } : null;
}
