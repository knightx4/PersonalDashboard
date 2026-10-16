/**
 * The mockup you approved for each screen a step changed, to show beside the
 * build's pictures on the step's row (plan #2215.10). A difference the
 * builder could not close is named in the close note (#2215.8's answer), and
 * the pair is where you see it and send the screen back.
 *
 * Two places hold a mockup, and the first that has one wins:
 *
 * 1. The reference registered for the surface in lib/preview/references.ts,
 *    whose pictures are kept in the repository. Its phone picture is shown,
 *    since the row shows the build on a phone.
 * 2. A drawing approved for the step (plan_item_pictures): on the step or a
 *    row above it, or the chosen option of a decision answered under its
 *    feature, by the brief's own rule. A drawing goes to the surface its
 *    caption names; one that names none goes to the step's only surface, and
 *    is left out when the step changed several, since there is no telling
 *    which screen it drew.
 *
 * No side effects: the tree, the pictures and the changes in, the changes
 * out with a mockup on each surface that has one.
 */
import { approvedDrawings } from './brief';
import { stepRef } from './ref';
import type { PlanPicture } from './pictures';
import type { ScreenChangeView } from './screen-change';
import { flattenSections, type PlanSection } from './tree';
import { REFERENCES, referenceFor, type Reference } from '@/lib/preview/references';

/** A mockup as the row draws it. */
export type ScreenMockup = {
  /** Where the picture loads from. */
  src: string;
  /** Where it came from, in words: "registered by #2215.9" or the drawing's caption. */
  from: string;
  /** The page the design was made on, such as a chat mockup's artifact, or null. */
  link: string | null;
};

/** Where a reference picture kept in the repository loads from (app/dev/plan/reference). */
export function referencePictureHref(path: string): string {
  return `/dev/plan/reference?path=${encodeURIComponent(path)}`;
}

/** True when `path` is a picture some registered reference lists, which is all the route serves. */
export function isReferencePicture(
  path: string,
  references: Readonly<Record<string, Reference>> = REFERENCES,
): boolean {
  return Object.values(references).some((reference) => reference.pictures.includes(path));
}

/** A reference's phone picture, else its first, else null. */
function referencePicture(reference: Reference): string | null {
  return (
    reference.pictures.find((path) => /phone/i.test(path.split('/').pop() ?? '')) ??
    reference.pictures[0] ??
    null
  );
}

function referenceMockup(surface: string, references: Readonly<Record<string, Reference>>) {
  const reference = referenceFor(surface, references);
  if (!reference) return null;
  const picture = referencePicture(reference);
  if (!picture) return null;
  return {
    src: referencePictureHref(picture),
    from: `registered by #${reference.from}`,
    link: reference.link,
  } satisfies ScreenMockup;
}

/** Whether a caption names a surface id as a whole word. */
function namesSurface(caption: string, surface: string): boolean {
  const escaped = surface.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^a-z0-9-])${escaped}($|[^a-z0-9-])`, 'i').test(caption);
}

/** Each step's changes, with a `mockup` on every surface that has one approved. */
export function withMockups(
  changes: Readonly<Record<number, readonly ScreenChangeView[]>>,
  sections: readonly PlanSection[],
  pictures: Readonly<Record<string, readonly PlanPicture[]>>,
  references: Readonly<Record<string, Reference>> = REFERENCES,
): Record<number, ScreenChangeView[]> {
  const byNumber = new Map(flattenSections(sections).map((node) => [node.number, node]));
  const out: Record<number, ScreenChangeView[]> = {};
  for (const [key, list] of Object.entries(changes)) {
    const step = Number(key);
    const node = byNumber.get(step);
    const drawings = node ? approvedDrawings(sections, node, pictures) : [];
    out[step] = list.map((change) => {
      const registered = referenceMockup(change.surface, references);
      if (registered) return { ...change, mockup: registered };
      const drawing =
        drawings.find((d) => namesSurface(d.caption, change.surface)) ??
        (list.length === 1 ? drawings[0] : undefined);
      if (!drawing) return { ...change };
      return {
        ...change,
        mockup: { src: drawing.src, from: `${drawing.caption}, on ${stepRef(drawing.on)}`, link: null },
      };
    });
  }
  return out;
}
