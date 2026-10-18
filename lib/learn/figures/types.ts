import type { ComponentType } from 'react';
import type { z } from 'zod';

/**
 * The figure contract (plan #2321.1).
 *
 * A lesson can carry figures: a table, a comparison, and the kinds the later
 * steps of #2321 add. Every kind is one `FigureKind` in the registry
 * (`./registry.ts`), and a lesson stores each figure as a `FigureBlock`, so
 * the writer, the store and the page all go through the registry and none of
 * them names a kind.
 *
 * Adding a kind is one registry entry with a gallery surface named
 * `learn-figure-<id>` (`figureSurface`); the registry test fails a kind that
 * has no surface or whose schema does not parse its own example.
 */

/**
 * Where a kind's content comes from.
 *
 * - `none`: the writer writes all of it (a table, a comparison).
 * - `series`: numbers fetched from a registered data source (plan #2321.3).
 * - `source`: a figure stored with a course, shown under its licence
 *   (plan #2321.4).
 */
export type FigureData = 'none' | 'series' | 'source';

/**
 * One figure as `learn.feed_cards.figures` stores it, in order.
 *
 * `caption` sits outside `spec` so that a block whose kind the app no longer
 * knows, or whose spec no longer parses, still has something to show: its
 * caption alone.
 */
export type FigureBlock = {
  kind: string;
  /** One sentence saying what the figure shows. */
  caption: string;
  /** The kind's own shape, read with its schema when the figure is drawn. */
  spec: unknown;
};

/** What a kind's Render is given: the spec its schema parsed. */
export type FigureRenderProps<Spec> = { spec: Spec };

export type FigureKind<Spec = unknown> = {
  /** Stored in `FigureBlock.kind` and offered to the writer; never renamed once used. */
  id: string;
  /** What the kind is called on the page and in the gallery. */
  label: string;
  /** Parses a block's `spec`. A spec it refuses draws the caption alone. */
  schema: z.ZodType<Spec>;
  /**
   * One paragraph for the lesson writer: when to use the kind and the exact
   * shape of its spec. Joined into the writer's prompt by the registry.
   */
  writerLine: string;
  /** A spec the schema parses, drawn on the kind's gallery surface and checked by the test. */
  example: { caption: string; spec: Spec };
  Render: ComponentType<FigureRenderProps<Spec>>;
  /**
   * How a question is asked on the figure, for the kinds that can carry one
   * (plan #2321.5 gives this its shape and grading). Absent on a kind no
   * question is asked of.
   */
  question?: { writerLine: string };
  data: FigureData;
};

/** The gallery surface every kind is drawn on. */
export function figureSurface(kind: Pick<FigureKind, 'id'>): string {
  return `learn-figure-${kind.id}`;
}
