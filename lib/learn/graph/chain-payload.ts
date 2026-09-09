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

export const chainPayloadSchema = z.object({
  /** Which subject this belongs in, in the model's judgement. */
  subject: z.string().trim().min(1).max(200),
  /** The node the goal itself resolves to, by name. */
  goal_concept: z.string().trim().min(1).max(200),
  concepts: z.array(proposedConceptSchema).max(40).default([]),
  edges: z.array(proposedEdgeSchema).max(80).default([]),
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

export type ProposedChain = {
  subject: string;
  goalConcept: string;
  nodes: ChainNode[];
  edges: ChainEdge[];
  /** How many the model proposed that the subject already had. */
  joined: number;
  /** What was dropped, and why, for the screen to be honest about. */
  dropped: { name: string; reason: string }[];
};

/** What the subject already holds, as far as these rules are concerned. */
export type ExistingConcept = { id: string; name: string };

const key = (name: string) => name.trim().toLowerCase();

/**
 * Would adding this edge close a loop?
 *
 * Walks forward from the dependent: if the prerequisite is already reachable
 * that way, the edge would complete a cycle. The same question the database
 * asks, asked earlier so nobody is shown a chain that cannot be saved.
 */
function wouldCycle(edges: ChainEdge[], candidate: ChainEdge): boolean {
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
export const approvedChainSchema = z.object({
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
    .max(20),
  edges: z.array(proposedEdgeSchema).max(40),
  joined: z.number().int().min(0),
  dropped: z.array(z.object({ name: z.string(), reason: z.string() })).max(40),
});
