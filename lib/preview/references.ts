/**
 * Reference designs, kept by gallery surface (docs/UI-QUALITY-SPEC.md, Part 2
 * and rule R18).
 *
 * A reference is a design the person prefers for one screen. The design
 * critic is shown it on every round for that surface, in this step and every
 * later one, and judges the screen against it as well as against the laws: a
 * screen that keeps every law but reads worse than its reference fails, and
 * where the reference breaks a law, the law wins.
 *
 * A step names a reference on a `Reference:` line of its detail, as pictures,
 * a link, or both. The builder registers it here under the surface it is for.
 * Pictures live in the repository under `docs/references/<surface>/`. A link
 * with no pictures yet is photographed by the builder the first time it is
 * used, and the shots are saved there and listed, so later rounds and later
 * steps send the same pictures rather than whatever the page shows by then.
 */

/** Where a reference's pictures are kept, one folder per surface. */
export const REFERENCE_DIR = 'docs/references';

export type Reference = {
  /**
   * Pictures of the design, as paths from the repository root, normally under
   * `docs/references/<surface>/`. Empty only while a link waits to be
   * photographed.
   */
  pictures: readonly string[];
  /** The page the design came from, or null when it was only ever pictures. */
  link: string | null;
  /** What the person prefers about it, in a sentence, for the critic. */
  why: string;
  /** The step that registered it, by outline, such as "1891.2". */
  from: string;
};

/**
 * The registered references, by gallery surface id. Every key must be a
 * surface in the gallery (tests/preview-routes.test.ts).
 */
export const REFERENCES: Readonly<Record<string, Reference>> = {};

/** The reference registered for a surface, or null for none. */
export function referenceFor(
  surface: string,
  references: Readonly<Record<string, Reference>> = REFERENCES,
): Reference | null {
  return Object.prototype.hasOwnProperty.call(references, surface) ? references[surface] : null;
}

/** What a step's `Reference:` line names: picture paths and links. */
export type ReferenceLine = {
  pictures: string[];
  links: string[];
};

/**
 * What a step's text says on its `Reference:` line, or null when there is no
 * such line. The line lists pictures and links, separated by commas or
 * spaces; a word starting `http://` or `https://` is a link, and anything
 * else is a picture path. The first such line wins.
 */
export function referenceNamed(text: string): ReferenceLine | null {
  const match = text.match(/^\s*(?:[-*]\s*)?\**references?\**\s*:\**\s*(.+)$/im);
  if (!match) return null;
  const words = match[1]
    .split(/[\s,]+/)
    .map((word) => word.replace(/^[<`"'(]+|[>`"').]+$/g, ''))
    .filter(Boolean);
  const links = words.filter((word) => /^https?:\/\//i.test(word));
  const pictures = words.filter((word) => !/^https?:\/\//i.test(word));
  if (links.length === 0 && pictures.length === 0) return null;
  return { pictures, links };
}

/**
 * What is wrong with a set of references: a surface the gallery does not
 * have, a reference with neither pictures nor a link, or a picture that is
 * not in the repository. Empty when nothing is.
 */
export function referenceProblems(
  references: Readonly<Record<string, Reference>>,
  gallery: readonly string[],
  exists: (path: string) => boolean,
): string[] {
  const known = new Set(gallery);
  const problems: string[] = [];
  for (const [surface, reference] of Object.entries(references)) {
    if (!known.has(surface)) problems.push(`${surface}: not a gallery surface`);
    if (reference.pictures.length === 0 && !reference.link) {
      problems.push(`${surface}: neither pictures nor a link`);
    }
    for (const picture of reference.pictures) {
      if (!exists(picture)) problems.push(`${surface}: ${picture} is not in the repository`);
    }
  }
  return problems;
}

/**
 * The reference as the critic's prompt gives it: the pictures to open, the
 * link, and what the person prefers about it. A link with no pictures yet
 * says it has to be photographed first.
 */
export function referenceForCritic(surface: string, reference: Reference): string {
  const parts = [`${surface}, registered by #${reference.from}: ${reference.why}`];
  if (reference.pictures.length > 0) parts.push(`Pictures: ${reference.pictures.join(', ')}.`);
  if (reference.link) {
    parts.push(
      reference.pictures.length > 0
        ? `From ${reference.link}.`
        : `From ${reference.link}, not yet photographed: shoot it into ${REFERENCE_DIR}/${surface}/ and list them in lib/preview/references.ts before the round.`,
    );
  }
  return parts.join(' ');
}
