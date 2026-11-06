import { describe, expect, it } from 'vitest';
import type { DashChange } from '@/lib/talk/changes';
import { buildLine, buildRunId, followedRuns, workingCard, type BuildRun } from './live-cards';

function change(fields: Partial<DashChange> & Pick<DashChange, 'id' | 'kind' | 'input' | 'status'>): DashChange {
  return {
    conversationId: '',
    turnId: null,
    subjectRef: null,
    writtenTable: null,
    writtenRef: null,
    undo: null,
    createdAt: '2026-11-03T08:58:30Z',
    doneAt: null,
    declinedAt: null,
    undoneAt: null,
    ...fields,
  } as DashChange;
}

const todo = change({
  id: 'c-todo',
  kind: 'add_todo',
  input: { title: 'Call the bank', body: null, dueOn: null, dueTime: null, pinned: false },
  status: 'done',
  advisorMessageId: 'm2',
});

const BUILD_INPUT = { stepId: 's1', number: 2860, outline: '2854.3', title: 'Show a live card', quiet: false };
const build = change({
  id: 'c-build',
  kind: 'start_build',
  input: BUILD_INPUT,
  status: 'done',
  subjectRef: 'public.plan_runs:r1',
  writtenTable: 'public.plan_runs',
  writtenRef: 'r1',
  advisorMessageId: 'm1',
});

function run(fields: Partial<BuildRun> = {}): BuildRun {
  return { runId: 'r1', status: 'started', stepStatus: 'in_progress', stopReason: null, error: null, progress: null, ...fields };
}

describe('workingCard', () => {
  const asked = [
    { id: 'm1', role: 'advisor' as const },
    { id: 'm2', role: 'person' as const },
  ];

  it('draws nothing for a plain chat, typing or not', () => {
    expect(workingCard(asked, [], true)).toBeNull();
    expect(workingCard(asked, [], false)).toBeNull();
  });

  it('says what was done while the reply is still being written', () => {
    expect(workingCard(asked, [todo], true)).toEqual({ messageId: 'm2', text: 'Added the todo Call the bank', more: 0 });
  });

  it('gives way once they stop typing or reply', () => {
    expect(workingCard(asked, [todo], false)).toBeNull();
    expect(workingCard([...asked, { id: 'm3', role: 'advisor' }], [todo], true)).toBeNull();
  });

  it('shares one card between several things, newest first', () => {
    const step = change({
      id: 'c-step',
      kind: 'add_goal_step',
      input: { parentId: 'g1', goalTitle: 'Move to Lisbon', title: 'Book the flat viewing', kind: 'mine' },
      status: 'done',
      advisorMessageId: 'm2',
    });
    expect(workingCard(asked, [todo, step], true)).toMatchObject({ text: 'Added the step Book the flat viewing under Move to Lisbon', more: 1 });
  });

  it('reads a proposal as being made, since its Confirm comes with the reply', () => {
    const proposed = change({ id: 'c-p', kind: 'start_build', input: BUILD_INPUT, status: 'proposed', advisorMessageId: 'm2' });
    expect(workingCard(asked, [proposed], true)?.text).toBe('Proposing: start the build of #2854.3 Show a live card');
  });
});

describe('buildLine', () => {
  it('says a build is starting before its run is read', () => {
    expect(buildLine(BUILD_INPUT, null)).toMatchObject({ tone: 'working', text: 'Building: starting a session', href: '/dev/plan/2860' });
  });

  it('follows what the session last reported', () => {
    const line = buildLine(BUILD_INPUT, run({ progress: { state: 'working', action: '2 of 5 checks passed.', needs: null } }));
    expect(line).toMatchObject({ tone: 'working', text: 'Building: 2 of 5 checks passed' });
  });

  it('says what it needs and offers the answer', () => {
    const line = buildLine(BUILD_INPUT, run({ status: 'awaiting_input', progress: { state: 'waiting', action: 'Asked', needs: 'Which shape for the export?' } }));
    expect(line).toMatchObject({ tone: 'needs', text: 'Needs you: Which shape for the export?', linkLabel: 'Answer' });
  });

  it('settles on built once the step is done, whatever the run last said', () => {
    expect(buildLine(BUILD_INPUT, run({ status: 'started', stepStatus: 'done' }))).toMatchObject({ tone: 'done', text: 'Built' });
  });

  it('says why a run stopped and points to where it can be sent again', () => {
    expect(buildLine(BUILD_INPUT, run({ status: 'finished', stopReason: 'Too big for one sitting.' }))).toMatchObject({
      tone: 'failed',
      text: 'Stopped: Too big for one sitting',
      linkLabel: 'Try again from its page',
    });
    expect(buildLine(BUILD_INPUT, run({ status: 'failed', error: null }))).toMatchObject({ tone: 'failed', text: 'Stopped before it was built' });
  });

  it('calls a blocked step blocked, not stopped', () => {
    expect(buildLine(BUILD_INPUT, run({ status: 'finished', stepStatus: 'blocked' }))).toMatchObject({ tone: 'needs', text: 'Blocked' });
  });
});

describe('followedRuns', () => {
  it('follows builds going or waiting, and leaves settled ones', () => {
    expect(buildRunId(build)).toBe('r1');
    expect(buildRunId(todo)).toBeNull();
    expect(followedRuns([todo, build], {})).toEqual(['r1']);
    expect(followedRuns([build], { r1: run() })).toEqual(['r1']);
    expect(followedRuns([build], { r1: run({ status: 'awaiting_input' }) })).toEqual(['r1']);
    expect(followedRuns([build], { r1: run({ stepStatus: 'done' }) })).toEqual([]);
    expect(followedRuns([build], { r1: run({ status: 'failed' }) })).toEqual([]);
  });
});
