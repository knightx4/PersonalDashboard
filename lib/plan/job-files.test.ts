import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { jobFile } from './job-files';
import type { RunJob } from './run-end';

const JOBS: RunJob[] = [
  'step', 'feature', 'queue', 'reshape', 'shape', 'notes', 'review', 'comment', 'raise',
  'check_back', 'vision', 'vision_reshape', 'ci_fix', 'posts', 'spec_change', 'overhaul',
  'audit', 'unstick',
];

describe('jobFile', () => {
  it('names a file that exists for every job', () => {
    for (const job of JOBS) {
      expect(existsSync(join(process.cwd(), jobFile(job))), job).toBe(true);
    }
  });

  it('sends one step to the build procedure and a batch to the front door', () => {
    expect(jobFile('step')).toBe('.claude/skills/plan/reference/building.md');
    expect(jobFile('step', false)).toBe('.claude/skills/plan/SKILL.md');
    expect(jobFile('feature')).toBe('.claude/skills/plan/SKILL.md');
  });

  it('sends the jobs that build nothing to their own file', () => {
    expect(jobFile('comment')).toBe('.claude/skills/plan/reference/comments.md');
    expect(jobFile('raise')).toBe('.claude/skills/plan/reference/raising.md');
    expect(jobFile('reshape')).toBe('.claude/skills/plan/reference/reshaping.md');
  });
});
