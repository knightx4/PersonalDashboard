import { CONCEPT_KINDS } from '@/lib/learn/graph/model';

/**
 * What every path that proposes a concept says about doors.
 *
 * The same five calls that share `MASTERY_RULE` also have to agree on which
 * nodes are doors, and for the same reason: the mark decides what a subject
 * page draws large and what a probe session asks about first, so a path that
 * calls half its nodes thresholds makes those screens read as noise. One
 * paragraph in one place, quoted by all five.
 *
 * The distinction is Meyer and Land's: a threshold concept is a portal, and
 * the material past it does not land until you are through. The part of the
 * rule doing the most work is the last line -- a model asked to sort nodes
 * into two buckets will happily put half of them in the interesting one.
 */
export const KIND_RULE = `DOORS AND WHAT FOLLOWS FROM THEM. Every node says whether it is a "threshold"
or a "consequence". A threshold is a door into the subject: usually
counterintuitive, hard to un-see once held, and the claims downstream of it do
not land until you are through it. A consequence follows from a door and is
learnable once you hold that door.

  Threshold: "A choice costs you the next best thing you could have done with
  the same resources, whether or not any money changed hands."
  Consequence: "Money already spent is not a reason to continue, because it is
  gone under either choice."

A subject has eight to twelve doors in it, not forty. Most of what you propose
is a consequence, and marking a node a threshold because it is important is the
mistake to avoid -- the test is whether somebody who has not been through it
misreads everything after it.`;

/** The same field in every `report_chain` tool schema. */
export const KIND_TOOL_FIELD = {
  type: 'string',
  enum: [...CONCEPT_KINDS],
} as const;
