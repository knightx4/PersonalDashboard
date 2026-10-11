import { describe, expect, it } from 'vitest';
import type { StepNode } from '@/lib/goals/steps';
import { findSteps } from './find-steps';

const step = (id: string, title: string, extra: Partial<StepNode> = {}): StepNode =>
  ({
    id,
    title,
    detail: null,
    acceptance: null,
    status: 'open',
    children: [],
    ...extra,
  }) as StepNode;

describe('findSteps', () => {
  const tree = [
    step('a', 'Apply to Ramp', {
      children: [step('a1', 'Write the cover letter', { detail: 'Lead with the FP&A model' })],
    }),
    step('b', 'Old cover letter', { status: 'done' }),
    step('c', 'Measure the wall'),
  ];

  it('finds a step at any depth by its title or detail, with the steps above it', () => {
    const found = findSteps(tree, 'fp&a');
    expect(found.map((f) => [f.step.id, f.path])).toEqual([['a1', ['Apply to Ramp']]]);
  });

  it('needs every word, and puts open steps before closed ones', () => {
    expect(findSteps(tree, 'cover letter').map((f) => f.step.id)).toEqual(['a1', 'b']);
  });

  it('finds nothing for a blank query', () => {
    expect(findSteps(tree, '  ')).toEqual([]);
  });
});
