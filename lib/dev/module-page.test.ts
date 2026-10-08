import { describe, expect, it } from 'vitest';
import type { FeedbackRow } from '@/lib/feedback/load';
import type { IdeaRow } from '@/lib/ideas/load';
import { moduleById } from '@/lib/modules';
import type { PlanItem } from '@/lib/plan/load';
import { moduleCrumbs, moduleSummaries, moduleSummary, uiLine, type ModuleInputs } from './module-page';

let counter = 0;
function item(over: Partial<PlanItem> & { id: string }): PlanItem {
  counter += 1;
  return {
    number: counter,
    module: 'jobs',
    parentId: null,
    title: over.id,
    detail: null,
    acceptance: null,
    status: 'not_started',
    kind: 'build',
    track: 'feature',
    fog: null,
    resolution: null,
    dismissedAt: null,
    fogDismissedAt: null,
    comment: null,
    blockAsk: null,
    blockKind: null,
    thread: [],
    priority: 2,
    size: null,
    assignee: null,
    commitSha: null,
    position: counter,
    startedAt: null,
    completedAt: null,
    createdAt: '2026-09-01T00:00:00Z',
    updatedAt: '2026-09-01T00:00:00Z',
    ...over,
  };
}

const note = (id: string, pagePath: string | null, status: FeedbackRow['status'] = 'open') =>
  ({ id, kind: 'bug', body: id, pagePath, status, priority: 2, resolutionNote: null, commitSha: null, createdAt: '2026-10-01T00:00:00Z', completedAt: null, thread: [] }) as FeedbackRow;

const idea = (id: string, module: IdeaRow['module']) =>
  ({ id, body: id, module, createdAt: '2026-10-01T00:00:00Z', planItem: null, source: 'me', from: null, dismissedAt: null, thread: [] }) as IdeaRow;

function inputs(over: Partial<ModuleInputs> = {}): ModuleInputs {
  return { plan: [], bugs: [], ideas: [], visions: {}, ui: [], usage: [], notOpened: [], ...over };
}

const jobs = moduleById('jobs')!;

describe("a module's page", () => {
  it('files a step under the module of the feature at the top of its branch', () => {
    const summary = moduleSummary(
      jobs,
      inputs({
        plan: [
          item({ id: 'f', updatedAt: '2026-10-01T00:00:00Z' }),
          // A step whose own column says nothing, or something else, is the feature's.
          item({ id: 's', parentId: 'f', module: null }),
          item({ id: 'ss', parentId: 's', module: 'vault' }),
          item({ id: 'g', updatedAt: '2026-10-05T00:00:00Z' }),
          item({ id: 'v', module: 'vault' }),
        ],
      }),
    );
    expect(summary.features.map((f) => f.id)).toEqual(['g', 'f']);
    expect(summary.openSteps).toBe(4);
  });

  it('leaves out closed and dismissed rows, and lists what shipped newest first', () => {
    const summary = moduleSummary(
      jobs,
      inputs({
        plan: [
          item({ id: 'old', status: 'done', completedAt: '2026-09-01T00:00:00Z' }),
          item({ id: 'new', status: 'done', completedAt: '2026-10-01T00:00:00Z' }),
          item({ id: 'dropped', status: 'dropped' }),
          item({ id: 'aside', dismissedAt: '2026-10-01T00:00:00Z' }),
        ],
      }),
    );
    expect(summary.features).toEqual([]);
    expect(summary.openSteps).toBe(0);
    expect(summary.shipped.map((s) => s.id)).toEqual(['new', 'old']);
  });

  it('takes the outstanding bugs filed from its pages, and its own ideas', () => {
    const summary = moduleSummary(
      jobs,
      inputs({
        bugs: [note('a', '/jobs/pipeline'), note('b', '/jobs'), note('c', '/jobsearch'), note('d', '/jobs', 'done'), note('e', null)],
        ideas: [idea('x', 'jobs'), idea('y', null), idea('z', 'vault')],
      }),
    );
    expect(summary.bugs.map((b) => b.id)).toEqual(['a', 'b']);
    expect(summary.ideas.map((i) => i.id)).toEqual(['x']);
  });

  it('has a summary for every module, and crumbs from Dev down to it', () => {
    expect(moduleSummaries(inputs()).map((s) => s.module.id)).toContain('dev');
    expect(moduleCrumbs(jobs).map((c) => c.href)).toEqual(['/dev', '/dev/modules', '/dev/modules/jobs']);
  });

  it('says a module nobody has reviewed was never reviewed', () => {
    expect(uiLine(null)).toBe('Never reviewed');
  });
});
