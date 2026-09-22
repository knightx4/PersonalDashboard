import type { MapEdgeType, PositionKind } from '@/lib/learn/graph/position-prompt';
import type { ProposedStance } from '@/lib/vault/map/proposal';

/**
 * How the map's enums read on a screen. One place, so the review on a note's
 * page and the map pages that show accepted rows use the same words.
 */

export const POSITION_KIND_LABEL: Record<PositionKind, string> = {
  claim: 'Claim',
  position: 'Position',
  distinction: 'Distinction',
  frame: 'Frame',
};

export const STANCE_LABEL: Record<ProposedStance, string> = {
  held: 'Held',
  encountered: 'Encountered',
  // From the note's "Created by Claude" callout, never from the reader.
  generated: 'Written by a model',
};

/** The verb between two positions: "A supports B". */
export const EDGE_VERB: Record<MapEdgeType, string> = {
  requires: 'requires',
  supports: 'supports',
  qualifies: 'qualifies',
  contradicts: 'contradicts',
  example_of: 'is an example of',
  same_as: 'is the same as',
};
