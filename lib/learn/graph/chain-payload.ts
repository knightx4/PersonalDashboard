import { z } from 'zod';

/**
 * The rules a proposed chain has to survive before anybody is shown it.
 *
 * Split from the call, so they can be tested without a network, and written
 * against the two failures a generated graph actually has. The first is
 * duplication: ask for "Keynesian economics" a month after "the Phillips
 * curve" and two thirds of what comes back is already in the subject under
 * slightly different words. The second is floating nodes: a plausible-sounding
 * concept with no stated relationship to anything, which is a syllabus entry
 * rather than a graph node and which the spec forbids outright -- "nothing is
 * added without an edge".
 *
 * The cycle check is here as well as in the database. The database is the one
 * that guarantees it; this one exists so a person is never shown a chain that
 * will fail to save, which is a worse experience than a shorter chain.
 */

/** Longer than this and a goal has stopped being specific. */
export const MAX_CHAIN = 12;

export const proposedConceptSchema = z.object({
  /** Short, for the graph view. */
  name: z.string().trim().min(1).max(200),
  /** One or two sentences you could be right or wrong about. */
  claim: z.string().trim().min(1).max(1000),
  /** How this is known to belong here. Shown, so it may not be flattering. */
  basis: z.string().trim().min(1).max(500),
});

export const proposedEdgeSchema = z.object({
  /** Names rather than ids: the model has never seen an id. */
  prerequisite: z.string().trim().min(1).max(200),
  dependent: z.string().trim().min(1).max(200),
  basis: z.string().trim().min(1).max(500),
});

/**
 * One claim referring to another, as the model reports it.
 *
 * Separate from an edge because it is a different claim: `source` talks about
 * `target`, which says nothing about what has to be learned first. Both
 * directions between the same pair are allowed, and that is exactly why this
 * cannot be an edge -- see `learn.concept_mentions`.
 */
export const proposedMentionSchema = z.object({
  source: z.string().trim().min(1).max(200),
  target: z.string().trim().min(1).max(200),
  basis: z.string().trim().min(1).max(500),
});

export const chainPayloadSchema = z.object({
  /** Which subject this belongs in, in the model's judgement. */
  subject: z.string().trim().min(1).max(200),
  /** The node the goal itself resolves to, by name. */
  goal_concept: z.string().trim().min(1).max(200),
  concepts: z.array(proposedConceptSchema).max(40).default([]),
  edges: z.array(proposedEdgeSchema).max(80).default([]),
  /** Empty for every caller that does not ask for them. */
  mentions: z.array(proposedMentionSchema).max(80).default([]),
  /** Said out loud when the goal is too vague to lay out. */
  too_vague: z.boolean().default(false),
});

export type ChainPayload = z.infer<typeof chainPayloadSchema>;

export type ChainNode = {
  name: string;
  claim: string;
  basis: string;
  /** The id it matched in the subject already, or null when it is new. */
  existingId: string | null;
};

export type ChainEdge = {
  prerequisite: string;
  dependent: string;
  basis: string;
};

export type ChainMention = {
  source: string;
  target: string;
  basis: string;
};

export type ProposedChain = {
  subject: string;
  goalConcept: string;
  nodes: ChainNode[];
  edges: ChainEdge[];
  /** Which of these claims talk about which. Empty unless the call asked. */
  mentions: ChainMention[];
  /** How many the model proposed that the subject already had. */
  joined: number;
  /** What was dropped, and why, for the screen to be honest about. */
  dropped: { name: string; reason: string }[];
};

/** What the subject already holds, as far as these rules are concerned. */
export type ExistingConcept = { id: string; name: string };

const key = (name: string) => name.trim().toLowerCase();

/**
 * Two names as one lookup key, in order.
 *
 * JSON rather than the two names joined by a separator, because concept names
 * are prose: "a b" and "c" would join to the same string as "a" and "b c", and
 * a pair that quietly collides with another pair is a link drawn between the
 * wrong two claims.
 */
const pairKey = (from: string, to: string) => JSON.stringify([key(from), key(to)]);

/**
 * Would adding this edge close a loop?
 *
 * Walks forward from the dependent: if the prerequisite is already reachable
 * that way, the edge would complete a cycle. The same question the database
 * asks, asked earlier so nobody is shown a chain that cannot be saved.
 */
export function wouldCycle(edges: ChainEdge[], candidate: ChainEdge): boolean {
  if (key(candidate.prerequisite) === key(candidate.dependent)) return true;

  const forward = new Map<string, string[]>();
  for (const edge of edges) {
    const from = key(edge.prerequisite);
    forward.set(from, [...(forward.get(from) ?? []), key(edge.dependent)]);
  }

  const target = key(candidate.prerequisite);
  const seen = new Set<string>();
  const queue = [key(candidate.dependent)];

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current === target) return true;
    if (seen.has(current)) continue;
    seen.add(current);
    for (const next of forward.get(current) ?? []) queue.push(next);
  }

  return false;
}

/**
 * Keep the mentions that can actually be drawn.
 *
 * A mention naming something outside the chain cannot be drawn, and inventing
 * the missing end is the silent guess this module is built against. The rest
 * of the rules are about not saying the same thing twice: the same pair twice,
 * a claim referring to itself, and -- the one worth explaining -- a pair that
 * is already a prerequisite. An edge already puts both claims on each other's
 * page, with a better sentence under it, so a mention repeating it is a second
 * line saying less. None of these is a loss anybody needs telling about, so
 * none of them goes in `dropped`, which is for claims that were read and could
 * not be placed.
 *
 * No cycle check, deliberately. Two claims referring to each other is the
 * ordinary case and the reason mentions are not edges.
 */
export function placeMentions(
  proposed: ChainMention[],
  present: ReadonlySet<string>,
  edges: ChainEdge[],
): ChainMention[] {
  const prerequisitePairs = new Set(
    edges.flatMap((edge) => [
      pairKey(edge.prerequisite, edge.dependent),
      pairKey(edge.dependent, edge.prerequisite),
    ]),
  );

  const mentions: ChainMention[] = [];
  const seen = new Set<string>();

  for (const mention of proposed) {
    const source = mention.source.trim();
    const target = mention.target.trim();
    const pair = pairKey(source, target);

    if (key(source) === key(target)) continue;
    if (!present.has(key(source)) || !present.has(key(target))) continue;
    if (seen.has(pair) || prerequisitePairs.has(pair)) continue;

    seen.add(pair);
    mentions.push({ source, target, basis: mention.basis.trim() });
  }

  return mentions;
}

/**
 * Turn what the model said into something that can be shown and saved.
 *
 * Order of operations matters and is the whole of the logic:
 *
 *   1. Match every proposed node against what the subject already has, by
 *      name. A match is not dropped from the chain -- it stays, marked as
 *      something already known about, because the chain is only legible with
 *      its existing rungs in it -- but it is never inserted twice.
 *   2. Keep the edges whose ends both exist, refusing any that would close a
 *      cycle.
 *   3. Drop a new node with no edge at either end. That is the spec's rule,
 *      and it is the difference between a graph and a list: a concept nobody
 *      can say what sits under or on top of has not been placed.
 */
export function normaliseChain(
  payload: ChainPayload,
  existing: ExistingConcept[],
): ProposedChain | null {
  if (payload.too_vague) return null;

  const existingByName = new Map(existing.map((concept) => [key(concept.name), concept.id]));
  const dropped: { name: string; reason: string }[] = [];

  const nodes: ChainNode[] = [];
  const seen = new Set<string>();
  let joined = 0;

  for (const proposed of payload.concepts) {
    const name = proposed.name.trim();
    if (seen.has(key(name))) {
      dropped.push({ name, reason: 'proposed twice' });
      continue;
    }
    seen.add(key(name));

    const existingId = existingByName.get(key(name)) ?? null;
    if (existingId) joined += 1;

    nodes.push({ name, claim: proposed.claim.trim(), basis: proposed.basis.trim(), existingId });
    if (nodes.length >= MAX_CHAIN) break;
  }

  // A goal node the model forgot to describe is still the point of the whole
  // chain, so it is looked for among what already exists rather than dropped.
  const goalKey = key(payload.goal_concept);
  if (!seen.has(goalKey)) {
    const existingId = existingByName.get(goalKey);
    if (existingId) {
      nodes.push({
        name: payload.goal_concept.trim(),
        claim: '',
        basis: '',
        existingId,
      });
      seen.add(goalKey);
      joined += 1;
    } else {
      return null;
    }
  }

  const edges: ChainEdge[] = [];
  for (const proposed of payload.edges) {
    const prerequisite = proposed.prerequisite.trim();
    const dependent = proposed.dependent.trim();

    // An edge naming something not in the chain cannot be drawn. Inventing the
    // missing end is exactly the silent guess this module is built against.
    if (!seen.has(key(prerequisite)) || !seen.has(key(dependent))) continue;
    if (edges.some((e) => key(e.prerequisite) === key(prerequisite) && key(e.dependent) === key(dependent))) {
      continue;
    }

    const candidate = { prerequisite, dependent, basis: proposed.basis.trim() };
    if (wouldCycle(edges, candidate)) {
      dropped.push({ name: `${prerequisite} → ${dependent}`, reason: 'would close a loop' });
      continue;
    }
    edges.push(candidate);
  }

  // Nothing is added without an edge. An existing node may sit unattached --
  // it is already placed, and it is here to make the chain readable.
  const attached = new Set<string>();
  for (const edge of edges) {
    attached.add(key(edge.prerequisite));
    attached.add(key(edge.dependent));
  }

  const placed = nodes.filter((node) => {
    if (node.existingId || attached.has(key(node.name))) return true;
    dropped.push({ name: node.name, reason: 'nothing said what it sits under or on top of' });
    return false;
  });

  const kept = new Set(placed.map((node) => key(node.name)));
  const keptEdges = edges.filter(
    (edge) => kept.has(key(edge.prerequisite)) && kept.has(key(edge.dependent)),
  );

  // Every node already known and no edge to add is not a proposal, it is a
  // no-op wearing one.
  const hasSomethingNew =
    placed.some((node) => node.existingId === null) ||
    keptEdges.some(
      (edge) => !existingByName.has(key(edge.prerequisite)) || !existingByName.has(key(edge.dependent)),
    );
  if (placed.length === 0 || !hasSomethingNew) return null;

  return {
    subject: payload.subject.trim(),
    goalConcept: payload.goal_concept.trim(),
    nodes: placed,
    edges: keptEdges,
    mentions: placeMentions(payload.mentions, kept, keptEdges),
    joined,
    dropped,
  };
}

/**
 * The shape a proposal rides back in from a form.
 *
 * Re-validated rather than trusted: it went out to a browser and came back, so
 * it is user input whoever wrote the form, and this is the last point before
 * rows are written. Shared by both approval paths -- a goal's chain and a
 * floor added under a missed claim are the same thing arriving.
 */
export function approvedChainSchemaWith(limits: {
  nodes: number;
  edges: number;
  mentions: number;
  dropped: number;
}) {
  return z.object({
    subject: z.string().trim().min(1).max(200),
    goalConcept: z.string().trim().min(1).max(200),
    nodes: z
      .array(
        z.object({
          name: z.string().trim().min(1).max(200),
          // Empty only for a node the chain pulled in to stay readable; that one
          // already has its claim and basis in its own row.
          claim: z.string().trim().max(1000),
          basis: z.string().trim().max(500),
          existingId: z.string().uuid().nullable(),
        }),
      )
      .min(1)
      .max(limits.nodes),
    edges: z.array(proposedEdgeSchema).max(limits.edges),
    // Defaulted rather than required: a proposal made before mentions existed
    // is still a proposal, and a form open in a tab should not fail to approve
    // over a list it was never given.
    mentions: z.array(proposedMentionSchema).max(limits.mentions).default([]),
    joined: z.number().int().min(0),
    dropped: z.array(z.object({ name: z.string(), reason: z.string() })).max(limits.dropped),
  });
}

/**
 * A goal's chain and a floor, both capped where a single call is capped. An
 * import reads a whole document and proposes more than either, so it carries
 * its own caps rather than loosening these -- see `approvedBriefSchema`.
 */
export const approvedChainSchema = approvedChainSchemaWith({
  nodes: 20,
  edges: 40,
  mentions: 40,
  dropped: 40,
});

/**
 * Keep only the rows somebody ticked.
 *
 * The tick is on new nodes: a node the chain matched against the subject is
 * already in the graph, nothing is written for it, and its edges are how the
 * new claims join what is there. So untickable, and always kept.
 *
 * Removing a node removes the edges at either end of it, and that can leave
 * another node with nothing holding it in place. Those go into `dropped` with
 * the reason, rather than being written as the floating nodes the graph does
 * not take. The screen shows that list, so unticking one row and losing two is
 * something you see before you approve rather than after.
 */
export const UNPLACED_BY_TICKS = 'nothing you kept says what it sits under or on top of';

export function keepTicked(
  chain: ProposedChain,
  ticked: ReadonlySet<string>,
): { chain: ProposedChain; unplaced: ChainNode[] } {
  const dropped = [...chain.dropped];

  const kept = chain.nodes.filter((node) => {
    if (node.existingId || ticked.has(key(node.name))) return true;
    dropped.push({ name: node.name, reason: 'you left it out' });
    return false;
  });

  const names = new Set(kept.map((node) => key(node.name)));
  const edges = chain.edges.filter(
    (edge) => names.has(key(edge.prerequisite)) && names.has(key(edge.dependent)),
  );

  const attached = new Set<string>();
  for (const edge of edges) {
    attached.add(key(edge.prerequisite));
    attached.add(key(edge.dependent));
  }

  const unplaced: ChainNode[] = [];
  const placed = kept.filter((node) => {
    if (node.existingId || attached.has(key(node.name))) return true;
    unplaced.push(node);
    dropped.push({ name: node.name, reason: UNPLACED_BY_TICKS });
    return false;
  });

  const survived = new Set(placed.map((node) => key(node.name)));
  const survivingEdges = edges.filter(
    (edge) => survived.has(key(edge.prerequisite)) && survived.has(key(edge.dependent)),
  );

  return {
    chain: {
      ...chain,
      nodes: placed,
      edges: survivingEdges,
      // A mention of a row you left out goes with it. There is no tick of its
      // own: a mention is a line on a page between two claims, and unticking
      // either end is the only way to refuse one.
      mentions: placeMentions(chain.mentions, survived, survivingEdges),
      dropped,
    },
    unplaced,
  };
}
