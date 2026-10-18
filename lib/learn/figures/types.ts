import type { ComponentType } from 'react';
import type { z } from 'zod';
import type { PlaceLoader } from './places';
import type { SeriesLoader } from './series-store';

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
 * - `places`: places the writer names, located by a registered geocoder
 *   (plan #2321.6).
 * - `wanted`: nothing to draw. The writer asked for a figure no kind can
 *   draw yet, and the lesson shows its caption with a line saying so
 *   (plan #2321.9).
 */
export type FigureData = 'none' | 'series' | 'source' | 'places' | 'wanted';

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
  /**
   * What the kind's `resolve` fetched for the figure, filled in on the server
   * when the lesson is loaded and never stored (plan #2321.3). Absent on a
   * kind with nothing to fetch; null when the fetch found nothing, which
   * draws the caption with a line saying so.
   */
  resolved?: unknown;
};

/** What a kind's Render is given: the spec its schema parsed, and what its resolve fetched. */
export type FigureRenderProps<Spec, Resolved = unknown> = { spec: Spec; resolved: Resolved };

export type FigureKind<Spec = unknown, Resolved = unknown> = {
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
  example: { caption: string; spec: Spec; resolved?: Resolved };
  Render: ComponentType<FigureRenderProps<Spec, Resolved>>;
  /**
   * Fetches what a `series` or `source` kind draws, on the server, between
   * the stored block and Render (`./resolve.ts`). Null when it cannot be
   * found. A kind with nothing to fetch leaves it out.
   */
  resolve?: (spec: Spec, context: FigureResolveContext) => Promise<Resolved | null>;
  /**
   * The questions a kind can be asked through (plan #2321.5): fill a table's
   * cell, say which way a chart goes, pick the right diagram. Each form is
   * written by the figure question writer, posed from the figure, and
   * graded by its own grader where the answer is exact. Absent on a kind no
   * question is asked of.
   */
  questions?: readonly FigureQuestionForm<Spec, Resolved>[];
  data: FigureData;
};

/**
 * A figure question as a form poses it (plan #2321.5): the figure as shown
 * (a table with a cell blanked, a chart cut before the years asked about),
 * the question, the answers to pick from or none for a short typed answer,
 * and the answer, which stays on the server and is never sent to the page.
 */
export type PosedFigure<Spec = unknown, Resolved = unknown> = {
  spec: Spec;
  resolved?: Resolved;
  prompt: string;
  /** Each carries a `spec` of the same kind when the choices are figures. */
  choices?: Array<{ value: string; label: string; spec?: Spec }>;
  /** A choice's value, or the text the blank held. */
  answer: string;
};

/** One answer a figure question offers on the page; a pick's carry the figure each one is. */
export type FigureChoice = { value: string; label: string; figure?: FigureBlock };

/** What a form's grader says: met, not met, or null when only the model can tell. */
export type FigureQuestionVerdict = 'met' | 'not_met' | null;

/**
 * One way of asking a question on a figure (plan #2321.5). A kind lists its
 * forms in `questions`; the question writer is told each form's line, writes
 * the figure and the form's `ask`, and the form turns them into the question.
 */
export type FigureQuestionForm<Spec = unknown, Resolved = unknown, Ask = unknown> = {
  /** Stored with the question; never renamed once used. */
  id: string;
  /** What the question is called above it, such as "Fill the cell". */
  label: string;
  /** For the question writer: when the form fits, and the exact shape of `ask`. Starts with the id. */
  writerLine: string;
  /** Parses what the writer wrote for the form. */
  schema: z.ZodType<Ask>;
  /**
   * The question, from the figure and the writer's ask, or null when they
   * cannot make a fair one (a blank on an empty cell, a chart whose move is
   * too small to call). A null asks an explanation instead.
   */
  // A method, so a form with its own Ask sits in a kind's list of forms.
  pose(input: { spec: Spec; resolved: Resolved; ask: Ask }): PosedFigure<Spec, Resolved> | null;
  /**
   * Grades a response against the posed answer. A form with choices always
   * says met or not met; a typed answer that is not plainly right or wrong
   * is null, and the model grades it with the figure in its prompt.
   */
  grade(answer: string, response: string): FigureQuestionVerdict;
  /**
   * An ask that poses a question on the kind's own example, drawn in the
   * gallery and checked by the registry test. A form built for any kind (the
   * pick of a diagram) may leave it to the kind that lists it.
   */
  example?: Ask;
};

/** The gallery surface every kind is drawn on. A surface id takes no underscore, so `two_by_two` is drawn on `learn-figure-two-by-two`. */
export function figureSurface(kind: Pick<FigureKind, 'id'>): string {
  return `learn-figure-${kind.id.replace(/_/g, '-')}`;
}

/**
 * What a kind's resolve can reach (plan #2321.3). Each data kind adds the
 * reader it needs here, and `./resolve.ts` builds the context for the page
 * and for the lesson writer.
 */
export type FigureResolveContext = {
  /** A registered data source's series, through the shared cache (`./series-store.ts`). */
  series: SeriesLoader;
  /** Where a named place is, through the geocoder's cache (`./places.ts`, plan #2321.6). */
  places: PlaceLoader;
};
