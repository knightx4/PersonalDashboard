/**
 * The one file a routine session follows for each job it can be fired with.
 *
 * The plan routine used to open every run by reading the skill's front door,
 * whatever the job: a comment reply read the whole batch procedure before the
 * comment. The standing prompt now reads only the file its turn names, so
 * every turn has to name one, and a turn written in two places (the first
 * fire, and the continuation after a question is answered) has to name the
 * same one. This is the list both read.
 *
 * Pure and browser-safe, so it is tested without a routine.
 */
import type { RunJob } from './run-end';

const PLAN = '.claude/skills/plan';

const FILES: Record<RunJob, string> = {
  step: `${PLAN}/reference/building.md`,
  feature: `${PLAN}/SKILL.md`,
  queue: `${PLAN}/SKILL.md`,
  overhaul: `${PLAN}/reference/overhaul.md`,
  shape: `${PLAN}/reference/shaping.md`,
  spec_change: `${PLAN}/reference/shaping.md`,
  reshape: `${PLAN}/reference/reshaping.md`,
  vision_reshape: `${PLAN}/reference/reshaping.md`,
  comment: `${PLAN}/reference/comments.md`,
  raise: `${PLAN}/reference/raising.md`,
  unstick: `${PLAN}/reference/unsticking.md`,
  check_back: `${PLAN}/SKILL.md`,
  ci_fix: 'CLAUDE.md',
  posts: '.claude/skills/posts/SKILL.md',
  notes: '.claude/skills/notes/SKILL.md',
  review: '.claude/skills/ui-review/SKILL.md',
  vision: '.claude/skills/vision-review/SKILL.md',
  audit: '.claude/skills/spec-audit/SKILL.md',
};

/**
 * The file a run of this job follows. A step with steps beneath it is a
 * batch, which is orchestrated from the front door, so `alone` is false for
 * one and sends it there.
 */
export function jobFile(job: RunJob, alone = true): string {
  if (job === 'step' && !alone) return `${PLAN}/SKILL.md`;
  return FILES[job];
}
