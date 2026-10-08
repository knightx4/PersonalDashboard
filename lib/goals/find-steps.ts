import type { StepNode } from '@/lib/goals/steps';

/** A step that matched, with the titles of the steps above it. */
export type FoundStep = { step: StepNode; path: string[] };

/**
 * The steps of a goal that carry every word of the query in their title,
 * detail or done-when (note 2b5c2b90), in the tree's order, open ones first.
 * A blank query finds nothing. Pure, for the tests.
 */
export function findSteps(steps: readonly StepNode[], query: string): FoundStep[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return [];
  const found: FoundStep[] = [];
  const walk = (nodes: readonly StepNode[], path: string[]) => {
    for (const node of nodes) {
      const haystack = [node.title, node.detail, node.acceptance]
        .filter(Boolean)
        .join('\n')
        .toLowerCase();
      if (terms.every((term) => haystack.includes(term))) found.push({ step: node, path });
      walk(node.children, [...path, node.title]);
    }
  };
  walk(steps, []);
  return [
    ...found.filter((hit) => hit.step.status === 'open'),
    ...found.filter((hit) => hit.step.status !== 'open'),
  ];
}
