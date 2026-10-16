import type { EvidenceKind } from '@/lib/learn/evidence/kinds';
import type { EvidenceWeight } from '@/lib/learn/strength';
import { exposureOf } from './sky';
import type { IdeaMapView, IdeaOnMap } from './load';

/**
 * The layers Idea Space can be read in (plan #2187.5): what your answers
 * made bright, what courses and work gave a halo, and what you wrote gave a
 * halo. Turning one off draws the sky and a goal's popup as if that source
 * had never touched them, so each can be told apart from the others.
 *
 * Pure: the view is rewritten once, as recording mode does, so the sky, the
 * graph and the rail read the same layers.
 */

export type Layers = { answers: boolean; courses: boolean; writing: boolean };

export const ALL_LAYERS: Layers = { answers: true, courses: true, writing: true };

/** Which layer a kind of evidence belongs to: courses and work, or your writing. */
export function layerOf(kind: EvidenceKind): 'courses' | 'writing' {
  return kind === 'course' || kind === 'work' || kind === 'video' ? 'courses' : 'writing';
}

export function allOn(layers: Layers): boolean {
  return layers.answers && layers.courses && layers.writing;
}

function layered(idea: IdeaOnMap, layers: Layers, asOf: Date): IdeaOnMap {
  const evidence = idea.evidence.filter((link) => layers[layerOf(link.kind)]);
  const stateRow = layers.answers ? idea.stateRow : null;
  const weights: EvidenceWeight[] = evidence.map((link) => ({
    kind: link.kind,
    ceiling: link.ceiling,
    similarity: link.similarity,
    foundAt: link.foundAt,
  }));
  return {
    ...idea,
    evidence,
    stateRow,
    state: layers.answers ? idea.state : 'unknown',
    strength: layers.answers ? idea.strength : 0,
    haze: layers.answers ? idea.haze : 0,
    exposure: exposureOf(stateRow, weights, asOf),
  };
}

/** `view` as the layers show it; the same object when every layer is on. */
export function layeredView(view: IdeaMapView, layers: Layers): IdeaMapView {
  if (allOn(layers)) return view;
  const asOf = new Date(view.asOf);
  return {
    ...view,
    ideas: view.ideas.map((idea) => layered(idea, layers, asOf)),
    dust: layers.writing ? view.dust : [],
    territories: view.territories?.map((territory) =>
      layers.answers
        ? territory
        : {
            ...territory,
            standing: [],
            topics: territory.topics.map((topic) => ({ ...topic, tested: 0, held: 0, missed: [] })),
          },
    ),
  };
}
