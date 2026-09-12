/**
 * The graph, as the screens see it.
 *
 * Pure types and pure functions over them, with no client and no model call
 * anywhere near. The rules here decide what a person is shown, and they are
 * the part of this module most likely to be quietly wrong -- a view that shows
 * thirty nodes when it should show four is not an error, it is just useless --
 * so they are written where they can be tested against a graph built by hand.
 */

export const KNOWLEDGE_STATES = ['unknown', 'shaky', 'known', 'misconception'] as const;
export type KnowledgeState = (typeof KNOWLEDGE_STATES)[number];

export const STATE_BASES = ['tested', 'inferred', 'declared'] as const;
export type StateBasis = (typeof STATE_BASES)[number];

export type Concept = {
  id: string;
  name: string;
  /** The claim itself. What a probe question would be written against. */
  claim: string;
  /** How this node came to be believed to belong here. */
  basis: string;
  state: KnowledgeState;
  /** How the state was established. Weaker than the state itself, and shown. */
  established: StateBasis;
  /** Named when the state is `misconception`, null otherwise. */
  misconception: string | null;
  testedAt: string | null;
};

export type ConceptEdge = {
  prerequisiteId: string;
  dependentId: string;
};

/**
 * One claim referring to another. Not a prerequisite, and never treated as
 * one.
 */
export type ConceptMention = {
  sourceId: string;
  targetId: string;
  /** Why it is said to refer to it, in a sentence. Shown. */
  basis: string;
};

export type Graph = {
  concepts: Concept[];
  edges: ConceptEdge[];
  /**
   * Which claims talk about which. Read by `mentionsFor` and by nothing else
   * in this file: `pruneForGoal`, `learningOrder` and `readyNow` all walk
   * `edges` alone, and a mention must never reach them. Mentions run in both
   * directions between the same pair, which is a cycle the moment one is
   * mistaken for an edge -- and a cycle is what every walk here assumes it
   * will never meet.
   */
  mentions: ConceptMention[];
};

/**
 * Settled means `known`, and nothing else.
 *
 * `shaky` is not a weak yes, it is a no with evidence, and `misconception` is
 * the strongest possible no -- something is actively steering you wrong there.
 * Treating either as settled would prune away exactly the nodes worth working
 * on, which is the one mistake this file must not make.
 */
export function isSettled(concept: Concept): boolean {
  return concept.state === 'known';
}

function byId(graph: Graph): Map<string, Concept> {
  return new Map(graph.concepts.map((concept) => [concept.id, concept]));
}

/** dependent → its prerequisites. */
export function prerequisiteMap(graph: Graph): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const concept of graph.concepts) map.set(concept.id, []);
  for (const edge of graph.edges) {
    const list = map.get(edge.dependentId);
    // An edge naming a concept that is not in this graph is skipped rather
    // than invented: a partial read is a real thing here, and a phantom node
    // would break the walk in a way nobody could see.
    if (list && map.has(edge.prerequisiteId)) list.push(edge.prerequisiteId);
  }
  return map;
}

/** prerequisite → the things that depend on it. */
export function dependentMap(graph: Graph): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const concept of graph.concepts) map.set(concept.id, []);
  for (const edge of graph.edges) {
    const list = map.get(edge.prerequisiteId);
    if (list && map.has(edge.dependentId)) list.push(edge.dependentId);
  }
  return map;
}

/** A concept reached by a mention, with the sentence that put it there. */
export type Mentioned = {
  concept: Concept;
  basis: string;
};

/**
 * What one claim refers to, and what refers to it.
 *
 * Both directions, because the link is worth as much read backwards: the claim
 * that talks about this one is usually the one that puts it in context. Sorted
 * by name so the page renders the same way twice, and a mention naming a
 * concept outside this graph is skipped rather than invented, the same rule
 * `prerequisiteMap` follows.
 *
 * Nothing above calls this. It is for a page showing one concept, and keeping
 * it away from the walks is the point -- see `Graph.mentions`.
 */
export function mentionsFor(
  graph: Graph,
  conceptId: string,
): { refersTo: Mentioned[]; referredToBy: Mentioned[] } {
  const concepts = byId(graph);
  const byName = (a: Mentioned, b: Mentioned) => a.concept.name.localeCompare(b.concept.name);

  const refersTo: Mentioned[] = [];
  const referredToBy: Mentioned[] = [];

  for (const mention of graph.mentions) {
    if (mention.sourceId === conceptId) {
      const concept = concepts.get(mention.targetId);
      if (concept) refersTo.push({ concept, basis: mention.basis });
    } else if (mention.targetId === conceptId) {
      const concept = concepts.get(mention.sourceId);
      if (concept) referredToBy.push({ concept, basis: mention.basis });
    }
  }

  return { refersTo: refersTo.sort(byName), referredToBy: referredToBy.sort(byName) };
}

/**
 * What a view of this goal should show.
 *
 * The rule from the spec: only the nodes on a path from something you already
 * know to that goal. Read backwards from the goal, through unsettled nodes
 * only, which is exactly that -- a node is kept when some chain of unsettled
 * nodes runs from it to the goal.
 *
 * Two things fall out of it, and both are the point:
 *
 *   A node you know is never shown, because it cannot be on a chain of
 *   unsettled nodes.
 *
 *   Everything underneath a node you know disappears with it, unless it has
 *   another route to the goal that is still unsettled. That is the answer to
 *   "how do I avoid being shown thirty things I already know": knowing one
 *   node above them prunes all of them at once, and a node that genuinely
 *   still matters for some other reason survives because that other route is
 *   still open.
 *
 * The goal itself is included when it is unsettled, and the whole thing is
 * empty when the goal is already known -- which is the honest answer to "what
 * is left for this goal": nothing.
 */
export function pruneForGoal(graph: Graph, goalId: string): string[] {
  const concepts = byId(graph);
  const prerequisites = prerequisiteMap(graph);

  const goal = concepts.get(goalId);
  if (!goal || isSettled(goal)) return [];

  const kept = new Set<string>([goalId]);
  const queue = [goalId];

  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const prerequisiteId of prerequisites.get(current) ?? []) {
      if (kept.has(prerequisiteId)) continue;
      const prerequisite = concepts.get(prerequisiteId);
      // A settled node ends the chain. It is not shown, and neither is
      // anything reachable only through it.
      if (!prerequisite || isSettled(prerequisite)) continue;
      kept.add(prerequisiteId);
      queue.push(prerequisiteId);
    }
  }

  return [...kept];
}

/**
 * The order they would be learned in.
 *
 * A topological walk of whichever nodes were asked for, prerequisites first,
 * broken ties by name so the same graph always renders the same way. The graph
 * is acyclic because the database refuses anything else; if a cycle ever did
 * get in, the nodes it contains are appended rather than dropped, because a
 * screen missing a node silently is worse than one showing it out of order.
 */
export function learningOrder(graph: Graph, ids: string[]): Concept[] {
  const wanted = new Set(ids);
  const concepts = byId(graph);
  const prerequisites = prerequisiteMap(graph);

  const remaining = new Map<string, number>();
  for (const id of wanted) {
    const count = (prerequisites.get(id) ?? []).filter((p) => wanted.has(p)).length;
    remaining.set(id, count);
  }

  const dependents = dependentMap(graph);
  const nameOf = (id: string) => concepts.get(id)?.name ?? id;

  const ready = [...remaining.entries()]
    .filter(([, count]) => count === 0)
    .map(([id]) => id)
    .sort((a, b) => nameOf(a).localeCompare(nameOf(b)));

  const ordered: string[] = [];
  while (ready.length > 0) {
    const id = ready.shift()!;
    ordered.push(id);
    remaining.delete(id);

    const freed: string[] = [];
    for (const dependentId of dependents.get(id) ?? []) {
      if (!remaining.has(dependentId)) continue;
      const left = (remaining.get(dependentId) ?? 1) - 1;
      remaining.set(dependentId, left);
      if (left === 0) freed.push(dependentId);
    }

    for (const id of freed.sort((a, b) => nameOf(a).localeCompare(nameOf(b)))) ready.push(id);
  }

  // Anything left is in a cycle, which the database should have made
  // impossible. Shown at the end rather than dropped.
  for (const id of remaining.keys()) ordered.push(id);

  return ordered.map((id) => concepts.get(id)).filter((c): c is Concept => c !== undefined);
}

/**
 * What could be started right now.
 *
 * The nodes in a pruned view with nothing unsettled underneath them: every
 * prerequisite is either settled or outside this view. "The one next thing
 * worth learning" is the first of these in learning order.
 */
export function readyNow(graph: Graph, ids: string[]): Concept[] {
  const wanted = new Set(ids);
  const prerequisites = prerequisiteMap(graph);
  const ready = ids.filter((id) => (prerequisites.get(id) ?? []).every((p) => !wanted.has(p)));
  return learningOrder(graph, ready);
}

/**
 * What could be started anywhere in a subject.
 *
 * The same question `readyNow` asks of a pruned goal view, asked of a whole
 * graph, and the difference is what a prerequisite outside the set counts as.
 * `readyNow` treats one as satisfied, because pruning removed it on purpose;
 * nothing has been removed here, so every prerequisite has to be settled
 * before its dependent is ready. A shaky prerequisite holds back whatever
 * rests on it rather than disappearing from under it.
 *
 * In learning order, which for this set is by name: a concept that is ready
 * never has another ready concept underneath it.
 */
export function readyToLearn(graph: Graph): Concept[] {
  const concepts = byId(graph);
  const prerequisites = prerequisiteMap(graph);

  const ready = graph.concepts
    .filter((concept) => !isSettled(concept))
    .filter((concept) =>
      (prerequisites.get(concept.id) ?? []).every((id) => {
        // prerequisiteMap has already dropped edges naming a concept outside
        // this graph, so the lookup only misses in a graph it built itself.
        const prerequisite = concepts.get(id);
        return prerequisite === undefined || isSettled(prerequisite);
      }),
    )
    .map((concept) => concept.id);

  return learningOrder(graph, ready);
}

export type SubjectCounts = Record<KnowledgeState, number> & { total: number };

/** How much of a subject is settled. One line on the subjects list. */
export function countStates(graph: Graph): SubjectCounts {
  const counts: SubjectCounts = {
    unknown: 0,
    shaky: 0,
    known: 0,
    misconception: 0,
    total: graph.concepts.length,
  };
  for (const concept of graph.concepts) counts[concept.state] += 1;
  return counts;
}

/**
 * What a correct answer above says about what is underneath.
 *
 * Growth trigger 3. Answering correctly about a node means the things it rests
 * on are probably in place -- you cannot use an idea while missing its floor
 * -- so they are marked known and the session skips forward rather than
 * walking down a chain somebody has visibly cleared.
 *
 * Two limits, and they are the whole of the honesty here:
 *
 *   It is `inferred`, never `tested`. The state column and the basis column
 *   are separate precisely so this can be recorded as the weaker claim it is,
 *   and a screen can say "inferred from something above it" rather than
 *   implying somebody answered a question about it.
 *
 *   It never touches a node that has been tested. An inference must not
 *   overwrite evidence in either direction: not a node somebody got right, and
 *   especially not one they got wrong, which is exactly the node an inference
 *   would be wrong about.
 */
export function inferredFrom(graph: Graph, conceptId: string): string[] {
  const concepts = new Map(graph.concepts.map((concept) => [concept.id, concept]));
  const prerequisites = prerequisiteMap(graph);

  const inferred: string[] = [];
  const seen = new Set<string>([conceptId]);
  const queue = [conceptId];

  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const prerequisiteId of prerequisites.get(current) ?? []) {
      if (seen.has(prerequisiteId)) continue;
      seen.add(prerequisiteId);

      const concept = concepts.get(prerequisiteId);
      if (!concept) continue;

      // Walk through it either way: a node somebody has already answered
      // about is not re-marked, but what sits under it is still implied.
      if (concept.established !== 'tested') inferred.push(prerequisiteId);
      queue.push(prerequisiteId);
    }
  }

  return inferred;
}
