import { describe, expect, it } from 'vitest';
import type { PlanNode, PlanSection } from './tree';
import { openFeaturesIn, scopeLabel, visionReshapeText } from './vision-reshape';

function node(number: number, status: PlanNode['status'], dismissedAt: string | null = null): PlanNode {
  return { id: `id-${number}`, number, title: `Feature ${number}`, status, dismissedAt } as PlanNode;
}

function section(module: PlanSection['module'], nodes: PlanNode[]): PlanSection {
  return { module, label: module ?? 'App', nodes } as PlanSection;
}

const sections = [
  section('jobs', [
    node(1, 'not_started'),
    node(2, 'done'),
    node(3, 'proposed'),
    node(4, 'dropped'),
    node(5, 'in_progress', '2026-09-20T00:00:00Z'),
    node(6, 'blocked'),
  ]),
  section(null, [node(7, 'not_started')]),
];

describe('openFeaturesIn', () => {
  it('reads the unfinished, undismissed features of the workspace', () => {
    expect(openFeaturesIn(sections, 'jobs').map((n) => n.number)).toEqual([1, 3, 6]);
  });

  it('reads the trees filed under no workspace for the app vision', () => {
    expect(openFeaturesIn(sections, 'app').map((n) => n.number)).toEqual([7]);
  });

  it('reads nothing for a workspace with no plan', () => {
    expect(openFeaturesIn(sections, 'vault')).toEqual([]);
  });
});

describe('visionReshapeText', () => {
  const text = visionReshapeText({
    scope: 'jobs',
    before: 'Find a job.',
    after: 'Find a job worth keeping.',
    features: [node(1, 'not_started'), node(3, 'proposed')],
  });

  it('points the run at the procedure and names the workspace', () => {
    expect(text).toContain('"After a vision edit" in .claude/skills/plan/reference/reshaping.md');
    expect(text).toContain(`in ${scopeLabel('jobs')} against its new vision`);
  });

  it('carries both visions and every open feature', () => {
    expect(text).toContain('## The new vision\n\nFind a job worth keeping.');
    expect(text).toContain('## The vision it replaced\n\nFind a job.');
    expect(text).toContain('- #1 Feature 1 (not started)');
    expect(text).toContain('- #3 Feature 3 (proposed)');
  });

  it('allows only proposals and drop questions', () => {
    expect(text).toContain('Never run plan.ts drop.');
    expect(text).toContain('--proposed and no --parent --module jobs');
    expect(text).toContain('--proposed under it, even though the feature is approved');
    expect(text).toContain('Nothing you write is ready to build');
    expect(text).toContain('do not commit or push');
  });

  it('says when there was no vision before', () => {
    const first = visionReshapeText({ scope: 'app', before: null, after: 'A dashboard.', features: [] });
    expect(first).toContain('Nothing was written before.');
    expect(first).not.toContain('--module');
  });
});
